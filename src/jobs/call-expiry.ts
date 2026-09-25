import cron from "node-cron";
import { prisma } from "../config/prisma.js";
import { withDistributedLock } from "../helpers/jobLock.js";
import { transitionCall } from "../helpers/callStateMachine.js";
import { dispatchNotificationOutbox } from "../helpers/pushNotifications.js";
import { logCallExpired } from "../helpers/callLogger.js";
import type { Server } from "socket.io";

let io: Server;

export const setCallExpiryIo = (ioInstance: Server) => {
  io = ioInstance;
};

/**
 * Durable cron job that expires unanswered calls.
 * Runs every 10 seconds. Uses distributed lock so only one instance
 * processes the batch when scaled horizontally.
 *
 * Cancellation, decline, or answer before timeout makes the transition
 * a safe no-op (transitionCall returns null).
 */
export const callExpiryJob = () => {
  cron.schedule("*/10 * * * * *", async () => {
    await withDistributedLock("call-expiry", 8000, async () => {
      const now = new Date();

      const expiredCalls = await prisma.call.findMany({
        where: { status: "RINGING", expiresAt: { lte: now } },
        take: 50,
      });

      for (const call of expiredCalls) {
        const changed = await transitionCall(
          call.id,
          "RINGING",
          "MISSED",
          { endedAt: now },
          "system",
        );

        if (!changed) continue;

        // Best-effort immediate dispatch of MISSED state push
        dispatchNotificationOutbox().catch((error) => {
          console.error("[outbox] call expiry dispatch error:", error);
        });

        logCallExpired({
          callId: call.id,
          ringDurationMs: call.ringingAt ? now.getTime() - call.ringingAt.getTime() : 0,
        });

        const payload = {
          callId: call.id,
          callType: call.callType,
          status: "MISSED",
          sequence: changed.version,
          occurredAt: now.toISOString(),
        };

        io.to(`user:${call.callerId}`).emit("call.missed", payload);
        io.to(`user:${call.receiverId}`).emit("call.missed", payload);
      }
    });
  });

  console.log("Call expiry cron job initialized (every 10s)");
};
