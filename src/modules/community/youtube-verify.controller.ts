import { Request, Response } from "express";
import { ok, fail } from "../../helpers/response.js";
import { logCommunity, logCommunityWarn, logCommunityError } from "../../helpers/communityLogger.js";
import * as communityService from "../../services/community.service.js";
import * as youtubeOauth from "../../services/youtube-oauth.service.js";
import {
  resolveChannelId,
  YouTubeNotConfiguredError,
  YouTubeApiError,
} from "../../services/youtube.service.js";

// Express 5 types req.params values as string | string[]; cast to string for all handlers.
function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function started(): number {
  return Date.now();
}

// Redirects the browser back to the app deep link with the verification outcome,
// mirroring the membership payment return/cancel bridge.
function redirectResult(res: Response, query: Record<string, string | boolean>): void {
  const base = youtubeOauth.getVerifyReturnUrl();
  try {
    const urlObj = new URL(base);
    for (const [key, value] of Object.entries(query)) {
      urlObj.searchParams.set(key, String(value));
    }
    res.redirect(urlObj.toString());
  } catch {
    res
      .type("html")
      .send(
        '<html><body style="font-family:sans-serif;text-align:center;padding-top:60px">' +
          "<h2>YouTube subscription verified — you can close this window and return to the app.</h2>" +
          "</body></html>",
      );
  }
}

export class YouTubeVerifyController {
  // ── GET /community/youtube/start/:videoId ─────────────────────────────────
  // Returns the Google authorization URL that will verify the caller's YouTube
  // subscription to the configured channel before unlocking the video.
  async start(req: Request, res: Response) {
    const start = started();
    try {
      const userId = req.user?.id as string;
      const videoId = param(req.params.videoId);

      const video = await communityService.getVideo(videoId);
      if (!video) {
        logCommunityWarn("community.verify.start.not_found", {
          status: 404,
          userId,
          videoId,
          durationMs: Date.now() - start,
        });
        return fail(res, 404, "Video not found");
      }

      const state = youtubeOauth.signVerifyState(userId, video.id);
      const authUrl = youtubeOauth.buildAuthUrl(state);

      logCommunity("community.verify.start", {
        status: 200,
        userId,
        videoId: video.id,
        durationMs: Date.now() - start,
      });
      return ok(
        res,
        { authUrl, expiresIn: 15 * 60 },
        "YouTube authorization URL created. Open authUrl in a browser to verify your subscription.",
      );
    } catch (error) {
      if (error instanceof YouTubeNotConfiguredError) {
        logCommunityWarn("community.verify.start.not_configured", {
          status: 503,
          userId: req.user?.id,
          message: error.message,
          durationMs: Date.now() - start,
        });
        return fail(res, 503, {
          code: "YOUTUBE_OAUTH_NOT_CONFIGURED",
          message: error.message,
        });
      }
      logCommunityError("community.verify.start.error", {
        status: 500,
        userId: req.user?.id,
        videoId: param(req.params.videoId),
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to start YouTube verification");
    }
  }

  // ── GET /community/youtube/callback ───────────────────────────────────────
  // Public OAuth redirect target (registered in the Google console). Exchanges
  // the code, checks the subscription, unlocks the video when subscribed, and
  // redirects the browser back to the app deep link with the verdict.
  async callback(req: Request, res: Response) {
    const { code, state, error } = req.query;

    if (typeof error === "string") {
      return redirectResult(res, { subscribed: false, videoId: "" });
    }

    if (typeof state !== "string" || typeof code !== "string") {
      return redirectResult(res, { subscribed: false, videoId: "" });
    }

    let payload: youtubeOauth.VerifyStatePayload;
    try {
      payload = youtubeOauth.verifyStateToken(state);
    } catch {
      return redirectResult(res, { subscribed: false, videoId: "" });
    }

    try {
      const accessToken = await youtubeOauth.exchangeCodeForToken(code);
      const channelId = await resolveChannelId();
      const subscribed = await youtubeOauth.checkChannelSubscription(accessToken, channelId);
      await youtubeOauth.setCachedVerification(payload.userId, subscribed);

      let unlocked = false;
      if (subscribed) {
        await communityService.logInteraction(payload.userId, payload.videoId, "SUBSCRIBE_INTENT");
        const result = await communityService.unlockVideo(payload.userId, payload.videoId);
        if (result.success) {
          unlocked = true;
          await communityService.logInteraction(payload.userId, payload.videoId, "UNLOCK");
        }
      }

      logCommunity("community.verify.callback", {
        userId: payload.userId,
        videoId: payload.videoId,
        subscribed,
        unlocked,
      });
      return redirectResult(res, { subscribed, videoId: payload.videoId, unlocked });
    } catch (error) {
      if (error instanceof YouTubeNotConfiguredError || error instanceof YouTubeApiError) {
        logCommunityWarn("community.verify.callback.warn", {
          userId: payload.userId,
          videoId: payload.videoId,
          message: error.message,
        });
      } else {
        logCommunityError("community.verify.callback.error", {
          userId: payload.userId,
          videoId: payload.videoId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return redirectResult(res, { subscribed: false, videoId: payload.videoId });
    }
  }

  // ── GET /community/youtube/status/:videoId ────────────────────────────────
  // Durable unlock state + the most recent cached subscription verdict. Polled
  // by the app on feed load / app resume to rehydrate the buttons without
  // re-running the OAuth flow.
  async status(req: Request, res: Response) {
    const start = started();
    try {
      const userId = req.user?.id as string;
      const videoId = param(req.params.videoId);

      // Resolve the canonical card id so the unlock lookup works whether the app
      // passes the internal id or the YouTube video id.
      const video = await communityService.getVideo(videoId);
      const canonicalId = video?.id ?? videoId;

      const unlockStatus = await communityService.getUnlockStatus(userId, canonicalId);
      const cached = await youtubeOauth.getCachedVerification(userId);

      logCommunity("community.verify.status", {
        status: 200,
        userId,
        videoId: canonicalId,
        isUnlocked: unlockStatus.isUnlocked,
        verifiedSubscribed: cached?.subscribed ?? null,
        cached: Boolean(cached),
        durationMs: Date.now() - start,
      });
      return ok(
        res,
        {
          videoId: canonicalId,
          isUnlocked: unlockStatus.isUnlocked,
          unlockedAt: unlockStatus.unlockedAt,
          verifiedSubscribed: cached?.subscribed ?? null,
          verifiedAt: cached?.verifiedAt ?? null,
          cached: Boolean(cached),
        },
        "YouTube verification status retrieved",
      );
    } catch (error) {
      logCommunityError("community.verify.status.error", {
        status: 500,
        userId: req.user?.id,
        videoId: param(req.params.videoId),
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to fetch YouTube verification status");
    }
  }
}
