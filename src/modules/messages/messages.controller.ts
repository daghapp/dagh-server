import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { Server } from "socket.io";
import { ok, created, fail } from "../../helpers/response.js";

let io: Server;

export const setIoInstance = (ioInstance: Server) => {
  io = ioInstance;
};

export const sendMessage = async (req: Request, res: Response) => {
  try {
    const senderId = req.user!.id;
    const { receiverId, content } = req.body;

    const message = await prisma.message.create({
      data: { senderId, receiverId, content },
      include: {
        sender: { select: { id: true, email: true } },
        receiver: { select: { id: true, email: true } },
      },
    });

    let conversation = await prisma.conversation.findFirst({
      where: {
        AND: [{ participants: { has: senderId } }, { participants: { has: receiverId } }],
      },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          participants: [senderId, receiverId],
          lastMessage: content,
          lastMessageAt: new Date(),
        },
      });
    } else {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessage: content, lastMessageAt: new Date() },
      });
    }

    if (io) {
      io.to(`user:${receiverId}`).emit("new_message", message);
      io.to(`user:${senderId}`).emit("message_sent", message);
    }

    return created(res, message);
  } catch (error) {
    console.error("Send message error:", error);
    return fail(res, 500, "Failed to send message");
  }
};

export const getConversations = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const conversations = await prisma.conversation.findMany({
      where: { participants: { has: userId } },
      orderBy: { lastMessageAt: "desc" },
    });

    const otherParticipantIds = conversations
      .map((conv) => conv.participants.find((p) => p !== userId) ?? "")
      .filter(Boolean);

    const [users, profiles] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: otherParticipantIds } },
        select: { id: true, email: true },
      }),
      prisma.userProfile.findMany({
        where: { userId: { in: otherParticipantIds } },
        select: { userId: true, profileUrl: true },
      }),
    ]);

    const userMap = new Map(users.map((u) => [u.id, u]));
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));

    const conversationsWithDetails = conversations.map((conv) => {
      const otherParticipantId = conv.participants.find((p) => p !== userId) ?? "";
      return {
        ...conv,
        otherUser: userMap.get(otherParticipantId) ?? null,
        profile: profileMap.get(otherParticipantId) ?? null,
      };
    });

    return ok(res, conversationsWithDetails);
  } catch (error) {
    console.error("Get conversations error:", error);
    return fail(res, 500, "Failed to fetch conversations");
  }
};

export const getMessages = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const conversationId = req.params.conversationId as string;

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, participants: { has: userId } },
    });

    if (!conversation) {
      return fail(res, 404, "Conversation not found");
    }

    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: userId, receiverId: { in: conversation.participants } },
          { receiverId: userId, senderId: { in: conversation.participants } },
        ],
      },
      orderBy: { createdAt: "asc" },
      include: {
        sender: { select: { id: true, email: true } },
        receiver: { select: { id: true, email: true } },
      },
    });

    await prisma.message.updateMany({
      where: { receiverId: userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    return ok(res, messages);
  } catch (error) {
    console.error("Get messages error:", error);
    return fail(res, 500, "Failed to fetch messages");
  }
};

export const markAsRead = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const messageId = req.params.messageId as string;

    const message = await prisma.message.update({
      where: { id: messageId, receiverId: userId },
      data: { isRead: true, readAt: new Date() },
    });

    return ok(res, message);
  } catch (_error) {
    return fail(res, 500, "Failed to mark message as read");
  }
};
