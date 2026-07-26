import { Server, Socket } from "socket.io";
import { prisma } from "../config/index.js";
import { isUserBlocked } from "../helpers/safety.js";
import { CallType, CallStatus, MessageType } from "../../generated/prisma/client.js";

interface AuthenticatedSocket extends Socket {
  userId?: string;
}

// TODO: In-memory active call sessions are lost on server restart.
// Consider persisting to Redis or using a dedicated call state store
// for production reliability.
const activeCalls = new Map<
  string,
  { callLogId: string; callerId: string; receiverId: string; startedAt?: Date }
>();

export const registerCallSocketHandlers = (io: Server, socket: AuthenticatedSocket) => {
  const userId = socket.userId;
  if (!userId) return;

  /**
   * Initiate a Voice or Video Call
   */
  socket.on("call:initiate", async ({ receiverId, callType = "VOICE" }) => {
    try {
      if (!receiverId || typeof receiverId !== "string") {
        return socket.emit("call:error", { message: "Invalid receiver ID" });
      }

      if (receiverId === userId) {
        return socket.emit("call:error", { message: "You cannot call yourself" });
      }

      // Check if either user blocked the other
      if (await isUserBlocked(userId, receiverId)) {
        return socket.emit("call:error", { message: "Cannot place call. User is blocked." });
      }

      // Fetch caller details for incoming call UI banner
      const caller = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          fullName: true,
          email: true,
          profile: { select: { bio_profile_image_url: true, profileUrl: true } },
        },
      });

      if (!caller) {
        return socket.emit("call:error", { message: "Caller not found" });
      }

      const roomId = `call-${userId}-${receiverId}-${Date.now()}`;
      const type = callType === "VIDEO" ? CallType.VIDEO : CallType.VOICE;

      // Create initial CallLog record
      const callLog = await prisma.callLog.create({
        data: {
          callerId: userId,
          receiverId,
          callType: type,
          status: CallStatus.MISSED,
          roomId,
        },
      });

      activeCalls.set(roomId, {
        callLogId: callLog.id,
        callerId: userId,
        receiverId,
      });

      socket.join(roomId);

      const incomingPayload = {
        callLogId: callLog.id,
        roomId,
        callType: type,
        caller: {
          id: caller.id,
          fullName: caller.fullName,
          profileImage:
            caller.profile?.bio_profile_image_url || caller.profile?.profileUrl || null,
        },
      };

      // Emit incoming call to receiver's socket room
      io.to(`user:${receiverId}`).emit("call:incoming", incomingPayload);
      socket.emit("call:initiated", { callLogId: callLog.id, roomId, callType: type });
    } catch (error) {
      console.error("[CallSocket] call:initiate error:", error);
      socket.emit("call:error", { message: "Failed to initiate call" });
    }
  });

  /**
   * Accept an incoming call
   */
  socket.on("call:accept", async ({ callLogId, roomId }) => {
    try {
      const callSession = activeCalls.get(roomId);
      const now = new Date();

      if (callSession) {
        callSession.startedAt = now;
      }

      socket.join(roomId);

      if (callLogId) {
        await prisma.callLog.update({
          where: { id: callLogId },
          data: { startedAt: now },
        });
      }

      const callerId = callSession?.callerId;
      if (callerId) {
        io.to(`user:${callerId}`).emit("call:accepted", { callLogId, roomId, acceptedBy: userId });
      }

      io.to(roomId).emit("call:started", { roomId, startedAt: now });
    } catch (error) {
      console.error("[CallSocket] call:accept error:", error);
      socket.emit("call:error", { message: "Failed to accept call" });
    }
  });

  /**
   * Decline an incoming call
   */
  socket.on("call:decline", async ({ callLogId, roomId }) => {
    try {
      const callSession = activeCalls.get(roomId);

      if (callLogId) {
        await prisma.callLog.update({
          where: { id: callLogId },
          data: { status: CallStatus.DECLINED, endedAt: new Date() },
        });
      }

      const callerId = callSession?.callerId;
      if (callerId) {
        io.to(`user:${callerId}`).emit("call:declined", { callLogId, roomId, declinedBy: userId });
      }

      activeCalls.delete(roomId);
      socket.leave(roomId);
    } catch (error) {
      console.error("[CallSocket] call:decline error:", error);
    }
  });

  /**
   * End an ongoing call
   */
  socket.on("call:end", async ({ callLogId, roomId }) => {
    try {
      const callSession = activeCalls.get(roomId);
      const endedAt = new Date();

      let durationSec = 0;
      let callStatus: CallStatus = CallStatus.COMPLETED;

      if (callSession && callSession.startedAt) {
        durationSec = Math.round((endedAt.getTime() - callSession.startedAt.getTime()) / 1000);
      } else {
        callStatus = CallStatus.CANCELLED;
      }

      if (callLogId) {
        await prisma.callLog.update({
          where: { id: callLogId },
          data: {
            status: callStatus,
            endedAt,
            durationSec,
          },
        });
      }

      io.to(roomId).emit("call:ended", {
        callLogId,
        roomId,
        durationSec,
        endedBy: userId,
      });

      // Generate a Call Log chat bubble message in conversation if connected
      let callerId = callSession?.callerId;
      let receiverId = callSession?.receiverId;

      // Fallback: if activeCalls entry was lost (e.g. server restart), look up from DB
      if (!callerId && callLogId) {
        const callLog = await prisma.callLog.findUnique({
          where: { id: callLogId },
          select: { callerId: true, receiverId: true },
        });
        if (callLog) {
          callerId = callLog.callerId;
          receiverId = callLog.receiverId;
        }
      }

      if (!callerId || !receiverId) {
        console.warn("[CallSocket] Could not determine caller/receiver for call log message");
        activeCalls.delete(roomId);
        socket.leave(roomId);
        return;
      }

      if (callerId && receiverId) {
        const mins = Math.floor(durationSec / 60);
        const secs = durationSec % 60;
        const durationText = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        const logContent =
          callStatus === CallStatus.COMPLETED
            ? `📞 Call ended • ${durationText}`
            : `📞 Call ended`;

        const conversation = await prisma.conversation.findFirst({
          where: {
            AND: [{ participants: { has: callerId } }, { participants: { has: receiverId } }],
          },
        });

        if (conversation) {
          const callMessage = await prisma.message.create({
            data: {
              conversationId: conversation.id,
              senderId: callerId,
              receiverId,
              type: MessageType.CALL_LOG,
              content: logContent,
              mediaDuration: durationSec,
            },
          });

          io.to(`user:${callerId}`).emit("new_message", callMessage);
          io.to(`user:${receiverId}`).emit("new_message", callMessage);
        }
      }

      activeCalls.delete(roomId);
      socket.leave(roomId);
    } catch (error) {
      console.error("[CallSocket] call:end error:", error);
    }
  });

  /**
   * WebRTC Signaling Relay (Offer, Answer, ICE Candidates)
   */
  socket.on("call:signal", ({ targetUserId, signalData, roomId }) => {
    if (targetUserId && signalData) {
      io.to(`user:${targetUserId}`).emit("call:signal_received", {
        fromUserId: userId,
        signalData,
        roomId,
      });
    }
  });

  /**
   * Call Control State Changes (Mute toggle, Camera toggle, Speaker toggle)
   */
  socket.on("call:state_change", ({ targetUserId, roomId, isMuted, isVideoOff, isSpeakerOn }) => {
    if (targetUserId) {
      io.to(`user:${targetUserId}`).emit("call:peer_state_changed", {
        fromUserId: userId,
        roomId,
        isMuted,
        isVideoOff,
        isSpeakerOn,
      });
    }
  });
};
