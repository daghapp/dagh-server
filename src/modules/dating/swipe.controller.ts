import { Request, Response } from "express";
import { Server } from "socket.io";
import { prisma } from "../../config/index.js";
import { ok, created, fail } from "../../helpers/response.js";
import { isUserBlocked } from "../../helpers/safety.js";
import { getDiscoveryCandidates } from "../../services/matching.service.js";
import type { SwipeDirection } from "../../../generated/prisma/enums.js";

// ─────────────────────────────────────────
// Super-like daily limits by membership tier
// ─────────────────────────────────────────
const SUPER_LIKE_DAILY_LIMITS: Record<string, number> = {
  FREE: 1,
  BASELINE: 2,
  SENIOR_PIONEER: 3,
  SANKOFA_SETTLED: 3,
  BASIC: 3,
  SILVER: 5,
  GOLD_INVESTOR: 10,
  ELITE_AMBASSADOR: 20,
  FAMILY_PLAN: 5,
};

function getSuperLikeDailyLimit(tierCode: string | null | undefined): number {
  if (!tierCode) return SUPER_LIKE_DAILY_LIMITS.FREE;
  return SUPER_LIKE_DAILY_LIMITS[tierCode] ?? SUPER_LIKE_DAILY_LIMITS.FREE;
}

// ─────────────────────────────────────────
// Swipe / matches controller
// ─────────────────────────────────────────

let io: Server;

export const setIoInstance = (ioInstance: Server) => {
  io = ioInstance;
};

const getIo = (): Server | undefined => io;

const matchUserInclude = {
  user: {
    select: {
      id: true,
      fullName: true,
      email: true,
      profile: { select: { bio_profile_image_url: true, profileUrl: true } },
      datingProfile: {
        select: { headline: true, about: true, photos: true, interests: true, lookingFor: true },
      },
    },
  },
  matched: {
    select: {
      id: true,
      fullName: true,
      email: true,
      profile: { select: { bio_profile_image_url: true, profileUrl: true } },
      datingProfile: {
        select: { headline: true, about: true, photos: true, interests: true, lookingFor: true },
      },
    },
  },
} as const;

/**
 * Record a swipe. A LIKE/SUPER_LIKE creates a mutual match when the target
 * has already liked the swiper.
 */
export const recordSwipe = async (req: Request, res: Response) => {
  try {
    const swiperId = req.user!.id;
    const { targetId, direction } = req.body as {
      targetId: string;
      direction: SwipeDirection;
    };

    if (swiperId === targetId) {
      return fail(res, 400, "You cannot swipe on yourself");
    }

    if (await isUserBlocked(swiperId, targetId)) {
      return fail(res, 403, "Cannot swipe on this user");
    }

    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, datingProfile: { select: { id: true } } },
    });

    if (!target || !target.datingProfile) {
      return fail(res, 404, "Target user has no dating profile");
    }

    const existing = await prisma.userSwipe.findUnique({
      where: { swiperId_targetId: { swiperId, targetId } },
    });

    if (existing) {
      if (existing.direction === direction) {
        return ok(res, { swipe: existing, match: null }, "Swipe already recorded");
      }
      return fail(res, 409, { code: "ALREADY_SWIPED", message: "You have already swiped on this user" });
    }

    // Enforce daily super-like limit based on membership tier.
    if (direction === "SUPER_LIKE") {
      const swiper = await prisma.user.findUnique({
        where: { id: swiperId },
        select: {
          subscription: { select: { tierCode: true } },
        },
      });

      const dailyLimit = getSuperLikeDailyLimit(swiper?.subscription?.tierCode);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const superLikeCount = await prisma.userSwipe.count({
        where: {
          swiperId,
          direction: "SUPER_LIKE",
          createdAt: { gte: todayStart },
        },
      });

      if (superLikeCount >= dailyLimit) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        return fail(
          res,
          429,
          "Daily super-like limit reached. Upgrade your plan for more.",
          {
            code: "SUPER_LIKE_LIMIT_EXCEEDED",
            limit: dailyLimit,
            used: superLikeCount,
            resetAt: tomorrow.toISOString(),
          },
        );
      }
    }

    const swipe = await prisma.userSwipe.create({
      data: { swiperId, targetId, direction },
    });

    let match = null;

    // Mutual match: target previously liked this user and current swipe is positive.
    if (direction !== "PASS") {
      const reciprocal = await prisma.userSwipe.findUnique({
        where: { swiperId_targetId: { swiperId: targetId, targetId: swiperId } },
      });

      if (reciprocal && reciprocal.direction !== "PASS") {
        match = await prisma.userMatch.create({
          data: { userId: swiperId, matchedId: targetId, status: "MATCHED" },
          include: matchUserInclude,
        });

        // Reuse the conversations table so matched users can chat immediately.
        const existingConversation = await prisma.conversation.findFirst({
          where: {
            AND: [{ participants: { has: swiperId } }, { participants: { has: targetId } }],
          },
        });

        if (!existingConversation) {
          await prisma.conversation.create({
            data: { participants: [swiperId, targetId] },
          });
        }

        const socket = getIo();
        if (socket) {
          socket.to(`user:${swiperId}`).emit("match:mutual", { match });
          socket.to(`user:${targetId}`).emit("match:mutual", { match });
        }
      } else {
        // No mutual match yet — notify the target they received a like.
        const socket = getIo();
        if (socket) {
          socket.to(`user:${targetId}`).emit("match:incoming", { swiperId, direction });
        }
      }
    }

    return created(res, { swipe, match });
  } catch (error) {
    console.error("Record swipe error:", error);
    return fail(res, 500, "Failed to record swipe");
  }
};

export const getRecommendations = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(limitRaw, 50) : 20;
    const offsetRaw = Number(req.query.offset);
    const offset = Number.isFinite(offsetRaw) ? offsetRaw : 0;

    const result = await getDiscoveryCandidates(userId, { limit, offset });

    const targetIds = result.candidates.map((c) => c.userId);

    const [swipes, matches, blocks] = await Promise.all([
      prisma.userSwipe.findMany({
        where: {
          OR: [
            { swiperId: userId, targetId: { in: targetIds } },
            { swiperId: { in: targetIds }, targetId: userId }
          ]
        }
      }),
      prisma.userMatch.findMany({
        where: {
          OR: [
            { userId, matchedId: { in: targetIds } },
            { userId: { in: targetIds }, matchedId: userId }
          ],
          status: "MATCHED"
        }
      }),
      prisma.userBlock.findMany({
        where: {
          OR: [
            { blockerId: userId, blockedId: { in: targetIds } },
            { blockerId: { in: targetIds }, blockedId: userId }
          ]
        },
        select: { blockerId: true, blockedId: true }
      })
    ]);

    const blockedIds = new Set(
      blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId))
    );

    const enriched = result.candidates
      .filter((c) => !blockedIds.has(c.userId))
      .map((c) => {
        let relationshipStatus = "NONE";
        let canSendInterest = true;

        const isMatched = matches.some((m) => m.userId === c.userId || m.matchedId === c.userId);
        if (isMatched) {
          relationshipStatus = "MATCHED";
          canSendInterest = false;
        } else {
          const outgoing = swipes.find((s) => s.swiperId === userId && s.targetId === c.userId);
          const incoming = swipes.find((s) => s.swiperId === c.userId && s.targetId === userId);

          if (outgoing && outgoing.direction !== "PASS") {
            relationshipStatus = "INTEREST_SENT";
            canSendInterest = false;
          } else if (incoming && incoming.direction !== "PASS") {
            relationshipStatus = "INTEREST_RECEIVED";
          } else if (outgoing && outgoing.direction === "PASS") {
            relationshipStatus = "PASSED";
            canSendInterest = false;
          } else if (incoming && incoming.direction === "PASS") {
            relationshipStatus = "NONE";
          }
        }

        return { ...c, relationshipStatus, canSendInterest };
      });

    return ok(res, enriched);
  } catch (error) {
    console.error("Get recommendations error:", error);
    return fail(res, 500, "Failed to fetch recommendations");
  }
};

/**
 * Get all active matches for the current user.
 */
export const getMyMatches = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const matches = await prisma.userMatch.findMany({
      where: {
        OR: [{ userId }, { matchedId: userId }],
        status: "MATCHED",
      },
      include: matchUserInclude,
      orderBy: { createdAt: "desc" },
    });

    const formatted = matches.map((m) => {
      const isSelfUser = m.userId === userId;
      const other = isSelfUser ? m.matched : m.user;
      return {
        matchId: m.id,
        createdAt: m.createdAt,
        user: other,
      };
    });

    return ok(res, formatted);
  } catch (error) {
    console.error("Get matches error:", error);
    return fail(res, 500, "Failed to fetch matches");
  }
};

/**
 * List users who liked the current user (potential matches awaiting a response).
 * FREE tier users receive only a count; paid-tier users see the full list.
 * Response shape is always { count: number, profiles: Profile[] } for consistency.
 */
export const getLikesReceived = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscription: { select: { tierCode: true } } },
    });

    const tierCode = user?.subscription?.tierCode ?? "FREE";
    const isPaidTier = tierCode !== "FREE";

    const likes = await prisma.userSwipe.findMany({
      where: {
        targetId: userId,
        direction: { in: ["LIKE", "SUPER_LIKE"] },
      },
      select: isPaidTier
        ? {
            swiper: {
              select: {
                id: true,
                fullName: true,
                profile: { select: { bio_profile_image_url: true, profileUrl: true } },
                datingProfile: { select: { headline: true, photos: true } },
              },
            },
          }
        : { id: true },
    });

    return ok(res, {
      count: likes.length,
      profiles: isPaidTier
        ? likes.map((l) => (l as { swiper: unknown }).swiper)
        : [],
    });
  } catch (error) {
    console.error("Get likes received error:", error);
    return fail(res, 500, "Failed to fetch likes received");
  }
};

/**
 * Unmatch a user (soft-remove the match record).
 */
export const unmatchUser = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const matchId = req.params.matchId as string;

    const match = await prisma.userMatch.findFirst({
      where: {
        id: matchId,
        OR: [{ userId }, { matchedId: userId }],
      },
    });

    if (!match) {
      return fail(res, 404, "Match not found");
    }

    await prisma.userMatch.update({
      where: { id: match.id },
      data: { status: "UNMATCHED" },
    });

    return ok(res, null, "Unmatched successfully");
  } catch (error) {
    console.error("Unmatch error:", error);
    return fail(res, 500, "Failed to unmatch");
  }
};

export const getLikesSent = async (req: Request, res: Response) => {
  try {
    const swiperId = req.user!.id;
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 20;
    const cursor = req.query.cursor as string | undefined;

    const items = await prisma.userSwipe.findMany({
      where: {
        swiperId,
        direction: { in: ["LIKE", "SUPER_LIKE"] },
      },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        targetId: true,
        direction: true,
        createdAt: true,
        target: {
          select: {
            id: true,
            fullName: true,
            datingProfile: { select: { photos: true } }
          }
        }
      }
    });

    const hasNext = items.length > limit;
    if (hasNext) items.pop();

    const targetIds = items.map((i) => i.targetId);
    const matches = await prisma.userMatch.findMany({
      where: {
        OR: [
          { userId: swiperId, matchedId: { in: targetIds } },
          { userId: { in: targetIds }, matchedId: swiperId }
        ],
        status: "MATCHED"
      },
      select: { userId: true, matchedId: true }
    });

    const matchSet = new Set(matches.map((m) => (m.userId === swiperId ? m.matchedId : m.userId)));

    const formatted = items.map((i) => {
      let status = "PENDING";
      if (matchSet.has(i.targetId)) status = "MATCHED";

      return {
        id: i.id,
        targetUserId: i.targetId,
        direction: i.direction,
        status,
        createdAt: i.createdAt,
        targetUser: {
          id: i.targetId,
          profile: {
            fullName: i.target.fullName,
            photos: i.target.datingProfile?.photos || []
          }
        }
      };
    });

    return ok(
      res,
      {
        items: formatted,
        nextCursor: hasNext && items.length > 0 ? items[items.length - 1].id : null
      },
      "Sent interests retrieved successfully."
    );
  } catch (error) {
    console.error("Get likes sent error:", error);
    return fail(res, 500, "Failed to retrieve sent interests");
  }
};

export const getRelationshipStatus = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const targetId = req.params.userId as string;

    const [swipes, matches] = await Promise.all([
      prisma.userSwipe.findMany({
        where: {
          OR: [
            { swiperId: userId, targetId },
            { swiperId: targetId, targetId: userId }
          ]
        }
      }),
      prisma.userMatch.findMany({
        where: {
          OR: [
            { userId, matchedId: targetId },
            { userId: targetId, matchedId: userId }
          ],
          status: "MATCHED"
        }
      })
    ]);

    let relationshipStatus = "NONE";
    let canSendInterest = true;
    let interestId: string | undefined;
    let sentAt: Date | undefined;

    if (matches.length > 0) {
      relationshipStatus = "MATCHED";
      canSendInterest = false;
    } else {
      const outgoing = swipes.find((s) => s.swiperId === userId && s.targetId === targetId);
      const incoming = swipes.find((s) => s.swiperId === targetId && s.targetId === userId);

      if (outgoing && outgoing.direction !== "PASS") {
        relationshipStatus = "INTEREST_SENT";
        canSendInterest = false;
        interestId = outgoing.id;
        sentAt = outgoing.createdAt;
      } else if (incoming && incoming.direction !== "PASS") {
        relationshipStatus = "INTEREST_RECEIVED";
      } else if (outgoing && outgoing.direction === "PASS") {
        relationshipStatus = "PASSED";
        canSendInterest = false;
      } else if (incoming && incoming.direction === "PASS") {
        relationshipStatus = "NONE";
      }
    }

    return ok(res, {
      userId: targetId,
      relationshipStatus,
      canSendInterest,
      ...(interestId && { interestId }),
      ...(sentAt && { sentAt })
    });
  } catch (error) {
    console.error("Get relationship status error:", error);
    return fail(res, 500, "Failed to get relationship status");
  }
};
