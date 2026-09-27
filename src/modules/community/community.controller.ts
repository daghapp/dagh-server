import { Request, Response } from "express";
import * as communityService from "../../services/community.service.js";
import { ok, created, fail, paginated } from "../../helpers/response.js";
import { parseEnum, parsePagination, parseSearch, type QueryValue } from "../../helpers/admin-query.js";
import {
  logCommunity,
  logCommunityWarn,
  logCommunityError,
} from "../../helpers/communityLogger.js";
import { VideoInteractionType } from "../../../generated/prisma/client.js";
import { YouTubeApiError, YouTubeNotConfiguredError } from "../../services/youtube.service.js";

const VALID_ACTIONS = new Set<VideoInteractionType>([
  "SUBSCRIBE_INTENT",
  "PREVIEW_CLIP",
  "WATCH_FULL_VIDEO",
  "UNLOCK",
]);

// Express 5 types req.params values as string | string[]; cast to string for all handlers.
function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function started(): number {
  return Date.now();
}

/**
 * Reads the grant listing's `status` filter, where "all" is a meaningful value
 * rather than a synonym for "unset". Anything unrecognised falls back to
 * "active" so a typo cannot silently return the whole table.
 */
function parseGrantStatus(query: Record<string, QueryValue>): communityService.ChannelGrantStatus {
  const raw = (Array.isArray(query.status) ? query.status[0] : query.status)
    ?.trim()
    .toLowerCase();
  return communityService.CHANNEL_GRANT_STATUSES.includes(
    raw as communityService.ChannelGrantStatus,
  )
    ? (raw as communityService.ChannelGrantStatus)
    : "active";
}

export class CommunityController {
  // ── GET /community/videos ─────────────────────────────────────────────────
  // Returns paginated published videos with isUnlocked flag for the calling user.
  async listVideos(req: Request, res: Response) {
    const start = started();
    try {
      const userId = req.user?.id as string;
      const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
      const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) || "20", 10)));
      // Unrecognised values fall back to NEWEST rather than 400: a client asking
      // for a sort this server does not know about should still get the feed.
      const sort =
        parseEnum(
          req.query as unknown as Record<string, QueryValue>,
          "sort",
          communityService.VIDEO_SORTS,
        ) ?? communityService.DEFAULT_VIDEO_SORT;

      const { videos, total, hasChannelAccess, channelAccess } =
        await communityService.listVideosForUser(userId, page, limit, { sort });

      logCommunity("community.feed.list", {
        status: 200,
        userId,
        page,
        limit,
        sort,
        count: videos.length,
        total,
        hasChannelAccess,
        durationMs: Date.now() - start,
      });
      // hasChannelAccess rides in `meta` so the app can hide every "Subscribe to
      // Unlock" call to action at once instead of deriving it from the cards.
      return paginated(res, videos, total, page, limit, "Community videos retrieved", {
        hasChannelAccess,
        channelAccess,
        sort,
      });
    } catch (error) {
      logCommunityError("community.feed.list.error", {
        status: 500,
        userId: req.user?.id,
        page: req.query.page,
        limit: req.query.limit,
        sort: req.query.sort,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to fetch community videos");
    }
  }

  // ── GET /community/videos/:videoId ────────────────────────────────────────
  // Returns a single video with its unlock status for the calling user. Locked
  // cards carry the clipped preview only — no youtubeVideoId, no watchUrl.
  async getVideo(req: Request, res: Response) {
    const start = started();
    try {
      const userId = req.user?.id as string;
      const videoId = param(req.params.videoId);

      const video = await communityService.getVideoForUser(userId, videoId);
      if (!video) {
        logCommunityWarn("community.feed.get.not_found", {
          status: 404,
          userId,
          videoId,
          durationMs: Date.now() - start,
        });
        return fail(res, 404, "Video not found");
      }

      logCommunity("community.feed.get", {
        status: 200,
        userId,
        videoId: video.videoId,
        isUnlocked: video.isUnlocked,
        durationMs: Date.now() - start,
      });
      return ok(res, video);
    } catch (error) {
      logCommunityError("community.feed.get.error", {
        status: 500,
        userId: req.user?.id,
        videoId: param(req.params.videoId),
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to fetch video");
    }
  }

  // ── POST /community/videos/:videoId/interact ──────────────────────────────
  // Logs a user interaction event (analytics). Fire-and-forget from the client.
  // Optional body field `durationMs` (integer ms ≥ 0) records client-reported
  // watch time, e.g. how far the user got into the 45s teaser before leaving.
  async logInteraction(req: Request, res: Response) {
    const start = started();
    try {
      const userId = req.user?.id as string;
      const videoId = param(req.params.videoId);
      const { action, durationMs } = req.body as { action: string; durationMs?: unknown };

      if (!action || !VALID_ACTIONS.has(action as VideoInteractionType)) {
        logCommunityWarn("community.interact.invalid_action", {
          status: 400,
          userId,
          videoId,
          action: action ?? null,
          durationMs: durationMs ?? null,
          elapsedMs: Date.now() - start,
        });
        return fail(res, 400, {
          code: "INVALID_ACTION",
          message: `action must be one of: ${[...VALID_ACTIONS].join(", ")}`,
        });
      }

      if (
        durationMs !== undefined &&
        (typeof durationMs !== "number" || !Number.isInteger(durationMs) || durationMs < 0)
      ) {
        logCommunityWarn("community.interact.invalid_duration", {
          status: 400,
          userId,
          videoId,
          action,
          durationMs: durationMs ?? null,
          elapsedMs: Date.now() - start,
        });
        return fail(res, 400, {
          code: "INVALID_DURATION",
          message: "durationMs must be a non-negative integer (milliseconds)",
        });
      }

      const result = await communityService.logInteraction(
        userId,
        videoId,
        action as VideoInteractionType,
        durationMs as number | undefined,
      );

      if (!result.success) {
        logCommunityWarn("community.interact.not_found", {
          status: 404,
          userId,
          videoId,
          action,
          durationMs: durationMs ?? null,
          elapsedMs: Date.now() - start,
        });
        return fail(res, 404, { code: result.code, message: "Video not found" });
      }

      logCommunity("community.interact", {
        status: 200,
        userId,
        videoId,
        action,
        durationMs: durationMs ?? null,
        elapsedMs: Date.now() - start,
      });
      return ok(res, { logged: true, durationMs: durationMs ?? null }, "Interaction logged");
    } catch (error) {
      logCommunityError("community.interact.error", {
        status: 500,
        userId: req.user?.id,
        videoId: param(req.params.videoId),
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to log interaction");
    }
  }

  // ── POST /community/videos/:videoId/unlock ────────────────────────────────
  // Grants full access to a video, but only against a server-confirmed YouTube
  // subscription verdict. Idempotent — safe to call repeatedly.
  async unlockVideo(req: Request, res: Response) {
    const start = started();
    try {
      const userId = req.user?.id as string;
      const videoId = param(req.params.videoId);

      const result = await communityService.unlockVideo(userId, videoId);

      if (!result.success) {
        if (result.code === "SUBSCRIPTION_REQUIRED") {
          logCommunityWarn("community.unlock.subscription_required", {
            status: 403,
            userId,
            videoId,
            verifiedAt: result.verifiedAt,
            durationMs: Date.now() - start,
          });
          return fail(res, 403, {
            code: "SUBSCRIPTION_REQUIRED",
            message: "Subscribe to the channel to unlock this video",
            verifiedAt: result.verifiedAt,
          });
        }

        logCommunityWarn("community.unlock.not_found", {
          status: 404,
          userId,
          videoId,
          durationMs: Date.now() - start,
        });
        return fail(res, 404, { code: result.code, message: "Video not found" });
      }

      logCommunity("community.unlock", {
        status: 200,
        userId,
        videoId,
        isUnlocked: result.isUnlocked,
        unlockedAt: result.unlockedAt,
        durationMs: Date.now() - start,
      });
      return ok(
        res,
        { isUnlocked: result.isUnlocked, unlockedAt: result.unlockedAt },
        "Video unlocked",
      );
    } catch (error) {
      logCommunityError("community.unlock.error", {
        status: 500,
        userId: req.user?.id,
        videoId: param(req.params.videoId),
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to unlock video");
    }
  }

  // ── GET /community/my-unlocks ─────────────────────────────────────────────
  // Returns the videoIds the calling user has unlocked, plus the feed-level
  // channel grant. Called on app launch to rehydrate local isSubscribed state.
  async getMyUnlocks(req: Request, res: Response) {
    const start = started();
    try {
      const userId = req.user!.id as string;
      const result = await communityService.getUserUnlocks(userId);
      logCommunity("community.my_unlocks", {
        status: 200,
        userId,
        count: result.unlocks.length,
        hasChannelAccess: result.hasChannelAccess,
        durationMs: Date.now() - start,
      });
      return ok(res, result, "User unlocks retrieved");
    } catch (error) {
      logCommunityError("community.my_unlocks.error", {
        status: 500,
        userId: req.user?.id,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to fetch user unlocks");
    }
  }

  // ── GET /community/videos/:videoId/analytics (admin) ─────────────────────
  // Returns interaction counts and conversion rate for a video.
  async getVideoAnalytics(req: Request, res: Response) {
    const start = started();
    try {
      const videoId = param(req.params.videoId);

      const analytics = await communityService.getVideoAnalytics(videoId);
      if (!analytics) {
        logCommunityWarn("community.analytics.not_found", {
          status: 404,
          videoId,
          durationMs: Date.now() - start,
        });
        return fail(res, 404, "Video not found");
      }

      logCommunity("community.analytics", {
        status: 200,
        videoId: analytics.videoId,
        interactions: analytics.interactions,
        totalUnlocks: analytics.totalUnlocks,
        conversionRate: analytics.conversionRate,
        totalWatchTimeMs: analytics.totalWatchTimeMs,
        avgWatchTimeMs: analytics.avgWatchTimeMs,
        durationMs: Date.now() - start,
      });
      return ok(res, analytics, "Analytics retrieved");
    } catch (error) {
      logCommunityError("community.analytics.error", {
        status: 500,
        userId: req.user?.id,
        videoId: param(req.params.videoId),
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to fetch analytics");
    }
  }

  // ── POST /community/admin/videos (admin) ──────────────────────────────────
  async adminCreateVideo(req: Request, res: Response) {
    const start = started();
    try {
      const payload = req.body as communityService.CreateVideoPayload;

      const result = await communityService.adminCreateVideo(payload);

      if (!result.success) {
        const code = result.code;
        const status = code === "DUPLICATE_VIDEO_ID" ? 409 : 422;
        logCommunityWarn("community.admin.create.duplicate", {
          status,
          adminId: req.user?.id,
          youtubeVideoId: payload.youtubeVideoId,
          durationMs: Date.now() - start,
        });
        return fail(res, status, { code, message: "A video with this YouTube ID already exists" });
      }

      logCommunity("community.admin.create", {
        status: 201,
        adminId: req.user?.id,
        videoId: result.data.id,
        youtubeVideoId: payload.youtubeVideoId,
        durationMs: Date.now() - start,
      });
      return created(res, result.data, "Community video created");
    } catch (error) {
      logCommunityError("community.admin.create.error", {
        status: 500,
        adminId: req.user?.id,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to create community video");
    }
  }

  // ── PUT /community/admin/videos/:videoId (admin) ──────────────────────────
  async adminUpdateVideo(req: Request, res: Response) {
    const start = started();
    try {
      const videoId = param(req.params.videoId);
      const payload = req.body as communityService.UpdateVideoPayload;

      const result = await communityService.adminUpdateVideo(videoId, payload);

      if (!result.success) {
        logCommunityWarn("community.admin.update.not_found", {
          status: 404,
          adminId: req.user?.id,
          videoId,
          durationMs: Date.now() - start,
        });
        return fail(res, 404, { code: result.code, message: "Video not found" });
      }

      logCommunity("community.admin.update", {
        status: 200,
        adminId: req.user?.id,
        videoId,
        durationMs: Date.now() - start,
      });
      return ok(res, result.data, "Community video updated");
    } catch (error) {
      logCommunityError("community.admin.update.error", {
        status: 500,
        adminId: req.user?.id,
        videoId: param(req.params.videoId),
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to update community video");
    }
  }

  // ── DELETE /community/admin/videos/:videoId (admin) ───────────────────────
  // Soft-deletes the video by setting isPublished = false.
  async adminDeleteVideo(req: Request, res: Response) {
    const start = started();
    try {
      const videoId = param(req.params.videoId);

      const result = await communityService.adminDeleteVideo(videoId);

      if (!result.success) {
        logCommunityWarn("community.admin.delete.not_found", {
          status: 404,
          adminId: req.user?.id,
          videoId,
          durationMs: Date.now() - start,
        });
        return fail(res, 404, { code: result.code, message: "Video not found" });
      }

      logCommunity("community.admin.delete", {
        status: 200,
        adminId: req.user?.id,
        videoId,
        durationMs: Date.now() - start,
      });
      return ok(res, null, "Community video unpublished");
    } catch (error) {
      logCommunityError("community.admin.delete.error", {
        status: 500,
        adminId: req.user?.id,
        videoId: param(req.params.videoId),
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to delete community video");
    }
  }

  // ── POST /community/admin/sync-youtube (admin) ────────────────────────────
  // Pulls the latest uploads from the configured YouTube channel and adds any
  // missing videos to the feed. Reads YOUTUBE_* env vars, or an explicit
  // channelId/handle in the request body.
  async adminSyncChannel(req: Request, res: Response) {
    const start = started();
    try {
      const payload = req.body as communityService.SyncVideosPayload;

      const result = await communityService.syncVideosFromChannel(payload);

      logCommunity("community.admin.sync", {
        status: 200,
        adminId: req.user?.id,
        channelId: result.channelId,
        fetched: result.fetched,
        created: result.created,
        alreadyPresent: result.alreadyPresent,
        cached: result.cached,
        durationMs: Date.now() - start,
      });
      return ok(res, result, "Community videos synced");
    } catch (error) {
      if (error instanceof YouTubeNotConfiguredError) {
        logCommunityWarn("community.admin.sync.not_configured", {
          status: 503,
          adminId: req.user?.id,
          message: error.message,
          durationMs: Date.now() - start,
        });
        return fail(res, 503, {
          code: "YOUTUBE_NOT_CONFIGURED",
          message: error.message,
        });
      }
      if (error instanceof YouTubeApiError) {
        logCommunityWarn("community.admin.sync.youtube_api", {
          status: 502,
          adminId: req.user?.id,
          message: error.message,
          durationMs: Date.now() - start,
        });
        return fail(res, 502, { code: "YOUTUBE_API_ERROR", message: error.message });
      }
      logCommunityError("community.admin.sync.error", {
        status: 500,
        adminId: req.user?.id,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to sync community videos");
    }
  }

  // ── GET /community/admin/youtube-grants (admin) ───────────────────────────
  // The grant table is otherwise unreachable: the only reads on it are the
  // per-user lookups behind the feed gate. This answers "does this account still
  // have access, and can we still prove it?" without touching the database by
  // hand. Refresh tokens are never returned — only whether one is present and
  // sealed.
  async adminListChannelGrants(req: Request, res: Response) {
    const start = started();
    try {
      const query = req.query as Record<string, QueryValue>;
      const { page, limit } = parsePagination(query);
      // Not parseEnum(): that helper maps "all" to undefined, which here would
      // silently widen the request to every grant instead of the default
      // "active" — the opposite of what an operator typing status=all expects.
      const status = parseGrantStatus(query);

      const result = await communityService.listChannelGrants({
        status,
        page,
        limit,
        search: parseSearch(query),
      });

      logCommunity("community.admin.grants.list", {
        status: 200,
        adminId: req.user?.id,
        statusFilter: status,
        total: result.total,
        ...result.summary,
        durationMs: Date.now() - start,
      });

      return paginated(
        res,
        result.rows,
        result.total,
        page,
        limit,
        "YouTube channel grants",
        { summary: result.summary },
      );
    } catch (error) {
      logCommunityError("community.admin.grants.list.error", {
        status: 500,
        adminId: req.user?.id,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to list YouTube channel grants");
    }
  }

  // ── POST /community/admin/youtube-grants/:userId/revoke (admin) ───────────
  // Closes a grant without consulting YouTube — the escape hatch for a support
  // request, a refund, or an account that must not keep feed access. Recoverable:
  // the user re-authorising revives the same row.
  async adminRevokeChannelGrant(req: Request, res: Response) {
    const start = started();
    try {
      const adminId = req.user?.id as string;
      const userId = param(req.params.userId);

      const revoked = await communityService.revokeChannelGrantManually(userId);

      if (!revoked) {
        logCommunityWarn("community.admin.grants.revoke.not_found", {
          status: 404,
          adminId,
          userId,
          durationMs: Date.now() - start,
        });
        return fail(res, 404, "No active channel grant for that user");
      }

      logCommunity("community.admin.grants.revoke", {
        status: 200,
        adminId,
        userId,
        durationMs: Date.now() - start,
      });
      return ok(res, { userId, revoked: true }, "Channel grant revoked");
    } catch (error) {
      logCommunityError("community.admin.grants.revoke.error", {
        status: 500,
        adminId: req.user?.id,
        userId: param(req.params.userId),
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to revoke channel grant");
    }
  }

  // ── POST /community/admin/youtube-grants/re-encrypt (admin) ───────────────
  // One-shot backfill for grants whose refresh token predates sealing. New writes
  // and any successful re-check already re-seal, so this is normally a no-op; it
  // exists so a deploy does not need shell access to the database.
  async adminReencryptGrantTokens(req: Request, res: Response) {
    const start = started();
    try {
      const adminId = req.user?.id as string;
      const result = await communityService.reencryptLegacyRefreshTokens();

      logCommunity("community.admin.grants.reencrypt", {
        status: 200,
        adminId,
        ...result,
        durationMs: Date.now() - start,
      });
      return ok(
        res,
        result,
        `Re-sealed ${result.sealed} of ${result.scanned} stored refresh tokens`,
      );
    } catch (error) {
      logCommunityError("community.admin.grants.reencrypt.error", {
        status: 500,
        adminId: req.user?.id,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to re-encrypt refresh tokens");
    }
  }
}
