import { Server, Socket } from "socket.io";

interface AuthenticatedSocket extends Socket {
  userId?: string;
}

/**
 * Call signaling socket handlers.
 *
 * The call lifecycle (initiate, answer, decline, cancel, end) is now handled
 * by REST endpoints. Socket handlers here are limited to:
 *   - WebRTC signaling relay (SDP offers, answers, ICE candidates)
 *   - Mid-call controls (voice→video upgrade, mute/camera/speaker state)
 *
 * Server-initiated events (call.incoming, call.ringing, call.answered, etc.)
 * are emitted by the REST controllers via the shared io instance.
 */
export const registerCallSocketHandlers = (io: Server, socket: AuthenticatedSocket) => {
  const userId = socket.userId;
  if (!userId) return;

  /**
   * WebRTC Signaling Relay (Offer, Answer, ICE Candidates)
   * Used only when not using LiveKit's built-in signaling.
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
   * Mid-call upgrade: voice → video
   */
  socket.on("call:switch_video_request", ({ targetUserId, roomId }) => {
    if (targetUserId && roomId) {
      io.to(`user:${targetUserId}`).emit("call:switch_video_requested", {
        fromUserId: userId,
        roomId,
      });
    }
  });

  /**
   * Respond to mid-call video switch request (Accept / Decline)
   */
  socket.on("call:switch_video_respond", ({ targetUserId, roomId, accepted }) => {
    if (targetUserId && roomId) {
      io.to(`user:${targetUserId}`).emit("call:switch_video_responded", {
        fromUserId: userId,
        roomId,
        accepted,
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
