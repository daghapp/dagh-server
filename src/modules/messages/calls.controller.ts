import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, created, fail } from "../../helpers/response.js";
import { getCallServiceUrl } from "../../helpers/call-service.js";
import { generateLiveKitRoomToken, generateSecureCallToken } from "../../helpers/livekit.js";
import { transitionCall } from "../../helpers/callStateMachine.js";
import {
  logCallInitiated,
  logCallAnswerTime,
  logCallDuration,
  logCallSocketDelivered,
  logCallTokenGenerated,
} from "../../helpers/callLogger.js";
import { isUserBlocked } from "../../helpers/safety.js";
import { dispatchNotificationOutbox } from "../../helpers/pushNotifications.js";
// import { hasPaidActiveMembership } from "../../helpers/membership.js"; // TODO: re-enable with paid-tier gating
import { getRedisClient } from "../../config/redis.js";
import crypto from "crypto";
import type { Server } from "socket.io";
import type { CallStatus } from "../../../generated/prisma/client.js";

let io: Server;

export const setIoInstance = (ioInstance: Server) => {
  io = ioInstance;
};

export const getIoInstance = (): Server | undefined => {
  return io;
};

const USER_PROFILE_SELECT = {
  id: true,
  fullName: true,
  profile: { select: { bio_profile_image_url: true, profileUrl: true } },
};

const CALL_INCLUDE = {
  caller: { select: USER_PROFILE_SELECT },
  receiver: { select: USER_PROFILE_SELECT },
};

function isTerminalStatus(status: string): boolean {
  return ["DECLINED", "CANCELLED", "MISSED", "ENDED", "FAILED"].includes(status);
}

class CallBusyError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// POST /calls — Initiate a call
// ---------------------------------------------------------------------------
export const initiateCall = async (req: Request, res: Response) => {
  try {
    const callerId = req.user!.id;
    const { receiverId, conversationId, callType = "VOICE" } = req.body;
    const idempotencyKey = req.headers["idempotency-key"] as string | undefined;

    // 1. Idempotency check
    if (idempotencyKey) {
      const redis = getRedisClient();
      if (redis) {
        const cached = await redis.get(`idempotency:call:${idempotencyKey}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          return ok(res, parsed);
        }
      }
    }

    // 2. Validate receiver is not self
    if (receiverId === callerId) {
      return fail(res, 422, { code: "INVALID_INPUT", message: "You cannot call yourself" });
    }

    // 3. Verify receiver exists
    const receiver = await prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true, accountStatus: true },
    });
    if (!receiver || receiver.accountStatus !== "ACTIVE") {
      return fail(res, 404, { code: "CALL_NOT_FOUND", message: "Recipient not found" });
    }

    // 4. Verify users are matched
    const match = await prisma.userMatch.findFirst({
      where: {
        OR: [
          { userId: callerId, matchedId: receiverId, status: "MATCHED" },
          { userId: receiverId, matchedId: callerId, status: "MATCHED" },
        ],
      },
    });
    if (!match) {
      return fail(res, 403, {
        code: "NOT_MATCHED",
        message: "You must be matched to call this user",
      });
    }

    // 5. Verify conversation belongs to both users (if provided)
    if (conversationId) {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { participants: true },
      });
      if (
        !conversation ||
        !conversation.participants.includes(callerId) ||
        !conversation.participants.includes(receiverId)
      ) {
        return fail(res, 403, { code: "NOT_MATCHED", message: "Invalid conversation" });
      }
    }

    // 6. Check block status
    if (await isUserBlocked(callerId, receiverId)) {
      return fail(res, 403, { code: "USER_BLOCKED", message: "Cannot place call" });
    }

    // TODO: Re-enable paid-tier gating once membership is fully rolled out.
    // During testing the FREE tier is allowed to place calls.
    // if (!(await hasPaidActiveMembership(callerId))) {
    //   return fail(
    //     res,
    //     403,
    //     {
    //       code: "PAID_TIER_REQUIRED",
    //       message: "Calling requires an active paid membership",
    //     },
    //     { action: "UPGRADE", redirect: "/membership" },
    //   );
    // }

    // 7. Atomically reject duplicate active calls and create the RINGING call.
    //    Both user rows are locked (in stable sorted order) so two concurrent
    //    call attempts can never both pass the busy check.
    const callId = crypto.randomUUID();
    const roomId = crypto.randomUUID();
    const RING_WINDOW_MS = 45_000;
    const expiresAt = new Date(Date.now() + RING_WINDOW_MS);
    const ringingAt = new Date();

    let ringing: Awaited<ReturnType<typeof prisma.call.create>>;
    try {
      ringing = await prisma.$transaction(async (tx) => {
        const lockIds = [callerId, receiverId].sort();
        await tx.$queryRaw`SELECT id FROM users WHERE id IN (${lockIds[0]}, ${lockIds[1]}) FOR UPDATE`;

        const activeStatuses: CallStatus[] = ["INITIATING", "RINGING", "ANSWERED"];
        const [callerActive, receiverActive] = await Promise.all([
          tx.call.findFirst({
            where: {
              OR: [{ callerId }, { receiverId: callerId }],
              status: { in: activeStatuses },
            },
          }),
          tx.call.findFirst({
            where: {
              OR: [{ callerId: receiverId }, { receiverId }],
              status: { in: activeStatuses },
            },
          }),
        ]);

        if (callerActive) {
          throw new CallBusyError("CALL_ALREADY_ACTIVE", "You are already in or initiating a call");
        }
        if (receiverActive) {
          throw new CallBusyError("RECIPIENT_BUSY", "This user is currently in another call");
        }

        const created = await tx.call.create({
          data: {
            id: callId,
            roomId,
            callerId,
            receiverId,
            conversationId: conversationId ?? null,
            callType,
            status: "RINGING",
            ringingAt,
            expiresAt,
          },
        });

        await tx.notificationOutbox.create({
          data: {
            eventType: "INCOMING_CALL",
            aggregateId: created.id,
            recipientUserId: created.receiverId,
            payload: { callId: created.id, sequence: created.version },
          },
        });

        return created;
      });
    } catch (error) {
      if (error instanceof CallBusyError) {
        return fail(res, 409, { code: error.code, message: error.message });
      }
      throw error;
    }

    // Best-effort immediate dispatch of the incoming-call push.
    // The cron worker remains the durable fallback.
    dispatchNotificationOutbox().catch((error) => {
      console.error("[outbox] call fast dispatch error:", error);
    });

    // 10. Generate caller LiveKit token (short-lived)
    const liveKitToken = await generateSecureCallToken({
      roomId,
      identity: callerId,
      name: req.user!.fullName,
    });

    const serviceUrl = getCallServiceUrl();

    logCallInitiated({ callId, callerId, receiverId, callType, idempotencyKey });

    // 11. Emit socket events
    const callerProfile = await prisma.user.findUnique({
      where: { id: callerId },
      select: USER_PROFILE_SELECT,
    });

    const incomingPayload = {
      callId: ringing.id,
      callType: ringing.callType,
      conversationId: ringing.conversationId,
      caller: callerProfile
        ? {
            id: callerProfile.id,
            fullName: callerProfile.fullName,
            profileImageUrl:
              callerProfile.profile?.bio_profile_image_url ||
              callerProfile.profile?.profileUrl ||
              null,
          }
        : null,
      status: ringing.status,
      expiresAt: ringing.expiresAt.toISOString(),
      sequence: ringing.version,
      occurredAt: new Date().toISOString(),
    };

    io.to(`user:${receiverId}`).emit("call.incoming", incomingPayload);
    logCallSocketDelivered({ callId, event: "call.incoming", recipientOnline: true });

    const ringingPayload = {
      callId: ringing.id,
      callType: ringing.callType,
      conversationId: ringing.conversationId,
      status: ringing.status,
      expiresAt: ringing.expiresAt.toISOString(),
      sequence: ringing.version,
      occurredAt: new Date().toISOString(),
    };
    io.to(`user:${callerId}`).emit("call.ringing", ringingPayload);

    // 12. Cache idempotency response
    const responseData = {
      call: {
        id: ringing.id,
        roomId: ringing.roomId,
        callerId: ringing.callerId,
        receiverId: ringing.receiverId,
        conversationId: ringing.conversationId,
        callType: ringing.callType,
        status: ringing.status,
        expiresAt: ringing.expiresAt.toISOString(),
      },
      token: liveKitToken?.token ?? null,
      serviceUrl: liveKitToken?.serviceUrl ?? serviceUrl,
    };

    if (idempotencyKey) {
      const redis = getRedisClient();
      if (redis) {
        await redis.set(`idempotency:call:${idempotencyKey}`, JSON.stringify(responseData), {
          EX: 300,
        });
      }
    }

    return created(res, responseData);
  } catch (error) {
    console.error("[Calls] initiateCall error:", error);
    return fail(res, 500, { code: "CALL_FAILED", message: "Failed to initiate call" });
  }
};

// ---------------------------------------------------------------------------
// GET /calls/history — Call history with cursor pagination
// ---------------------------------------------------------------------------
export const getCallHistory = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const cursor = req.query.cursor as string | undefined;

    const where = {
      OR: [{ callerId: userId }, { receiverId: userId }],
      ...(cursor
        ? {
            createdAt: {
              lt:
                (
                  await prisma.call.findUnique({
                    where: { id: cursor },
                    select: { createdAt: true },
                  })
                )?.createdAt ?? new Date(),
            },
          }
        : {}),
    };

    const calls = await prisma.call.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      include: {
        caller: { select: USER_PROFILE_SELECT },
        receiver: { select: USER_PROFILE_SELECT },
      },
    });

    const hasMore = calls.length > limit;
    const data = hasMore ? calls.slice(0, limit) : calls;

    const historyEntries = data.map((call) => ({
      id: call.id,
      direction: call.callerId === userId ? "OUTGOING" : "INCOMING",
      callType: call.callType,
      status: call.status,
      otherUser:
        call.callerId === userId
          ? {
              id: call.receiver.id,
              fullName: call.receiver.fullName,
              profileImageUrl:
                call.receiver.profile?.bio_profile_image_url ||
                call.receiver.profile?.profileUrl ||
                null,
            }
          : {
              id: call.caller.id,
              fullName: call.caller.fullName,
              profileImageUrl:
                call.caller.profile?.bio_profile_image_url ||
                call.caller.profile?.profileUrl ||
                null,
            },
      startedAt: call.ringingAt?.toISOString() ?? call.createdAt.toISOString(),
      answeredAt: call.answeredAt?.toISOString() ?? null,
      endedAt: call.endedAt?.toISOString() ?? null,
      durationSec: call.durationSec ?? 0,
    }));

    return ok(res, {
      calls: historyEntries,
      nextCursor: hasMore ? data[data.length - 1].id : null,
    });
  } catch (error) {
    console.error("[Calls] getCallHistory error:", error);
    return fail(res, 500, "Failed to fetch call history");
  }
};

// ---------------------------------------------------------------------------
// GET /calls/:callId — Get current call state
// ---------------------------------------------------------------------------
export const getCallState = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const callId = String(req.params.callId);

    const call = await prisma.call.findUnique({
      where: { id: callId },
      include: CALL_INCLUDE,
    });

    if (!call) {
      return fail(res, 404, { code: "CALL_NOT_FOUND", message: "Call not found" });
    }

    if (call.callerId !== userId && call.receiverId !== userId) {
      return fail(res, 403, { code: "NOT_CALL_PARTICIPANT", message: "Not a participant" });
    }

    return ok(res, {
      id: call.id,
      roomId: call.roomId,
      callerId: call.callerId,
      receiverId: call.receiverId,
      conversationId: call.conversationId,
      callType: call.callType,
      status: call.status,
      createdAt: call.createdAt.toISOString(),
      ringingAt: call.ringingAt?.toISOString() ?? null,
      answeredAt: call.answeredAt?.toISOString() ?? null,
      endedAt: call.endedAt?.toISOString() ?? null,
      expiresAt: call.expiresAt.toISOString(),
      endedBy: call.endedBy,
      durationSec: call.durationSec,
      sequence: call.version,
      caller: {
        id: call.caller.id,
        fullName: call.caller.fullName,
        profileImageUrl:
          call.caller.profile?.bio_profile_image_url || call.caller.profile?.profileUrl || null,
      },
      receiver: {
        id: call.receiver.id,
        fullName: call.receiver.fullName,
        profileImageUrl:
          call.receiver.profile?.bio_profile_image_url || call.receiver.profile?.profileUrl || null,
      },
    });
  } catch (error) {
    console.error("[Calls] getCallState error:", error);
    return fail(res, 500, "Failed to fetch call state");
  }
};

// ---------------------------------------------------------------------------
// POST /calls/:callId/answer — Answer an incoming call
// ---------------------------------------------------------------------------
export const answerCall = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const callId = String(req.params.callId);

    const existing = await prisma.call.findUnique({ where: { id: callId } });
    if (!existing) {
      return fail(res, 404, { code: "CALL_NOT_FOUND", message: "Call not found" });
    }
    if (existing.receiverId !== userId) {
      return fail(res, 403, {
        code: "NOT_CALL_PARTICIPANT",
        message: "Only the receiver can answer",
      });
    }
    if (isTerminalStatus(existing.status)) {
      return fail(res, 409, {
        code: "CALL_ALREADY_ENDED",
        message: `Call is already ${existing.status}`,
      });
    }
    if (existing.expiresAt <= new Date()) {
      return fail(res, 409, { code: "CALL_EXPIRED", message: "Call has expired" });
    }

    const now = new Date();
    const answered = await transitionCall(
      callId,
      "RINGING",
      "ANSWERED",
      { answeredAt: now },
      userId,
    );

    if (!answered) {
      // Might have been answered by another device simultaneously
      const fresh = await prisma.call.findUnique({ where: { id: callId } });
      return fail(res, 409, {
        code: "CALL_ALREADY_ANSWERED",
        message: "Call was already answered",
        details: { currentStatus: fresh?.status },
      });
    }

    // Best-effort immediate dispatch of ANSWERED state push
    dispatchNotificationOutbox().catch((error) => {
      console.error("[outbox] call state dispatch error:", error);
    });

    // Generate receiver LiveKit token
    const liveKitToken = await generateSecureCallToken({
      roomId: answered.roomId,
      identity: userId,
      name: req.user!.fullName,
    });

    logCallAnswerTime({
      callId,
      ringDurationMs: answered.ringingAt ? now.getTime() - answered.ringingAt.getTime() : 0,
    });

    // Emit events
    io.to(`user:${answered.callerId}`).emit("call.answered", {
      callId: answered.id,
      roomId: answered.roomId,
      status: "ANSWERED",
      sequence: answered.version,
      occurredAt: now.toISOString(),
    });

    // Push the ANSWERED state to the caller's other installations and the
    // receiver's other devices so an in-progress incoming-call ring is
    // dismissed everywhere except the answering installation (its native
    // handler preserves the locally answered call).

    // Notify receiver's other socket devices
    const receiverSockets = io.sockets.adapter.rooms.get(`user:${userId}`);
    if (receiverSockets && receiverSockets.size > 1) {
      io.to(`user:${userId}`).emit("call.answered_elsewhere", {
        callId: answered.id,
        roomId: answered.roomId,
        status: "ANSWERED",
        sequence: answered.version,
        occurredAt: now.toISOString(),
      });
    }

    return ok(res, {
      callId: answered.id,
      roomId: answered.roomId,
      status: "ANSWERED",
      token: liveKitToken?.token ?? null,
      serviceUrl: liveKitToken?.serviceUrl ?? getCallServiceUrl(),
    });
  } catch (error) {
    console.error("[Calls] answerCall error:", error);
    return fail(res, 500, "Failed to answer call");
  }
};

// ---------------------------------------------------------------------------
// POST /calls/:callId/decline — Decline an incoming call
// ---------------------------------------------------------------------------
export const declineCall = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const callId = String(req.params.callId);

    const existing = await prisma.call.findUnique({ where: { id: callId } });
    if (!existing) {
      return fail(res, 404, { code: "CALL_NOT_FOUND", message: "Call not found" });
    }
    if (existing.receiverId !== userId) {
      return fail(res, 403, {
        code: "NOT_CALL_PARTICIPANT",
        message: "Only the receiver can decline",
      });
    }
    if (isTerminalStatus(existing.status)) {
      return fail(res, 409, {
        code: "CALL_ALREADY_ENDED",
        message: `Call is already ${existing.status}`,
      });
    }
    if (existing.expiresAt <= new Date()) {
      return fail(res, 409, { code: "CALL_EXPIRED", message: "Call has expired" });
    }

    const now = new Date();
    const declined = await transitionCall(callId, "RINGING", "DECLINED", { endedAt: now }, userId);

    if (!declined) {
      return fail(res, 409, {
        code: "INVALID_CALL_STATE",
        message: "Cannot decline in current state",
      });
    }

    // Best-effort immediate dispatch of DECLINED state push
    dispatchNotificationOutbox().catch((error) => {
      console.error("[outbox] call state dispatch error:", error);
    });

    const payload = {
      callId: declined.id,
      callType: declined.callType,
      status: "DECLINED",
      sequence: declined.version,
      occurredAt: now.toISOString(),
    };

    io.to(`user:${declined.callerId}`).emit("call.declined", payload);
    io.to(`user:${declined.receiverId}`).emit("call.declined", payload);

    return ok(res, { callId: declined.id, status: "DECLINED" });
  } catch (error) {
    console.error("[Calls] declineCall error:", error);
    return fail(res, 500, "Failed to decline call");
  }
};

// ---------------------------------------------------------------------------
// POST /calls/:callId/cancel — Cancel an outgoing call
// ---------------------------------------------------------------------------
export const cancelCall = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const callId = String(req.params.callId);

    const existing = await prisma.call.findUnique({ where: { id: callId } });
    if (!existing) {
      return fail(res, 404, { code: "CALL_NOT_FOUND", message: "Call not found" });
    }
    if (existing.callerId !== userId) {
      return fail(res, 403, {
        code: "NOT_CALL_PARTICIPANT",
        message: "Only the caller can cancel",
      });
    }
    if (isTerminalStatus(existing.status)) {
      return fail(res, 409, {
        code: "CALL_ALREADY_ENDED",
        message: `Call is already ${existing.status}`,
      });
    }
    if (existing.expiresAt <= new Date()) {
      return fail(res, 409, { code: "CALL_EXPIRED", message: "Call has expired" });
    }

    const now = new Date();
    const cancelled = await transitionCall(
      callId,
      ["INITIATING", "RINGING"],
      "CANCELLED",
      { endedAt: now },
      userId,
    );

    if (!cancelled) {
      return fail(res, 409, {
        code: "INVALID_CALL_STATE",
        message: "Cannot cancel in current state",
      });
    }

    // Best-effort immediate dispatch of CANCELLED state push
    dispatchNotificationOutbox().catch((error) => {
      console.error("[outbox] call state dispatch error:", error);
    });

    const payload = {
      callId: cancelled.id,
      callType: cancelled.callType,
      status: "CANCELLED",
      sequence: cancelled.version,
      occurredAt: now.toISOString(),
    };

    io.to(`user:${cancelled.receiverId}`).emit("call.cancelled", payload);
    io.to(`user:${cancelled.callerId}`).emit("call.cancelled", payload);

    return ok(res, { callId: cancelled.id, status: "CANCELLED" });
  } catch (error) {
    console.error("[Calls] cancelCall error:", error);
    return fail(res, 500, "Failed to cancel call");
  }
};

// ---------------------------------------------------------------------------
// POST /calls/:callId/end — End an active call
// ---------------------------------------------------------------------------
export const endCall = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const callId = String(req.params.callId);

    const existing = await prisma.call.findUnique({ where: { id: callId } });
    if (!existing) {
      return fail(res, 404, { code: "CALL_NOT_FOUND", message: "Call not found" });
    }
    if (existing.callerId !== userId && existing.receiverId !== userId) {
      return fail(res, 403, { code: "NOT_CALL_PARTICIPANT", message: "Not a participant" });
    }

    // Idempotent: already ended — return the ended call
    if (existing.status === "ENDED") {
      return ok(res, {
        callId: existing.id,
        roomId: existing.roomId,
        status: "ENDED",
        durationSec: existing.durationSec,
        endedBy: existing.endedBy,
      });
    }

    if (!["RINGING", "ANSWERED"].includes(existing.status)) {
      return fail(res, 409, { code: "INVALID_CALL_STATE", message: "Cannot end in current state" });
    }

    const now = new Date();
    const durationSec = existing.answeredAt
      ? Math.round((now.getTime() - existing.answeredAt.getTime()) / 1000)
      : 0;

    const ended = await transitionCall(
      callId,
      ["RINGING", "ANSWERED"],
      "ENDED",
      { endedAt: now, endedBy: userId, durationSec },
      userId,
    );

    if (!ended) {
      return fail(res, 409, { code: "INVALID_CALL_STATE", message: "Cannot end in current state" });
    }

    // Best-effort immediate dispatch of ENDED state push
    dispatchNotificationOutbox().catch((error) => {
      console.error("[outbox] call state dispatch error:", error);
    });

    logCallDuration({ callId, durationSec, endedBy: userId, endReason: "hangup" });

    const payload = {
      callId: ended.id,
      roomId: ended.roomId,
      callType: ended.callType,
      status: "ENDED",
      durationSec: ended.durationSec,
      endedBy: userId,
      sequence: ended.version,
      occurredAt: now.toISOString(),
    };

    io.to(`user:${ended.callerId}`).emit("call.ended", payload);
    io.to(`user:${ended.receiverId}`).emit("call.ended", payload);

    // Create a CALL_LOG message in the conversation
    if (existing.conversationId) {
      const mins = Math.floor(durationSec / 60);
      const secs = durationSec % 60;
      const durationText = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      const logContent =
        existing.status === "ANSWERED" ? `Call ended - ${durationText}` : "Call ended";

      try {
        const callMessage = await prisma.message.create({
          data: {
            conversationId: existing.conversationId,
            senderId: existing.callerId,
            receiverId: existing.receiverId,
            type: "CALL_LOG",
            content: logContent,
            mediaDuration: durationSec,
          },
        });

        io.to(`user:${existing.callerId}`).emit("new_message", callMessage);
        io.to(`user:${existing.receiverId}`).emit("new_message", callMessage);
      } catch (err) {
        console.error("[Calls] Failed to create call log message:", err);
      }
    }

    return ok(res, {
      callId: ended.id,
      roomId: ended.roomId,
      status: "ENDED",
      durationSec: ended.durationSec,
      endedBy: userId,
    });
  } catch (error) {
    console.error("[Calls] endCall error:", error);
    return fail(res, 500, "Failed to end call");
  }
};

// ---------------------------------------------------------------------------
// POST /calls/:callId/token — Secure LiveKit token scoped to a call
// ---------------------------------------------------------------------------
export const generateCallToken = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const callId = String(req.params.callId);

    const call = await prisma.call.findUnique({ where: { id: callId } });
    if (!call) {
      return fail(res, 404, { code: "CALL_NOT_FOUND", message: "Call not found" });
    }

    if (call.callerId !== userId && call.receiverId !== userId) {
      return fail(res, 403, { code: "NOT_CALL_PARTICIPANT", message: "Not a participant" });
    }

    // Check call is not expired or terminal
    if (isTerminalStatus(call.status)) {
      return fail(res, 409, {
        code: "CALL_ALREADY_ENDED",
        message: `Call is already ${call.status}`,
      });
    }
    if (call.expiresAt <= new Date()) {
      return fail(res, 409, { code: "CALL_EXPIRED", message: "Call has expired" });
    }

    // Caller: allowed while RINGING or ANSWERED
    // Receiver: allowed only after ANSWERED
    const isCaller = call.callerId === userId;
    if (!isCaller && call.status !== "ANSWERED") {
      return fail(res, 409, {
        code: "INVALID_CALL_STATE",
        message: "Receiver can only join after call is answered",
      });
    }

    const liveKitToken = await generateSecureCallToken({
      roomId: call.roomId,
      identity: userId,
      name: req.user!.fullName,
    });

    if (!liveKitToken) {
      return fail(res, 500, {
        code: "LIVEKIT_TOKEN_FAILED",
        message: "Failed to generate media token",
      });
    }

    logCallTokenGenerated({
      callId,
      userId,
      role: isCaller ? "caller" : "receiver",
      ttlSec: liveKitToken.expiresIn,
    });

    return ok(res, {
      callId: call.id,
      roomId: call.roomId,
      token: liveKitToken.token,
      serviceUrl: liveKitToken.serviceUrl,
      expiresIn: liveKitToken.expiresIn,
    });
  } catch (error) {
    console.error("[Calls] generateCallToken error:", error);
    return fail(res, 500, { code: "LIVEKIT_TOKEN_FAILED", message: "Failed to generate token" });
  }
};

// ---------------------------------------------------------------------------
// POST /calls/token — DEPRECATED: backward-compatible legacy endpoint
// ---------------------------------------------------------------------------
export const generateRtcToken = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { roomId, callType = "VOICE" } = req.body;

    if (!roomId) {
      return fail(res, 400, "Room ID is required");
    }

    console.warn("[Calls] /calls/token is deprecated — use /calls/:callId/token instead");

    const liveKitToken = await generateLiveKitRoomToken({
      roomId,
      identity: userId,
      name: req.user!.fullName,
    });

    if (liveKitToken) {
      return ok(res, {
        roomId,
        userId,
        callType,
        token: liveKitToken.token,
        serviceUrl: liveKitToken.serviceUrl,
        expiresIn: liveKitToken.expiresIn,
      });
    }

    const tokenSecret = process.env.JWT_ACCESS_SECRET;
    if (!tokenSecret) {
      return fail(res, 500, "Server misconfiguration: JWT access secret is not set");
    }
    const tokenPayload = `${userId}:${roomId}:${Date.now()}`;
    const token = crypto.createHmac("sha256", tokenSecret).update(tokenPayload).digest("hex");

    const serviceUrl = getCallServiceUrl() || `${req.protocol}://${req.get("host")}`;

    return ok(res, {
      roomId,
      userId,
      callType,
      token,
      serviceUrl,
      expiresIn: 3600,
    });
  } catch (error) {
    console.error("[Calls] generateRtcToken error:", error);
    return fail(res, 500, "Failed to generate RTC token");
  }
};
