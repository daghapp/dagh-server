import { Server, Socket } from "socket.io";
import { prisma } from "../config/index.js";
import jwt from "jsonwebtoken";
import { registerCallSocketHandlers } from "./callSocket.js";
import {
  markOnline,
  markOffline,
  isOnline,
  getPresenceAudience,
} from "../helpers/presence.js";

interface AuthenticatedSocket extends Socket {
  userId?: string;
}

export const setupSocketHandlers = (io: Server) => {
  // Authentication middleware for Socket.IO
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error("Authentication required"));
      }

      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as jwt.JwtPayload;
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
      });

      if (!user) {
        return next(new Error("User not found"));
      }

      socket.userId = user.id;
      next();
    } catch (_error) {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", async (socket: AuthenticatedSocket) => {
    const userId = socket.userId;

    if (userId) {
      socket.join(`user:${userId}`);

      // Track presence (local map + Redis when available)
      await markOnline(userId, socket.id);

      // Notify only the user's conversation partners & matches, not every
      // connected client, and fire-and-forget the DB touch.
      getPresenceAudience(userId).then((peers) => {
        for (const peerId of peers) {
          io.to(`user:${peerId}`).emit("presence:status", { userId, isOnline: true });
        }
      });

      // Update user last active timestamp in background
      prisma.user
        .update({
          where: { id: userId },
          data: { lastActiveAt: new Date() },
        })
        .catch((err) => console.error("[Socket] Failed to update lastActiveAt:", err));
    }

    // Register Call & WebRTC signaling handlers
    registerCallSocketHandlers(io, socket);

    // Handle typing events
    socket.on("typing", ({ receiverId, isTyping }) => {
      if (typeof receiverId !== "string" || !receiverId) return;
      socket.to(`user:${receiverId}`).emit("user_typing", {
        userId: socket.userId,
        isTyping,
      });
    });

    // Handle message read receipts
    socket.on("mark_read", async ({ messageId }) => {
      try {
        if (!socket.userId || typeof messageId !== "string" || !messageId) return;

        const message = await prisma.message.findUnique({
          where: { id: messageId },
          select: { receiverId: true, conversationId: true },
        });

        if (!message || message.receiverId !== socket.userId) return;

        await prisma.message.update({
          where: { id: messageId },
          data: { isRead: true, readAt: new Date() },
        });

        socket.to(`user:${message.receiverId}`).emit("message_read", {
          messageId,
          conversationId: message.conversationId,
        });
      } catch (error) {
        console.error("[Socket] mark_read error:", error);
        socket.emit("error", { event: "mark_read", message: "Failed to mark message as read" });
      }
    });

    // Check user online status query (Redis-backed, so it works across instances)
    socket.on("presence:check", async ({ targetUserId }) => {
      const online = await isOnline(targetUserId);
      socket.emit("presence:info", { userId: targetUserId, isOnline: online });
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      if (userId) {
        markOffline(userId, socket.id).then((wentOffline) => {
          if (wentOffline) {
            getPresenceAudience(userId).then((peers) => {
              for (const peerId of peers) {
                io.to(`user:${peerId}`).emit("presence:status", {
                  userId,
                  isOnline: false,
                  lastActiveAt: new Date(),
                });
              }
            });
          }
        });

        socket.leave(`user:${userId}`);

        prisma.user
          .update({
            where: { id: userId },
            data: { lastActiveAt: new Date() },
          })
          .catch((err) =>
            console.error("[Socket] Failed to update lastActiveAt on disconnect:", err),
          );
      }
    });
  });

  return io;
};
