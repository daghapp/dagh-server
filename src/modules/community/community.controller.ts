import { Request, Response } from "express";
import * as communityService from "../../services/community.service.js";
import { ok, created, fail, paginated } from "../../helpers/response.js";
import { logCommunity, logCommunityWarn, logCommunityError } from "../../helpers/communityLogger.js";
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

export class CommunityController {
  // ── GET /community/videos ─────────────────────────────────────────────────
  // Returns paginated published videos with isUnlocked flag for the calling user.
  async listVideos(req: Request, res: Response) {
    const start = started();
    try {
      const userId = req.user?.id as string;
      const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
      const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) || "20", 10)));

      const { videos, total } = await communityService.listVideosForUser(userId, page, limit);

      logCommunity("community.feed.list", {
        status: 200,
        userId,
        page,
        limit,
        count: videos.length,
        total,
        durationMs: Date.now() - start,
      });
      return paginated(res, videos, total, page, limit, "Community videos retrieved");
    } catch (error) {
      logCommunityError("community.feed.list.error", {
        status: 500,
        userId: req.user?.id,
        page: req.query.page,
        limit: req.query.limit,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to fetch community videos");
    }
  }

  // ── GET /community/videos/:videoId ────────────────────────────────────────
  // Returns a single video with its unlock status for the calling user.
  async getVideo(req: Request, res: Response) {
    const start = started();
    try {
      const userId = req.user?.id as string;
      const videoId = param(req.params.videoId);

      const video = await communityService.getVideo(videoId);
      if (!video) {
        logCommunityWarn("community.feed.get.not_found", {
          status: 404,
          userId,
          videoId,
          durationMs: Date.now() - start,
        });
        return fail(res, 404, "Video not found");
      }

      const unlockStatus = await communityService.getUnlockStatus(userId, video.id);

      logCommunity("community.feed.get", {
        status: 200,
        userId,
        videoId: video.id,
        isUnlocked: unlockStatus.isUnlocked,
        durationMs: Date.now() - start,
      });
      return ok(res, { ...video, ...unlockStatus });
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
  async logInteraction(req: Request, res: Response) {
    const start = started();
    try {
      const userId = req.user?.id as string;
      const videoId = param(req.params.videoId);
      const { action } = req.body as { action: string };

      if (!action || !VALID_ACTIONS.has(action as VideoInteractionType)) {
        logCommunityWarn("community.interact.invalid_action", {
          status: 400,
          userId,
          videoId,
          action: action ?? null,
          durationMs: Date.now() - start,
        });
        return fail(res, 400, {
          code: "INVALID_ACTION",
          message: `action must be one of: ${[...VALID_ACTIONS].join(", ")}`,
        });
      }

      const result = await communityService.logInteraction(
        userId,
        videoId,
        action as VideoInteractionType,
      );

      if (!result.success) {
        logCommunityWarn("community.interact.not_found", {
          status: 404,
          userId,
          videoId,
          action,
          durationMs: Date.now() - start,
        });
        return fail(res, 404, { code: result.code, message: "Video not found" });
      }

      logCommunity("community.interact", {
        status: 200,
        userId,
        videoId,
        action,
        durationMs: Date.now() - start,
      });
      return ok(res, null, "Interaction logged");
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
  // Marks a video as unlocked for this user. Idempotent — safe to call repeatedly.
  async unlockVideo(req: Request, res: Response) {
    const start = started();
    try {
      const userId = req.user?.id as string;
      const videoId = param(req.params.videoId);

      const result = await communityService.unlockVideo(userId, videoId);

      if (!result.success) {
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
  // Returns the list of videoIds unlocked by the calling user.
  // Called on app launch to rehydrate local isSubscribed state.
  async getMyUnlocks(req: Request, res: Response) {
    const start = started();
    try {
      const userId = req.user?.id as string;
      const unlocks = await communityService.getUserUnlocks(userId);
      logCommunity("community.my_unlocks", {
        status: 200,
        userId,
        count: unlocks.length,
        durationMs: Date.now() - start,
      });
      return ok(res, { unlocks }, "User unlocks retrieved");
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
}
