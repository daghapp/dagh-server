import { Request, Response } from "express";
import * as communityService from "../../services/community.service.js";
import { ok, created, fail, paginated } from "../../helpers/response.js";
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

export class CommunityController {
  // ── GET /community/videos ─────────────────────────────────────────────────
  // Returns paginated published videos with isUnlocked flag for the calling user.
  async listVideos(req: Request, res: Response) {
    try {
      const userId = req.user?.id as string;
      const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
      const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) || "20", 10)));

      const { videos, total } = await communityService.listVideosForUser(userId, page, limit);

      return paginated(res, videos, total, page, limit, "Community videos retrieved");
    } catch (error) {
      console.error("[COMMUNITY_LIST_VIDEOS_ERROR]", error);
      return fail(res, 500, "Failed to fetch community videos");
    }
  }

  // ── GET /community/videos/:videoId ────────────────────────────────────────
  // Returns a single video with its unlock status for the calling user.
  async getVideo(req: Request, res: Response) {
    try {
      const userId = req.user?.id as string;
      const videoId = param(req.params.videoId);

      const video = await communityService.getVideo(videoId);
      if (!video) {
        return fail(res, 404, "Video not found");
      }

      const unlockStatus = await communityService.getUnlockStatus(userId, videoId);

      return ok(res, { ...video, ...unlockStatus });
    } catch (error) {
      console.error("[COMMUNITY_GET_VIDEO_ERROR]", error);
      return fail(res, 500, "Failed to fetch video");
    }
  }

  // ── POST /community/videos/:videoId/interact ──────────────────────────────
  // Logs a user interaction event (analytics). Fire-and-forget from the client.
  async logInteraction(req: Request, res: Response) {
    try {
      const userId = req.user?.id as string;
      const videoId = param(req.params.videoId);
      const { action } = req.body as { action: string };

      if (!action || !VALID_ACTIONS.has(action as VideoInteractionType)) {
        return fail(res, 400, {
          code: "INVALID_ACTION",
          message: `action must be one of: ${[...VALID_ACTIONS].join(", ")}`,
        });
      }

      console.log("[COMMUNITY_INTERACT]", { userId, videoId, action });

      const result = await communityService.logInteraction(
        userId,
        videoId,
        action as VideoInteractionType,
      );

      if (!result.success) {
        return fail(res, 404, { code: result.code, message: "Video not found" });
      }

      return ok(res, null, "Interaction logged");
    } catch (error) {
      console.error("[COMMUNITY_INTERACT_ERROR]", error);
      return fail(res, 500, "Failed to log interaction");
    }
  }

  // ── POST /community/videos/:videoId/unlock ────────────────────────────────
  // Marks a video as unlocked for this user. Idempotent — safe to call repeatedly.
  async unlockVideo(req: Request, res: Response) {
    try {
      const userId = req.user?.id as string;
      const videoId = param(req.params.videoId);

      console.log("[COMMUNITY_UNLOCK]", { userId, videoId });

      const result = await communityService.unlockVideo(userId, videoId);

      if (!result.success) {
        return fail(res, 404, { code: result.code, message: "Video not found" });
      }

      return ok(
        res,
        { isUnlocked: result.isUnlocked, unlockedAt: result.unlockedAt },
        "Video unlocked",
      );
    } catch (error) {
      console.error("[COMMUNITY_UNLOCK_ERROR]", error);
      return fail(res, 500, "Failed to unlock video");
    }
  }

  // ── GET /community/my-unlocks ─────────────────────────────────────────────
  // Returns the list of videoIds unlocked by the calling user.
  // Called on app launch to rehydrate local isSubscribed state.
  async getMyUnlocks(req: Request, res: Response) {
    try {
      const userId = req.user?.id as string;
      const unlocks = await communityService.getUserUnlocks(userId);
      return ok(res, { unlocks }, "User unlocks retrieved");
    } catch (error) {
      console.error("[COMMUNITY_MY_UNLOCKS_ERROR]", error);
      return fail(res, 500, "Failed to fetch user unlocks");
    }
  }

  // ── GET /community/videos/:videoId/analytics (admin) ─────────────────────
  // Returns interaction counts and conversion rate for a video.
  async getVideoAnalytics(req: Request, res: Response) {
    try {
      const videoId = param(req.params.videoId);

      const analytics = await communityService.getVideoAnalytics(videoId);
      if (!analytics) {
        return fail(res, 404, "Video not found");
      }

      return ok(res, analytics, "Analytics retrieved");
    } catch (error) {
      console.error("[COMMUNITY_ANALYTICS_ERROR]", error);
      return fail(res, 500, "Failed to fetch analytics");
    }
  }

  // ── POST /community/admin/videos (admin) ──────────────────────────────────
  async adminCreateVideo(req: Request, res: Response) {
    try {
      const payload = req.body as communityService.CreateVideoPayload;

      const result = await communityService.adminCreateVideo(payload);

      if (!result.success) {
        const code = result.code;
        const status = code === "DUPLICATE_VIDEO_ID" ? 409 : 422;
        return fail(res, status, { code, message: "A video with this YouTube ID already exists" });
      }

      console.log("[COMMUNITY_ADMIN_CREATE]", { youtubeVideoId: payload.youtubeVideoId });
      return created(res, result.data, "Community video created");
    } catch (error) {
      console.error("[COMMUNITY_ADMIN_CREATE_ERROR]", error);
      return fail(res, 500, "Failed to create community video");
    }
  }

  // ── PUT /community/admin/videos/:videoId (admin) ──────────────────────────
  async adminUpdateVideo(req: Request, res: Response) {
    try {
      const videoId = param(req.params.videoId);
      const payload = req.body as communityService.UpdateVideoPayload;

      const result = await communityService.adminUpdateVideo(videoId, payload);

      if (!result.success) {
        return fail(res, 404, { code: result.code, message: "Video not found" });
      }

      console.log("[COMMUNITY_ADMIN_UPDATE]", { videoId });
      return ok(res, result.data, "Community video updated");
    } catch (error) {
      console.error("[COMMUNITY_ADMIN_UPDATE_ERROR]", error);
      return fail(res, 500, "Failed to update community video");
    }
  }

  // ── DELETE /community/admin/videos/:videoId (admin) ───────────────────────
  // Soft-deletes the video by setting isPublished = false.
  async adminDeleteVideo(req: Request, res: Response) {
    try {
      const videoId = param(req.params.videoId);

      const result = await communityService.adminDeleteVideo(videoId);

      if (!result.success) {
        return fail(res, 404, { code: result.code, message: "Video not found" });
      }

      console.log("[COMMUNITY_ADMIN_DELETE]", { videoId });
      return ok(res, null, "Community video unpublished");
    } catch (error) {
      console.error("[COMMUNITY_ADMIN_DELETE_ERROR]", error);
      return fail(res, 500, "Failed to delete community video");
    }
  }

  // ── POST /community/admin/sync-youtube (admin) ────────────────────────────
  // Pulls the latest uploads from the configured YouTube channel and adds any
  // missing videos to the feed. Reads YOUTUBE_* env vars, or an explicit
  // channelId/handle in the request body.
  async adminSyncChannel(req: Request, res: Response) {
    try {
      const payload = req.body as communityService.SyncVideosPayload;

      const result = await communityService.syncVideosFromChannel(payload);

      console.log("[COMMUNITY_ADMIN_SYNC]", {
        channelId: result.channelId,
        fetched: result.fetched,
        created: result.created,
        alreadyPresent: result.alreadyPresent,
        cached: result.cached,
      });
      return ok(res, result, "Community videos synced");
    } catch (error) {
      if (error instanceof YouTubeNotConfiguredError) {
        return fail(res, 503, {
          code: "YOUTUBE_NOT_CONFIGURED",
          message: error.message,
        });
      }
      if (error instanceof YouTubeApiError) {
        return fail(res, 502, { code: "YOUTUBE_API_ERROR", message: error.message });
      }
      console.error("[COMMUNITY_ADMIN_SYNC_ERROR]", error);
      return fail(res, 500, "Failed to sync community videos");
    }
  }
}
