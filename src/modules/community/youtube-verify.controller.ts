import { Request, Response } from "express";
import { ok, fail } from "../../helpers/response.js";
import {
  logCommunity,
  logCommunityWarn,
  logCommunityError,
} from "../../helpers/communityLogger.js";
import * as communityService from "../../services/community.service.js";
import * as youtubeOauth from "../../services/youtube-oauth.service.js";
import {
  resolveChannelId,
  getChannelLinks,
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

// Anything interpolated into the fallback page below. The values come from a
// signed state payload, but the page is built with string concatenation and
// should not depend on that holding.
function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

// What actually happened, for the case where the app deep link cannot be
// reached. The previous version of this page said "subscription verified" for
// every outcome including total failure, so a malformed
// YOUTUBE_VERIFY_RETURN_URL turned every failed verification into a user-facing
// success message.
function describeOutcome(query: Record<string, string | boolean>): string {
  if (query.subscribed === true) {
    return "YouTube subscription verified. You can close this window and return to the app.";
  }
  if (query.subscribed === false) {
    return "We could not confirm a YouTube subscription. Nothing has been unlocked — " +
      "return to the app and try again, or subscribe to the channel first.";
  }
  return "Subscription verification did not complete. Nothing has been unlocked — " +
    "return to the app and try again.";
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
  } catch (error) {
    // Reaching here means YOUTUBE_VERIFY_RETURN_URL is not parseable by `new URL`,
    // so the app never receives the verdict at all. That is a misconfiguration,
    // not a user error, so it is logged at warn with the offending value.
    logCommunityWarn("community.verify.redirect_fallback", {
      returnUrl: base,
      outcome: query.subscribed ?? "unknown",
      message: error instanceof Error ? error.message : String(error),
    });

    res
      .type("html")
      .send(
        '<html><body style="font-family:sans-serif;text-align:center;padding-top:60px">' +
          `<h2>${escapeHtml(describeOutcome(query))}</h2>` +
          "</body></html>",
      );
  }
}

export class YouTubeVerifyController {
  // ── POST /community/videos/:videoId/subscribe-intent ──────────────────────
  // The "Subscribe to Unlock" tap: records the intent and hands back everything
  // the app needs to continue, in one round-trip.
  //
  // This was two calls the app had to keep in step — POST /interact with
  // SUBSCRIBE_INTENT for the funnel, then GET /youtube/start/:videoId for the
  // authorization URL and the subscribe links. Nothing forced it to make both,
  // so the analytics half was the one that got dropped, and a missing
  // SUBSCRIBE_INTENT understates the denominator that the conversion rate is
  // computed against — the funnel silently flattered itself. One endpoint makes
  // the event un-skippable.
  async subscribeIntent(req: Request, res: Response) {
    const start = started();
    try {
      const userId = req.user?.id as string;
      const videoId = param(req.params.videoId);

      // Resolved up front both to 404 an unknown card and to canonicalise the
      // id: the state token is signed with the internal id, and the interaction
      // row's foreign key must point at the real CommunityVideo.
      const video = await communityService.getVideoRecord(videoId);
      if (!video) {
        logCommunityWarn("community.subscribe_intent.not_found", {
          status: 404,
          userId,
          videoId,
          durationMs: Date.now() - start,
        });
        return fail(res, 404, "Video not found");
      }

      // Logged before the OAuth work and unconditionally. The tap is the event
      // being measured, and it happened whether or not we can go on to verify
      // anything. A funnel that only counts taps we could verify is not a
      // funnel. A failure here is logged and swallowed rather than failing the
      // request: the user still needs the subscribe link.
      const logged = await communityService.logInteraction(userId, video.id, "SUBSCRIBE_INTENT");
      if (!logged.success) {
        logCommunityWarn("community.subscribe_intent.log_failed", {
          status: 200,
          userId,
          videoId: video.id,
          durationMs: Date.now() - start,
        });
      }

      // `authUrl: null` rather than a 503 when OAuth is unconfigured, unlike
      // GET /youtube/start/:videoId. That endpoint's job is the authorization
      // URL, so it has nothing to return without OAuth. This one also carries
      // the funnel event and the subscribe links, both of which remain useful:
      // the user can still go and subscribe, and the tap still counts. Failing
      // the whole call would discard real analytics to report a configuration
      // problem the app cannot act on — and the dev flow unlocks without OAuth
      // anyway, so the app proceeds by calling /unlock directly.
      let authUrl: string | null = null;
      if (youtubeOauth.isYouTubeOAuthConfigured()) {
        const state = youtubeOauth.signVerifyState(userId, video.id);
        authUrl = youtubeOauth.buildAuthUrl(state);
      }

      logCommunity("community.subscribe_intent", {
        status: 200,
        userId,
        videoId: video.id,
        logged: logged.success,
        verificationAvailable: authUrl !== null,
        durationMs: Date.now() - start,
      });

      return ok(
        res,
        { videoId: video.id, authUrl, channel: getChannelLinks() },
        authUrl
          ? "Subscribe intent recorded. Open authUrl to verify the subscription, or channel.appUrl to subscribe first."
          : "Subscribe intent recorded. YouTube verification is not configured, so the subscription cannot be checked automatically.",
      );
    } catch (error) {
      logCommunityError("community.subscribe_intent.error", {
        status: 500,
        userId: req.user?.id,
        videoId: param(req.params.videoId),
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to record subscribe intent");
    }
  }

  // ── GET /community/youtube/start/:videoId ─────────────────────────────────
  // Returns the Google authorization URL that will verify the caller's YouTube
  // subscription to the configured channel before unlocking the video, plus the
  // channel links the app should send the user to in order to subscribe.
  async start(req: Request, res: Response) {
    const start = started();
    try {
      const userId = req.user?.id as string;
      const videoId = param(req.params.videoId);

      const video = await communityService.getVideoRecord(videoId);
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
        { authUrl, expiresIn: 15 * 60, channel: getChannelLinks() },
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
      const token = await youtubeOauth.exchangeCodeForToken(code);
      const channelId = await resolveChannelId();
      const subscribed = await youtubeOauth.checkChannelSubscription(token.accessToken, channelId);

      let unlocked = false;
      let channelGranted = false;
      if (subscribed) {
        // The verdict is cached first: unlockVideo re-reads it as its gate, and
        // a negative verdict must also be cached so repeat attempts within the
        // TTL do not burn API quota.
        await youtubeOauth.setCachedVerification(payload.userId, true);

        const result = await communityService.unlockVideo(payload.userId, payload.videoId, {
          channelId,
          verifiedAt: new Date(),
          // Carried into the grant so the sweep can later re-check this
          // subscription. Null when Google reuses an existing grant and omits
          // it, which leaves the grant un-re-verified but working.
          refreshToken: token.refreshToken,
        });
        if (result.success) {
          unlocked = true;
          channelGranted = result.channelGranted;
          // Only UNLOCK is logged here. SUBSCRIBE_INTENT belongs to the client
          // tap that started this flow — logging it again on success would
          // double-count the funnel denominator.
          await communityService.logInteraction(payload.userId, payload.videoId, "UNLOCK");
        }
      } else {
        await youtubeOauth.setCachedVerification(payload.userId, false);
      }

      logCommunity("community.verify.callback", {
        userId: payload.userId,
        videoId: payload.videoId,
        subscribed,
        unlocked,
        channelGranted,
      });
      // channelGranted is the meaningful signal for the app: the subscription is
      // to the channel, so it unlocked the whole feed, not just this card.
      return redirectResult(res, {
        subscribed,
        videoId: payload.videoId,
        unlocked,
        channelGranted,
        hasChannelAccess: channelGranted,
      });
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
      const video = await communityService.getVideoRecord(videoId);
      const canonicalId = video?.id ?? videoId;

      // The app calls this on launch, so it is the best place to notice an
      // unsubscribe: the grant is re-checked live if stale, and this response
      // already carries the corrected state rather than the next one.
      const { access } = await communityService.resolveChannelAccessForRead(userId);
      const unlockStatus = await communityService.getUnlockStatus(userId, canonicalId, {
        channelAccess: access,
      });
      const cached = await youtubeOauth.getCachedVerification(userId);

      logCommunity("community.verify.status", {
        status: 200,
        userId,
        videoId: canonicalId,
        isUnlocked: unlockStatus.isUnlocked,
        via: unlockStatus.via,
        hasChannelAccess: unlockStatus.hasChannelAccess,
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
          // Which record opened the gate: CHANNEL for a subscriber, VIDEO for a
          // legacy per-video unlock, null when still locked.
          via: unlockStatus.via,
          // Durable channel grant. Unlike verifiedSubscribed it does not expire on
          // a TTL — but it is not permanent either: the nightly sweep re-checks
          // it and closes it on a cancelled subscription, so treat it as
          // current-enough for UI rather than a guarantee.
          hasChannelAccess: unlockStatus.hasChannelAccess,
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
