import { Request, Response } from "express";
import { Server } from "socket.io";
import { prisma } from "../../config/index.js";
import { ok, created, fail } from "../../helpers/response.js";
import { isUserBlocked } from "../../helpers/safety.js";
import { getEffectiveAccess } from "../../helpers/membership.js";
import {
  getDiscoveryCandidates,
  resolveTourTravelContext,
} from "../../services/matching.service.js";
import {
  requireKYCVerification,
  KYCVerificationError,
} from "../../services/kyc-verification.service.js";
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

    try {
      await requireKYCVerification(swiperId);
    } catch (error) {
      if (error instanceof KYCVerificationError) {
        return fail(
          res,
          error.statusCode,
          {
            code: error.code,
            message: error.message,
            nextStep: error.currentStep,
            completedSteps: error.details.completedSteps,
            requiredSteps: error.details.requiredSteps,
          },
          { action: "COMPLETE_VERIFICATION", redirect: "/verification" },
        );
      }
      throw error;
    }

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
      return fail(res, 409, {
        code: "ALREADY_SWIPED",
        message: "You have already swiped on this user",
      });
    }

    // Enforce daily super-like limit based on membership tier.
    if (direction === "SUPER_LIKE") {
      // Resolves through getEffectiveAccess rather than reading user_subscriptions
      // directly, for the same reason as getLikesReceived below: reading the row
      // silently denies a comped user their tier, and denies every user the
      // free-mode tier, leaving them on the FREE limit (1/day) for the whole
      // outage even though free mode is meant to open the app up.
      const access = await getEffectiveAccess(swiperId);
      const dailyLimit = getSuperLikeDailyLimit(access.perksTierCode);
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

        return fail(res, 429, "Daily super-like limit reached. Upgrade your plan for more.", {
          code: "SUPER_LIKE_LIMIT_EXCEEDED",
          limit: dailyLimit,
          used: superLikeCount,
          resetAt: tomorrow.toISOString(),
        });
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

    // Step 2 — KYC gate: the dating module is only available to verified users.
    try {
      await requireKYCVerification(userId);
    } catch (error) {
      if (error instanceof KYCVerificationError) {
        return fail(
          res,
          error.statusCode,
          {
            code: error.code,
            message: error.message,
            nextStep: error.currentStep,
            completedSteps: error.details.completedSteps,
            requiredSteps: error.details.requiredSteps,
          },
          { action: "COMPLETE_VERIFICATION", redirect: "/verification" },
        );
      }
      throw error;
    }

    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(limitRaw, 50) : 20;
    const offsetRaw = Number(req.query.offset);
    const offset = Number.isFinite(offsetRaw) ? offsetRaw : 0;

    // Step 3 — Travel context: derive the trip geofence + schedule window from a
    // tour request when provided, so recommendations are filtered to compatible
    // travelers overlapping the same location and window.
    let travel: Awaited<ReturnType<typeof resolveTourTravelContext>> | null = null;
    const tourRequestId =
      typeof req.query.tourRequestId === "string" ? req.query.tourRequestId : "";
    if (tourRequestId) {
      try {
        travel = await resolveTourTravelContext(tourRequestId, userId);
      } catch (error) {
        const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
        if (code === "TOUR_REQUEST_NOT_FOUND") return fail(res, 404, "Tour request not found.");
        if (code === "FORBIDDEN")
          return fail(res, 403, "This tour request does not belong to you.");
        console.error("Get recommendations travel context error:", error);
        return fail(res, 400, "Invalid tour request.");
      }
    }

    const contactsOnly = req.query.contactsOnly === "true" || req.query.contactsOnly === "1";

    const result = await getDiscoveryCandidates(userId, {
      limit,
      offset,
      travel,
      contactsOnly,
    });

    // Assign curated stacks to candidates
    const stackTypeMap: Record<string, "MOST_COMPATIBLE" | "NEW_PROFILES" | "NONE"> = {};
    const candidates = result.candidates;
    // First 3 are "Most Compatible" (highest scored)
    for (let i = 0; i < Math.min(3, candidates.length); i++) {
      stackTypeMap[candidates[i].userId] = "MOST_COMPATIBLE";
    }
    // Last 1-2 are "New Profiles" (if available)
    const newProfileCount = Math.min(2, candidates.length - 3);
    for (let i = candidates.length - newProfileCount; i < candidates.length; i++) {
      if (stackTypeMap[candidates[i].userId] !== "MOST_COMPATIBLE") {
        stackTypeMap[candidates[i].userId] = "NEW_PROFILES";
      }
    }
    // Rest are normal
    for (let i = 0; i < candidates.length; i++) {
      if (!stackTypeMap[candidates[i].userId]) {
        stackTypeMap[candidates[i].userId] = "NONE";
      }
    }

    const targetIds = result.candidates.map((c) => c.userId);

    const [swipes, matches, blocks] = await Promise.all([
      prisma.userSwipe.findMany({
        where: {
          OR: [
            { swiperId: userId, targetId: { in: targetIds } },
            { swiperId: { in: targetIds }, targetId: userId },
          ],
        },
        take: 200,
      }),
      prisma.userMatch.findMany({
        where: {
          OR: [
            { userId, matchedId: { in: targetIds } },
            { userId: { in: targetIds }, matchedId: userId },
          ],
          status: "MATCHED",
        },
        take: 200,
      }),
      prisma.userBlock.findMany({
        where: {
          OR: [
            { blockerId: userId, blockedId: { in: targetIds } },
            { blockerId: { in: targetIds }, blockedId: userId },
          ],
        },
        take: 200,
      }),
    ]);

    const blockedIds = new Set(
      blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)),
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
            canSendInterest = false;
          } else if (outgoing && outgoing.direction === "PASS") {
            relationshipStatus = "PASSED";
            canSendInterest = false;
          } else if (incoming && incoming.direction === "PASS") {
            relationshipStatus = "NONE";
          }
        }

        const photoCount = c.photos?.length || 0;
        const isPrimary = photoCount > 0 && c.profileImage === c.photos[0];

        // Build "Why this profile?" reasons from available candidate data
        const reasons: string[] = [];

        // Familiarity indicator (matched from the viewer's synced contacts)
        if (c.isContactMatch) {
          reasons.push("In your contacts");
        }

        // Interest indicator
        if (c.interests?.length > 0) {
          if (c.interests.length <= 3) {
            reasons.push(
              `Has ${c.interests.length} interest${c.interests.length === 1 ? "" : "s"}`,
            );
          } else {
            reasons.push("Has multiple interests");
          }
        }

        // Age indicator
        if (c.age !== null) {
          reasons.push(`${c.age}+`);
        }

        // Profile completeness
        const completeness =
          (c.photos?.length > 0 ? 10 : 0) + (c.about ? 5 : 0) + (c.headline ? 5 : 0);
        if (completeness >= 15) {
          reasons.push("Complete profile");
        } else if (completeness >= 5) {
          reasons.push("Almost complete");
        }

        // Distance indicator
        if (c.distanceKm !== null && c.distanceKm <= 50) {
          reasons.push(`Nearby (${c.distanceKm}km)`);
        }

        // Default reason if none found
        if (reasons.length === 0) {
          reasons.push("Great match");
        }

        // 30% chance to mark a candidate as "surprise me" today
        // (daily tracking to be implemented with cooldown store in future)
        const isLuckyToday = Math.random() < 0.3;

        return {
          ...c,
          relationshipStatus,
          canSendInterest,
          isPrimary,
          photoCount,
          photoRatio: photoCount > 0 ? Math.round((photoCount / 9) * 100) : 0,
          familiar: c.isContactMatch === true,
          reasons: reasons.slice(0, 3), // Top 3 reasons
          isLuckyToday,
          stackType: stackTypeMap[c.userId] || "NONE",
        };
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
      take: 100,
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
 *
 * Access resolves through getEffectiveAccess rather than reading
 * user_subscriptions directly, so a comped user and a user in free mode are
 * both recognised as entitled. Reading the subscription row directly silently
 * denied both.
 */
export const getLikesReceived = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const access = await getEffectiveAccess(userId);
    const isPaidTier = access.tierCode !== "FREE";

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
                gender: true,
                dateOfBirth: true,
                ethnicity: true,
                profile: { select: { bio_profile_image_url: true, profileUrl: true } },
                datingProfile: {
                  select: {
                    headline: true,
                    photos: true,
                    about: true,
                    heightCm: true,
                    interests: true,
                    lookingFor: true,
                    location: true,
                    degree: true,
                    university: true,
                    profession: true,
                    industry: true,
                    workLocation: true,
                    languages: true,
                    religion: true,
                    hometown: true,
                  },
                },
              },
            },
          }
        : { id: true },
      take: 200,
    });

    return ok(res, {
      count: likes.length,
      profiles: isPaidTier ? likes.map((l) => (l as { swiper: unknown }).swiper) : [],
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
    const swiperId = String(req.user!.id);
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
            datingProfile: { select: { photos: true } },
          },
        },
      },
    });

    const hasNext = items.length > limit;
    if (hasNext) items.pop();

    const targetIds = items.map((i) => i.targetId);
    const matches = await prisma.userMatch.findMany({
      where: {
        OR: [
          { userId: swiperId, matchedId: { in: targetIds } },
          { userId: { in: targetIds }, matchedId: swiperId },
        ],
        status: "MATCHED",
      },
      take: 200,
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
            photos: i.target.datingProfile?.photos || [],
          },
        },
      };
    });

    return ok(
      res,
      {
        items: formatted,
        nextCursor: hasNext && items.length > 0 ? items[items.length - 1].id : null,
      },
      "Sent interests retrieved successfully.",
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

    if (await isUserBlocked(userId, targetId)) {
      return ok(res, {
        userId: targetId,
        relationshipStatus: "BLOCKED",
        canSendInterest: false,
      });
    }

    const [swipes, matches] = await Promise.all([
      prisma.userSwipe.findMany({
        where: {
          OR: [
            { swiperId: userId, targetId },
            { swiperId: targetId, targetId: userId },
          ],
        },
        take: 50,
      }),
      prisma.userMatch.findMany({
        where: {
          OR: [
            { userId, matchedId: targetId },
            { userId: targetId, matchedId: userId },
          ],
          status: "MATCHED",
        },
        take: 50,
      }),
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
        canSendInterest = false;
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
      ...(sentAt && { sentAt }),
    });
  } catch (error) {
    console.error("Get relationship status error:", error);
    return fail(res, 500, "Failed to get relationship status");
  }
};
