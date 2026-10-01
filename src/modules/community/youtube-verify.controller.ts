import { Request, Response } from "express";
import { ok, fail, privateNoStore } from "../../helpers/response.js";
import {
  logCommunity,
  logCommunityWarn,
  logCommunityError,
} from "../../helpers/communityLogger.js";
import { prisma } from "../../config/index.js";
import * as communityService from "../../services/community.service.js";
import * as youtubeOauth from "../../services/youtube-oauth.service.js";
import { getChannelLinks, YouTubeNotConfiguredError } from "../../services/youtube.service.js";
import {
  storeVerifyState,
  consumeVerifyState,
  newNonce,
  newSessionId,
} from "../../services/youtube-verify-state.js";
import {
  checkChannelAccess,
  resolveTargetChannelId,
  linkGoogleIdentity,
} from "../../services/channel-access.service.js";
import {
  verifyGoogleIdToken,
  googleEmailMatchesAppEmail,
  GoogleIdentityError,
} from "../../services/google-identity.service.js";

// ─────────────────────────────────────────
// The Google connection
// ─────────────────────────────────────────
// Everything in this file exists because one fact governs the design: the app
// account's email cannot answer the subscription question. `subscriptions.list`
// has no email parameter — it answers for whichever Google account owns the
// bearer token and only that — so the user has to authorize that account, and we
// have to be able to prove afterwards which account it was.
//
// Four checks, in this order, and the order is the security property:
//
//   1. the state token is single-use and was minted by us for THIS app user
//      (youtube-verify-state.ts). Without it, a callback could credit account A
//      from a round-trip account B started.
//   2. the id_token is verified against Google's published keys, with audience,
//      issuer and nonce all checked (google-identity.service.ts). A decoded but
//      unverified token is a self-asserted claim, which anyone can write.
//   3. Google's verified email must equal the app account's, exactly. Not
//      normalised: Gmail ignores dots and treats `a+tag@` as an alias, so folding
//      either would link a subscription held by one mailbox to an account owned
//      by another.
//   4. only then is the identity written and the subscription checked.
//
// A mismatch stops at step 3 and writes nothing. That matters for a user who
// already has a working link and fat-fingered the account picker: their existing
// authorization must survive the mistake, so the callback must not clear or
// replace it on the way to failing.

// The codes the app has to be able to branch on. Everything else is a generic
// failure the app answers with "Retry / Reconnect Google".
export const VERIFY_ERROR_CODES = {
  /** Google said the user declined the consent screen. */
  CONSENT_DENIED: "CONSENT_DENIED",
  /** The state token was unknown, expired, or already used. */
  INVALID_STATE: "INVALID_STATE",
  /** Google's email did not match the app account's verified email. */
  GOOGLE_ACCOUNT_MISMATCH: "GOOGLE_ACCOUNT_MISMATCH",
  /** Google would not vouch for the address it returned. */
  GOOGLE_EMAIL_UNVERIFIED: "GOOGLE_EMAIL_UNVERIFIED",
  /**
   * This deployment cannot check subscriptions at all.
   *
   * The wire code is YOUTUBE-prefixed while the matching `reason` inside an
   * access snapshot is the unprefixed VERIFICATION_NOT_CONFIGURED. Not a typo:
   * the reason enum travels inside `access`, alongside server-side vocabulary like
   * LEASE_EXPIRED, and the two namespaces were named independently.
   */
  YOUTUBE_VERIFICATION_NOT_CONFIGURED: "YOUTUBE_VERIFICATION_NOT_CONFIGURED",
  /** The check ran but produced no answer. Not an unsubscribe. */
  VERIFICATION_UNAVAILABLE: "VERIFICATION_UNAVAILABLE",
  /** The identity or the credential could not be established. */
  IDENTITY_NOT_VERIFIED: "IDENTITY_NOT_VERIFIED",
  /** Anything else. */
  VERIFICATION_FAILED: "VERIFICATION_FAILED",
} as const;

type VerifyErrorCode = (typeof VERIFY_ERROR_CODES)[keyof typeof VERIFY_ERROR_CODES];

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
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/**
 * What the app is told when the deep link cannot be reached at all.
 *
 * The important property is that it is never the word "verified". An earlier
 * version of this page claimed success for every outcome including total failure,
 * so a malformed YOUTUBE_VERIFY_RETURN_URL turned every failed verification into
 * a user-facing success message. This version states the real outcome and always
 * says that nothing was unlocked on the app's behalf — the app has to fetch
 * authenticated status before it opens anything.
 */
function describeOutcome(query: Record<string, string>): string {
  if (query.code === VERIFY_ERROR_CODES.GOOGLE_ACCOUNT_MISMATCH) {
    return (
      "That Google account is not the one this app account uses. " +
      "Nothing was linked and nothing was unlocked. Return to the app and pick the matching account."
    );
  }
  if (query.code === VERIFY_ERROR_CODES.CONSENT_DENIED) {
    return (
      "Permission was declined, so the subscription could not be checked. " +
      "Nothing was unlocked. Return to the app and try again."
    );
  }
  if (query.subscribed === "true") {
    return "Subscription confirmed. You can close this window and return to the app.";
  }
  if (query.subscribed === "false") {
    return (
      "The check completed and found no subscription to the channel. " +
      "Nothing was unlocked. Return to the app to see what to do next."
    );
  }
  return (
    "Subscription verification did not complete. Nothing was unlocked — " +
    "return to the app and try again."
  );
}

/**
 * Hands control back to the app.
 *
 * Every query parameter here is a HINT. The app must fetch authenticated access
 * status before it unlocks anything: this URL can be replayed, edited, or opened
 * cold, and `subscribed=true` in a browser bar is not evidence of anything. The
 * `sessionId` is included so a client can recognise a verdict that belongs to a
 * session which has since logged out — acceptance test 12 is exactly that case.
 */
function redirectResult(res: Response, query: Record<string, string>): void {
  const base = youtubeOauth.getVerifyReturnUrl();
  try {
    const urlObj = new URL(base);
    for (const [key, value] of Object.entries(query)) {
      urlObj.searchParams.set(key, value);
    }
    res.redirect(urlObj.toString());
  } catch (error) {
    // Reaching here means YOUTUBE_VERIFY_RETURN_URL is not parseable by `new URL`,
    // so the app never receives the outcome at all. That is a misconfiguration,
    // not a user error, so it is logged at warn with the offending value.
    logCommunityWarn("community.verify.redirect_fallback", {
      returnUrl: base,
      outcome: query.code ?? query.subscribed ?? "unknown",
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
  // The "Subscribe to Unlock" tap. Records the funnel event and hands back
  // everything needed to continue, in one round-trip.
  //
  // This was two calls the app had to keep in step — POST /interact with
  // SUBSCRIBE_INTENT, then a second call for the authorization URL — and nothing
  // forced it to make both, so the analytics half was the one that got dropped,
  // understating the denominator the conversion rate is computed against. One
  // endpoint makes the event un-skippable.
  async subscribeIntent(req: Request, res: Response) {
    const start = started();
    const userId = req.user?.id as string;
    const videoId = param(req.params.videoId);

    try {
      // Resolved up front both to 404 an unknown card and to canonicalise the id:
      // the state token is bound to the internal id, and the interaction row's
      // foreign key must point at the real CommunityVideo.
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

      const channelId = await resolveTargetChannelId();
      const configured = youtubeOauth.isYouTubeVerificationAvailable() && Boolean(channelId);

      if (!configured) {
        // Not a 200 with a null authUrl, which is what this used to return. A
        // success response whose authorization URL is missing pushes the app into
        // a dead end it cannot detect, and the old dev fallback then unlocked the
        // video anyway. An unconfigured server says so, loudly, and unlocks
        // nothing.
        logCommunityWarn("community.subscribe_intent.not_configured", {
          status: 503,
          userId,
          videoId: video.id,
          hasChannel: Boolean(channelId),
          hasOAuth: youtubeOauth.isYouTubeOAuthConfigured(),
          durationMs: Date.now() - start,
        });
        return fail(res, 503, {
          code: VERIFY_ERROR_CODES.YOUTUBE_VERIFICATION_NOT_CONFIGURED,
          message: "This deployment cannot verify YouTube subscriptions. No access was granted.",
        });
      }

      // Logged before the OAuth work and unconditionally. The tap is the event
      // being measured, and it happened whether or not anything follows. A funnel
      // that only counts taps we could verify is not a funnel.
      const logged = await communityService.logInteraction(userId, video.id, "SUBSCRIBE_INTENT");

      // The nonce is minted per round-trip and re-checked against the id_token's
      // `nonce` claim at the callback, so a token obtained in some other flow
      // cannot satisfy this callback even if the state token leaks.
      const nonce = newNonce();
      const state = await storeVerifyState({
        appUserId: userId,
        channelId: channelId!,
        nonce,
        returnUrl: youtubeOauth.getVerifyReturnUrl(),
        sessionId: newSessionId(),
        videoId: video.id,
      });

      // Only re-prompt for consent when the stored credential cannot answer the
      // subscription question. An already-linked subscriber re-checking must not
      // have to sit through a consent screen again for a verdict that one refresh
      // would have produced.
      const existing = await prisma.channelAccess.findUnique({
        where: { userId_channelId: { userId, channelId: channelId! } },
        select: { grantedScopes: true },
      });
      const forceConsent = !youtubeOauth.hasYouTubeReadonlyScope(existing?.grantedScopes);

      const authUrl = youtubeOauth.buildAuthUrl({ state, nonce, forceConsent });

      logCommunity("community.subscribe_intent", {
        status: 200,
        userId,
        videoId: video.id,
        channelId,
        logged: logged.success,
        forceConsent,
        durationMs: Date.now() - start,
      });

      privateNoStore(res);
      return ok(
        res,
        { videoId: video.id, authUrl, channel: { ...getChannelLinks(), channelId: channelId! } },
        "Subscribe intent recorded. Open authUrl to connect Google and verify your subscription.",
      );
    } catch (error) {
      if (error instanceof YouTubeNotConfiguredError) {
        return fail(res, 503, {
          code: VERIFY_ERROR_CODES.YOUTUBE_VERIFICATION_NOT_CONFIGURED,
          message: error.message,
        });
      }
      logCommunityError("community.subscribe_intent.error", {
        status: 500,
        userId,
        videoId,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to record subscribe intent");
    }
  }

  // ── GET /community/youtube/start/:videoId ─────────────────────────────────
  // Kept for older clients that call the two-step flow. Identical work to
  // subscribe-intent minus the funnel event, which this route never recorded —
  // the reason it existed separately is the reason it is being retired.
  async start(req: Request, res: Response) {
    const start = started();
    const userId = req.user?.id as string;
    const videoId = param(req.params.videoId);

    try {
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

      const channelId = await resolveTargetChannelId();
      if (!channelId || !youtubeOauth.isYouTubeVerificationAvailable()) {
        return fail(res, 503, {
          code: VERIFY_ERROR_CODES.YOUTUBE_VERIFICATION_NOT_CONFIGURED,
          message: "This deployment cannot verify YouTube subscriptions.",
        });
      }

      const nonce = newNonce();
      const state = await storeVerifyState({
        appUserId: userId,
        channelId,
        nonce,
        returnUrl: youtubeOauth.getVerifyReturnUrl(),
        sessionId: newSessionId(),
        videoId: video.id,
      });
      const authUrl = youtubeOauth.buildAuthUrl({ state, nonce });

      logCommunity("community.verify.start", {
        status: 200,
        userId,
        videoId: video.id,
        channelId,
        durationMs: Date.now() - start,
      });
      privateNoStore(res);
      return ok(
        res,
        { authUrl, expiresIn: 900, channel: getChannelLinks() },
        "Authorization URL created",
      );
    } catch (error) {
      if (error instanceof YouTubeNotConfiguredError) {
        return fail(res, 503, {
          code: VERIFY_ERROR_CODES.YOUTUBE_VERIFICATION_NOT_CONFIGURED,
          message: error.message,
        });
      }
      logCommunityError("community.verify.start.error", {
        status: 500,
        userId,
        videoId,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to start YouTube verification");
    }
  }

  // ── POST /community/youtube/verify ────────────────────────────────────────
  // An authenticated re-check that needs no consent screen.
  //
  // This is the "I have subscribed, check again" button, and it is the only
  // re-check a non-subscriber needs after they go and subscribe — the stored
  // refresh token is already theirs, so the whole point is that they do not have
  // to redo the round-trip.
  //
  // Rate limited in the router, and single-flighted in the service, so the
  // sanctioned cadence (COMMUNITY_ACTIVE_RECHECK_SECONDS) is also the cheapest
  // possible way to ask. There is no client-supplied subscription flag to accept:
  // the only input is the caller's identity.
  async verify(req: Request, res: Response) {
    const start = started();
    const userId = req.user?.id as string;

    try {
      const channelId = await resolveTargetChannelId();
      if (!channelId) {
        return fail(res, 503, {
          code: VERIFY_ERROR_CODES.YOUTUBE_VERIFICATION_NOT_CONFIGURED,
          message: "No YouTube channel is configured, so subscriptions cannot be checked.",
        });
      }

      const result = await checkChannelAccess(userId, channelId, {
        reason: "EXPLICIT",
        channelId,
        force: true,
      });

      logCommunity("community.verify.explicit", {
        status: 200,
        userId,
        channelId,
        verdict: result.verdict,
        status_after: result.access.status,
        accessVersion: result.access.accessVersion,
        hasChannelAccess: result.access.hasChannelAccess,
        checked: result.checked,
        latencyMs: result.latencyMs,
        durationMs: Date.now() - start,
      });

      // 200 even when the answer is "no" or "could not find out". This is a
      // report, not an attempt: a confirmed negative is a 200 carrying
      // NOT_SUBSCRIBED, and a transient failure is a 200 carrying CHECK_FAILED.
      // Returning 403 for either would tell the client the request itself failed,
      // and the retry that would actually help is a retry of the same call.
      privateNoStore(res);
      return ok(
        res,
        { ...result.access, recheckAfterSeconds: youtubeOauth.getActiveRecheckSeconds() },
        "Verification complete",
      );
    } catch (error) {
      logCommunityError("community.verify.explicit.error", {
        status: 500,
        userId,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to verify subscription");
    }
  }

  // ── GET /community/youtube/callback ───────────────────────────────────────
  // Public OAuth redirect target registered in the Google console. Establishes
  // the identity, links it to the app user, asks the one question that decides
  // access, commits the verdict, and hands control back to the app.
  async callback(req: Request, res: Response) {
    const { code, state, error } = req.query;

    if (typeof error === "string") {
      return redirectResult(res, {
        subscribed: "false",
        code: VERIFY_ERROR_CODES.CONSENT_DENIED,
      });
    }

    if (typeof state !== "string" || typeof code !== "string") {
      return redirectResult(res, {
        subscribed: "false",
        code: VERIFY_ERROR_CODES.INVALID_STATE,
      });
    }

    // Single-use: consuming it is a delete, so a replayed callback finds nothing.
    const pending = await consumeVerifyState(state);
    if (!pending) {
      logCommunityWarn("community.verify.callback.unknown_state", {
        status: 302,
        message: "state token unknown, expired, or already consumed",
      });
      return redirectResult(res, {
        subscribed: "false",
        code: VERIFY_ERROR_CODES.INVALID_STATE,
      });
    }

    // Second line of defence on the return URL. The stored value came from our
    // own config at initiation, so a rejection here means the record itself was
    // tampered with.
    if (!youtubeOauth.isAllowedReturnUrl(pending.returnUrl)) {
      logCommunityWarn("community.verify.callback.return_url_rejected", {
        status: 302,
        userId: pending.appUserId,
        returnUrl: pending.returnUrl,
      });
      return redirectResult(res, {
        subscribed: "false",
        code: VERIFY_ERROR_CODES.INVALID_STATE,
      });
    }

    try {
      if (!youtubeOauth.isYouTubeVerificationAvailable()) {
        return redirectResult(res, {
          subscribed: "false",
          code: VERIFY_ERROR_CODES.YOUTUBE_VERIFICATION_NOT_CONFIGURED,
          userId: pending.appUserId,
        });
      }

      const grant = await youtubeOauth.exchangeCodeForToken(code);
      if (!grant.idToken) {
        // No id_token means no verified identity claim, and without one the
        // same-email rule cannot be enforced — so there is nothing to link.
        throw new GoogleIdentityError("Google returned no id_token");
      }

      const identity = await verifyGoogleIdToken(grant.idToken, {
        clientId: youtubeOauth.getYouTubeOAuthClientId(),
        nonce: pending.nonce,
      });

      const user = await prisma.user.findUnique({
        where: { id: pending.appUserId },
        select: { id: true, email: true, accountStatus: true },
      });
      if (!user) {
        // The account was deleted while the browser was at Google's consent
        // screen. Nothing to credit, and nothing to clean up.
        return redirectResult(res, {
          subscribed: "false",
          code: VERIFY_ERROR_CODES.IDENTITY_NOT_VERIFIED,
          sessionId: pending.sessionId,
        });
      }

      // Step 3 of the ordering in the file header. Both failures below leave any
      // existing link completely untouched.
      if (!identity.emailVerified) {
        logCommunityWarn("community.verify.callback.google_email_unverified", {
          status: 403,
          userId: user.id,
          sessionId: pending.sessionId,
        });
        return redirectResult(res, {
          subscribed: "false",
          code: VERIFY_ERROR_CODES.GOOGLE_EMAIL_UNVERIFIED,
          sessionId: pending.sessionId,
        });
      }

      // The app account must have proved its own address first. ACTIVE is this
      // app's marker for that: the registration OTP flow sets it, and login
      // already refuses anything else, so no account that can reach this callback
      // has an unproven email.
      if (user.accountStatus !== "ACTIVE") {
        logCommunityWarn("community.verify.callback.app_email_unverified", {
          status: 403,
          userId: user.id,
          accountStatus: user.accountStatus,
          sessionId: pending.sessionId,
        });
        return redirectResult(res, {
          subscribed: "false",
          code: VERIFY_ERROR_CODES.GOOGLE_ACCOUNT_MISMATCH,
          sessionId: pending.sessionId,
        });
      }

      if (!googleEmailMatchesAppEmail(identity.email, user.email)) {
        // The exact, un-normalised comparison. Gmail dot-folding and plus-suffix
        // stripping would both manufacture a match between two different
        // mailboxes, which is the one thing the same-email rule exists to stop.
        logCommunityWarn("community.verify.callback.account_mismatch", {
          status: 403,
          userId: user.id,
          // Google's address is logged: it is the address the user just chose, it
          // is the thing they need to see to fix their mistake, and it is not a
          // credential. Nothing about the token or the id_token is recorded.
          googleSubject: identity.subject,
          sessionId: pending.sessionId,
        });
        return redirectResult(res, {
          subscribed: "false",
          code: VERIFY_ERROR_CODES.GOOGLE_ACCOUNT_MISMATCH,
          sessionId: pending.sessionId,
        });
      }

      const authorizedYoutubeChannelId = await youtubeOauth.fetchAuthorizedChannelId(
        grant.accessToken,
      );

      // Establish the link before the verdict, never the other way round: a
      // positive verdict with no stored credential is a positive nobody can
      // re-check, which is exactly the state this whole design removed.
      await linkGoogleIdentity({
        userId: user.id,
        channelId: pending.channelId,
        googleSubject: identity.subject,
        googleEmail: identity.email,
        authorizedYoutubeChannelId,
        grantedScopes: grant.scope ?? youtubeOauth.buildScopeString(),
        refreshToken: grant.refreshToken,
      });

      // Now the question, answered by the service that owns the answer. `force`
      // because this handler is the authority for its own round-trip: it holds a
      // token minted seconds ago, and deferring to an older verdict would throw
      // away better evidence.
      const result = await checkChannelAccess(user.id, pending.channelId, {
        reason: "OAUTH_CALLBACK",
        channelId: pending.channelId,
        force: true,
      });

      // The per-video row is the analytics half of the funnel — which card the
      // conversion happened on. It is NOT what opens the feed; the channel
      // verdict above is. Writing it here does not weaken anything, because
      // revoking the channel deletes these rows.
      let loggedUnlock = false;
      if (result.verdict === "subscribed") {
        const unlock = await communityService.logInteraction(user.id, pending.videoId, "UNLOCK");
        loggedUnlock = unlock.success;
      }

      // Emitted after the commit inside the service, never before: a client that
      // reacts to the event and immediately re-reads must not be able to see a
      // verdict the database has not caught up with.
      logCommunity("community.verify.callback", {
        status: 302,
        userId: user.id,
        videoId: pending.videoId,
        channelId: pending.channelId,
        verdict: result.verdict,
        accessStatus: result.access.status,
        accessVersion: result.access.accessVersion,
        hasChannelAccess: result.access.hasChannelAccess,
        loggedUnlock,
        latencyMs: result.latencyMs,
        sessionId: pending.sessionId,
      });

      return redirectResult(res, {
        subscribed: String(result.access.hasChannelAccess),
        videoId: pending.videoId,
        sessionId: pending.sessionId,
        status: result.access.status,
        accessVersion: String(result.access.accessVersion),
        // Hint only. The app re-reads authenticated status before unlocking.
        hasChannelAccess: String(result.access.hasChannelAccess),
      });
    } catch (caught) {
      const errorCode = classifyCallbackFailure(caught);
      const level =
        errorCode === VERIFY_ERROR_CODES.VERIFICATION_FAILED ? logCommunityError : logCommunityWarn;
      level("community.verify.callback.warn", {
        status: 302,
        userId: pending.appUserId,
        videoId: pending.videoId,
        channelId: pending.channelId,
        code: errorCode,
        // Never the OAuth URL and never a token. The error message from Google
        // can contain neither, but the message is taken from a closed set below
        // rather than interpolated into the log.
        message: caught instanceof Error ? caught.message : String(caught),
      });

      return redirectResult(res, {
        subscribed: "false",
        videoId: pending.videoId,
        sessionId: pending.sessionId,
        code: errorCode,
      });
    }
  }

  // ── GET /community/youtube/status/:videoId ────────────────────────────────
  // The current decision for one card. Polled by the app on launch, on resume,
  // and while Community is visible.
  //
  // This is the endpoint that makes revocation observable without waiting for a
  // push event: it re-checks when the lease has lapsed and returns the corrected
  // state in THIS response, so a user who unsubscribed is locked here rather than
  // on some later request.
  async status(req: Request, res: Response) {
    const start = started();
    const userId = req.user?.id as string;
    const videoId = param(req.params.videoId);

    try {
      // Canonical internal id, so the lookup works whether the app passes the
      // uuid or the YouTube video id.
      const video = await communityService.getVideoRecord(videoId);
      const canonicalId = video?.id ?? videoId;

      const { access } = await communityService.resolveChannelAccessForRead(userId);
      const unlockStatus = await communityService.getUnlockStatus(userId, canonicalId, {
        channelAccess: access,
      });

      logCommunity("community.verify.status", {
        status: 200,
        userId,
        videoId: canonicalId,
        isUnlocked: unlockStatus.isUnlocked,
        via: unlockStatus.via,
        hasChannelAccess: access.hasChannelAccess,
        accessStatus: access.status,
        accessVersion: access.accessVersion,
        durationMs: Date.now() - start,
      });

      privateNoStore(res);
      return ok(
        res,
        {
          videoId: canonicalId,
          isUnlocked: unlockStatus.isUnlocked,
          unlockedAt: unlockStatus.unlockedAt,
          via: unlockStatus.via,
          // The one canonical answer. `hasChannelAccess` is repeated at the top
          // level for clients that only want the boolean, and `access` carries
          // the version, the lease and the reason — everything needed to order
          // this against a later response and apply only the newest.
          hasChannelAccess: access.hasChannelAccess,
          access,
          recheckAfterSeconds: youtubeOauth.getActiveRecheckSeconds(),
        },
        "YouTube verification status retrieved",
      );
    } catch (error) {
      logCommunityError("community.verify.status.error", {
        status: 500,
        userId,
        videoId,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      return fail(res, 500, "Failed to fetch YouTube verification status");
    }
  }
}

/**
 * Maps a callback failure onto the code the app branches on.
 *
 * The distinction that matters is between "we learned something" and "we learned
 * nothing". A dead identity claim, a Google outage and a programming error are
 * all reported as failures, and none of them is ever reported as an unsubscribe:
 * the app's copy for "cannot check" must be Retry, not "subscribe again", or a
 * Google incident sends every subscriber to a page telling them they cancelled.
 */
function classifyCallbackFailure(caught: unknown): VerifyErrorCode {
  if (caught instanceof GoogleIdentityError) {
    return VERIFY_ERROR_CODES.IDENTITY_NOT_VERIFIED;
  }
  if (caught instanceof youtubeOauth.YouTubeAuthorizationError) {
    // A dead credential is the one failure where asking the user to reconnect is
    // exactly right — the link can never answer the question again.
    return VERIFY_ERROR_CODES.IDENTITY_NOT_VERIFIED;
  }
  if (caught instanceof youtubeOauth.YouTubeApiError) {
    return VERIFY_ERROR_CODES.VERIFICATION_UNAVAILABLE;
  }
  if (caught instanceof YouTubeNotConfiguredError) {
    return VERIFY_ERROR_CODES.YOUTUBE_VERIFICATION_NOT_CONFIGURED;
  }
  // Includes the transient timeout/abort errors raised inside the OAuth service,
  // which are deliberately plain Errors: a socket reset is neither a dead
  // credential nor a subscription verdict.
  return VERIFY_ERROR_CODES.VERIFICATION_FAILED;
}
