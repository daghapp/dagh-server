import { Server, Socket } from "socket.io";
import { prisma } from "../config/index.js";
import jwt from "jsonwebtoken";

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

  io.on("connection", (socket: AuthenticatedSocket) => {
    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
    }

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
          select: { receiverId: true },
        });

        if (!message || message.receiverId !== socket.userId) return;

        await prisma.message.update({
          where: { id: messageId },
          data: { isRead: true, readAt: new Date() },
        });

        socket.to(`user:${message.receiverId}`).emit("message_read", { messageId });
      } catch (error) {
        console.error("[Socket] mark_read error:", error);
        socket.emit("error", { event: "mark_read", message: "Failed to mark message as read" });
      }
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      if (socket.userId) {
        socket.leave(`user:${socket.userId}`);
      }
    });
  });

  return io;
};
