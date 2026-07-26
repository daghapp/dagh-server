import { Server, Socket } from "socket.io";
import { prisma } from "../config/index.js";
import jwt from "jsonwebtoken";
import { registerCallSocketHandlers } from "./callSocket.js";

interface AuthenticatedSocket extends Socket {
  userId?: string;
}

// Track online users in memory (userId -> set of socket IDs)
const onlineUsers = new Map<string, Set<string>>();

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

      // Manage presence
      if (!onlineUsers.has(userId)) {
        onlineUsers.set(userId, new Set());
      }
      onlineUsers.get(userId)!.add(socket.id);

      // Broadcast online status to connected peers
      io.emit("presence:status", { userId, isOnline: true });

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

    // Check user online status query
    socket.on("presence:check", ({ targetUserId }) => {
      const isOnline = onlineUsers.has(targetUserId) && onlineUsers.get(targetUserId)!.size > 0;
      socket.emit("presence:info", { userId: targetUserId, isOnline });
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      if (userId) {
        const userSockets = onlineUsers.get(userId);
        if (userSockets) {
          userSockets.delete(socket.id);
          if (userSockets.size === 0) {
            onlineUsers.delete(userId);
            io.emit("presence:status", { userId, isOnline: false, lastActiveAt: new Date() });

            prisma.user
              .update({
                where: { id: userId },
                data: { lastActiveAt: new Date() },
              })
              .catch((err) => console.error("[Socket] Failed to update lastActiveAt on disconnect:", err));
          }
        }
        socket.leave(`user:${userId}`);
      }
    });
  });

  return io;
};
