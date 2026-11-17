import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { Server } from "socket.io";
import { ok, created, fail } from "../../helpers/response.js";
import { isUserBlocked } from "../../helpers/safety.js";
import { MessageType } from "../../../generated/prisma/client.js";
import { dispatchNotificationOutbox } from "../../helpers/pushNotifications.js";

let io: Server;

export const setIoInstance = (ioInstance: Server) => {
  io = ioInstance;
};

export const getIoInstance = (): Server | undefined => {
  return io;
};

/**
 * Send a text or media message.
 * Writes the message, conversation update, and push outbox rows atomically,
 * then returns the created message. Push delivery runs as a fire-and-forget
 * best-effort dispatch after commit; the cron worker is the durable fallback.
 */
export const sendMessage = async (req: Request, res: Response) => {
  try {
    const senderId = req.user!.id;
    const {
      receiverId,
      content,
      type = "TEXT",
      mediaUrl,
      mediaDuration,
      ciphertext,
      nonce,
      aad,
      encryptionVersion,
    } = req.body;
    if (await isUserBlocked(senderId, receiverId)) {
      return fail(res, 403, "Cannot send message. Communication is blocked between users.");
    }

    const encrypted = encryptionVersion !== undefined && encryptionVersion !== null;
    const previewContent = encrypted
      ? "🔒 Encrypted message"
      : type === "VOICE_NOTE"
        ? "🎵 Voice message"
        : type === "IMAGE"
          ? "📷 Photo"
          : type === "VIDEO"
            ? "🎥 Video"
            : content || "Media message";

    const result = await prisma.$transaction(async (tx) => {
      let conversation = await tx.conversation.findFirst({
        where: {
          AND: [{ participants: { has: senderId } }, { participants: { has: receiverId } }],
        },
      });

      if (!conversation) {
        conversation = await tx.conversation.create({
          data: {
            participants: [senderId, receiverId],
            lastMessage: previewContent,
            lastMessageAt: new Date(),
          },
        });
      } else {
        await tx.conversation.update({
          where: { id: conversation.id },
          data: { lastMessage: previewContent, lastMessageAt: new Date() },
        });
      }

      const message = await tx.message.create({
        data: {
          conversationId: conversation.id,
          senderId,
          receiverId,
          content: encrypted ? null : content || null,
          ciphertext: ciphertext || null,
          nonce: nonce || null,
          aad: aad || null,
          encryptionVersion: encrypted ? Number(encryptionVersion) : null,
          type: type as MessageType,
          mediaUrl: mediaUrl || null,
          mediaDuration: mediaDuration ? Number(mediaDuration) : null,
        },
        include: {
          sender: {
            select: {
              id: true,
              fullName: true,
              email: true,
              profile: { select: { bio_profile_image_url: true, profileUrl: true } },
            },
          },
          receiver: {
            select: {
              id: true,
              fullName: true,
              email: true,
              profile: { select: { bio_profile_image_url: true, profileUrl: true } },
            },
          },
        },
      });

      await tx.notificationOutbox.create({
        data: {
          eventType: "MESSAGE_CREATED",
          aggregateId: message.id,
          recipientUserId: receiverId,
          payload: {
            messageId: message.id,
            conversationId: conversation.id,
            senderId,
          },
        },
      });

      return { message, conversationId: conversation.id };
    });

    const { message } = result;

    if (io) {
      io.to(`user:${receiverId}`).emit("new_message", message);
      io.to(`user:${senderId}`).emit("message_sent", message);
    }

    // Best-effort immediate dispatch of the outbox
    dispatchNotificationOutbox().catch((error) => {
      console.error("[outbox] fast dispatch error:", error);
    });

    return created(res, { ...message, notification: { status: "QUEUED" } });
  } catch (error) {
    console.error("Send message error:", error);
    return fail(res, 500, "Failed to send message");
  }
};

/**
 * Upload and send a Voice Note audio message.
 * Writes the message, conversation update, and push outbox rows atomically,
 * then returns the created message.
 */
export const sendVoiceNote = async (req: Request, res: Response) => {
  try {
    const senderId = req.user!.id;
    const { receiverId, mediaDuration } = req.body;

    if (!req.file || !req.file.path) {
      return fail(res, 400, "Voice note audio file is required");
    }

    if (await isUserBlocked(senderId, receiverId)) {
      return fail(res, 403, "Cannot send voice note. User is blocked.");
    }

    const audioUrl = req.file.path;
    const duration = mediaDuration ? parseInt(mediaDuration, 10) : 0;
    const previewText = "🎵 Voice message";

    const result = await prisma.$transaction(async (tx) => {
      let conversation = await tx.conversation.findFirst({
        where: {
          AND: [{ participants: { has: senderId } }, { participants: { has: receiverId } }],
        },
      });

      if (!conversation) {
        conversation = await tx.conversation.create({
          data: {
            participants: [senderId, receiverId],
            lastMessage: previewText,
            lastMessageAt: new Date(),
          },
        });
      } else {
        await tx.conversation.update({
          where: { id: conversation.id },
          data: { lastMessage: previewText, lastMessageAt: new Date() },
        });
      }

      const message = await tx.message.create({
        data: {
          conversationId: conversation.id,
          senderId,
          receiverId,
          type: MessageType.VOICE_NOTE,
          content: previewText,
          mediaUrl: audioUrl,
          mediaDuration: duration,
        },
        include: {
          sender: {
            select: {
              id: true,
              fullName: true,
              email: true,
              profile: { select: { bio_profile_image_url: true, profileUrl: true } },
            },
          },
          receiver: {
            select: {
              id: true,
              fullName: true,
              email: true,
              profile: { select: { bio_profile_image_url: true, profileUrl: true } },
            },
          },
        },
      });

      await tx.notificationOutbox.create({
        data: {
          eventType: "MESSAGE_CREATED",
          aggregateId: message.id,
          recipientUserId: receiverId,
          payload: {
            messageId: message.id,
            conversationId: conversation.id,
            senderId,
          },
        },
      });

      return { message, conversationId: conversation.id };
    });

    const { message } = result;

    if (io) {
      io.to(`user:${receiverId}`).emit("new_message", message);
      io.to(`user:${senderId}`).emit("message_sent", message);
    }

    dispatchNotificationOutbox().catch((error) => {
      console.error("[outbox] fast dispatch error:", error);
    });

    return created(res, { ...message, notification: { status: "QUEUED" } });
  } catch (error) {
    console.error("Send voice note error:", error);
    return fail(res, 500, "Failed to send voice note");
  }
};

/**
 * Get active matches ("New Matches" section)
 * TODO: No endpoint exists to create UserMatch records. Add a matching/swipe
 * feature or remove this endpoint if matches are created externally.
 */
export const getNewMatches = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const matches = await prisma.userMatch.findMany({
      where: {
        OR: [{ userId }, { matchedId: userId }],
        status: "MATCHED",
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            profile: { select: { bio_profile_image_url: true, profileUrl: true } },
          },
        },
        matched: {
          select: {
            id: true,
            fullName: true,
            email: true,
            profile: { select: { bio_profile_image_url: true, profileUrl: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const formattedMatches = matches.map((m) => {
      const isSelfUser = m.userId === userId;
      const targetUser = isSelfUser ? m.matched : m.user;
      return {
        matchId: m.id,
        createdAt: m.createdAt,
        user: targetUser,
      };
    });

    return ok(res, formattedMatches);
  } catch (error) {
    console.error("Get matches error:", error);
    return fail(res, 500, "Failed to fetch matches");
  }
};

/**
 * Get all conversations for current user with details & unread badge count
 */
export const getConversations = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    // Get list of blocked user IDs
    const blocks = await prisma.userBlock.findMany({
      where: {
        OR: [{ blockerId: userId }, { blockedId: userId }],
      },
      take: 500,
    });

    const blockedUserIds = new Set(
      blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)),
    );

    const conversations = await prisma.conversation.findMany({
      where: { participants: { has: userId } },
      orderBy: { lastMessageAt: "desc" },
      take: 100,
    });

    const filteredConversations = conversations.filter((conv) => {
      const otherId = conv.participants.find((p) => p !== userId) ?? "";
      return !blockedUserIds.has(otherId);
    });

    const otherParticipantIds = filteredConversations
      .map((conv) => conv.participants.find((p) => p !== userId) ?? "")
      .filter(Boolean);

    const [users, profiles] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: otherParticipantIds } },
        select: { id: true, fullName: true, email: true, lastActiveAt: true },
      }),
      prisma.userProfile.findMany({
        where: { userId: { in: otherParticipantIds } },
        select: { userId: true, profileUrl: true, bio_profile_image_url: true },
      }),
    ]);

    const conversationIds = filteredConversations.map((c) => c.id);

    const unreadCounts = await prisma.message.groupBy({
      by: ["conversationId"],
      where: {
        conversationId: { in: conversationIds },
        receiverId: userId,
        isRead: false,
      },
      _count: { id: true },
    });

    const unreadMap = new Map(unreadCounts.map((row) => [row.conversationId, row._count.id]));

    const userMap = new Map(users.map((u) => [u.id, u]));
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));

    const conversationsWithDetails = filteredConversations.map((conv) => {
      const otherParticipantId = conv.participants.find((p) => p !== userId) ?? "";
      return {
        ...conv,
        unreadCount: unreadMap.get(conv.id) ?? 0,
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

/**
 * Get all messages in a conversation
 */
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
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: 200,
      include: {
        sender: {
          select: {
            id: true,
            fullName: true,
            email: true,
            profile: { select: { bio_profile_image_url: true, profileUrl: true } },
          },
        },
        receiver: {
          select: {
            id: true,
            fullName: true,
            email: true,
            profile: { select: { bio_profile_image_url: true, profileUrl: true } },
          },
        },
      },
    });

    // Mark unread messages received by current user as read
    await prisma.message.updateMany({
      where: { conversationId, receiverId: userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    return ok(res, messages);
  } catch (error) {
    console.error("Get messages error:", error);
    return fail(res, 500, "Failed to fetch messages");
  }
};

/**
 * Mark a single message as read
 */
export const markAsRead = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const messageId = req.params.messageId as string;

    const existing = await prisma.message.findUnique({
      where: { id: messageId },
      select: { receiverId: true },
    });

    if (!existing) {
      return fail(res, 404, "Message not found");
    }

    if (existing.receiverId !== userId) {
      return fail(res, 403, "You are not the receiver of this message");
    }

    const message = await prisma.message.update({
      where: { id: messageId, receiverId: userId },
      data: { isRead: true, readAt: new Date() },
    });

    return ok(res, message);
  } catch (_error) {
    return fail(res, 500, "Failed to mark message as read");
  }
};

/**
 * Block a user ("REPORT & BLOCK")
 */
export const blockUser = async (req: Request, res: Response) => {
  try {
    const blockerId = req.user!.id;
    const { blockedId } = req.body;

    if (blockerId === blockedId) {
      return fail(res, 400, "You cannot block yourself");
    }

    const block = await prisma.userBlock.upsert({
      where: {
        blockerId_blockedId: { blockerId, blockedId },
      },
      create: { blockerId, blockedId },
      update: {},
    });

    return created(res, block, "User blocked successfully");
  } catch (error) {
    console.error("Block user error:", error);
    return fail(res, 500, "Failed to block user");
  }
};

/**
 * Unblock a user
 */
export const unblockUser = async (req: Request, res: Response) => {
  try {
    const blockerId = req.user!.id;
    const { blockedId } = req.params;

    await prisma.userBlock.deleteMany({
      where: { blockerId, blockedId: blockedId as string },
    });

    return ok(res, null, "User unblocked successfully");
  } catch (error) {
    console.error("Unblock user error:", error);
    return fail(res, 500, "Failed to unblock user");
  }
};

/**
 * Report a user ("SAFETY TIPS & REPORT")
 */
export const reportUser = async (req: Request, res: Response) => {
  try {
    const reporterId = req.user!.id;
    const { targetId, reason, details } = req.body;

    if (reporterId === targetId) {
      return fail(res, 400, "You cannot report yourself");
    }

    const report = await prisma.userReport.create({
      data: {
        reporterId,
        targetId,
        reason,
        details: details || null,
      },
    });

    return created(res, report, "User reported successfully");
  } catch (error) {
    console.error("Report user error:", error);
    return fail(res, 500, "Failed to report user");
  }
};
