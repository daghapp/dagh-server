// ─────────────────────────────────────────
// YouTube Subscription Verification — OAuth2
// ─────────────────────────────────────────
// Optional server-side check that a user is actually subscribed to the
// configured channel before unlocking full video access (Phase 2, Section 2 of
// the community funnel workflow).
//
// Flow: the app calls GET /community/youtube/start/:videoId, which returns a
// Google authorization URL carrying a signed JWT state (todaych user + video).
// The user authorizes the `youtube.readonly` scope with the YouTube account
// they subscribe with; the callback exchanges the code, asks the YouTube Data
// API `subscriptions` endpoint whether that account is subscribed to the
// channel, and — when it is — unlocks the video.
//
// Verdicts are cached briefly (YOUTUBE_VERIFY_CACHE_MS, default 1h) in Redis
// when available, otherwise in-memory, so feed loads / status polls never burn
// API quota or add latency.

import jwt from "jsonwebtoken";
import { getRedisClient } from "../config/redis.js";
import type { RedisClientType } from "redis";
import { YouTubeNotConfiguredError, YouTubeApiError } from "./youtube.service.js";

const OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_SUBSCRIPTIONS_URL = "https://www.googleapis.com/youtube/v3/subscriptions";
const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const REQUEST_TIMEOUT_MS = 10_000;
const STATE_TTL_MS = 15 * 60 * 1000; // state tokens are short-lived (15 minutes)

// OAuth state tokens are signed with the access-token secret. Production always
// has one (protectedRoute fails fast at boot otherwise); tests fall back to a
// fixed value so the helpers stay unit-testable.
const VERIFY_STATE_SECRET =
  process.env.JWT_ACCESS_SECRET || (process.env.NODE_ENV === "test" ? "test-verify-state" : "");

// ── Configuration ─────────────────────────────────────────────────────────────

export function isYouTubeOAuthConfigured(): boolean {
  return Boolean(
    process.env.YOUTUBE_OAUTH_CLIENT_ID?.trim() && process.env.YOUTUBE_OAUTH_CLIENT_SECRET?.trim(),
  );
}

export function getYouTubeOAuthRedirectUri(): string {
  const explicit = process.env.YOUTUBE_OAUTH_REDIRECT_URI?.trim();
  if (explicit) return explicit;

  const apiUrl = process.env.API_URL?.trim();
  if (apiUrl) return `${apiUrl.replace(/\/$/, "")}/community/youtube/callback`;

  throw new YouTubeNotConfiguredError(
    "No OAuth redirect URI — set YOUTUBE_OAUTH_REDIRECT_URI or API_URL",
  );
}

// The mobile deep link the browser/YouTube app is redirected to after the flow
// completes (default daghapp://youtube/verify, overridable via env).
export function getVerifyReturnUrl(): string {
  return process.env.YOUTUBE_VERIFY_RETURN_URL?.trim() || "daghapp://youtube/verify";
}

// ── OAuth state ────────────────────────────────────────────────────────────────

export interface VerifyStatePayload {
  userId: string;
  videoId: string;
}

export function signVerifyState(userId: string, videoId: string): string {
  if (!VERIFY_STATE_SECRET) {
    throw new YouTubeNotConfiguredError("Missing JWT_ACCESS_SECRET for verify-state signing");
  }
  return jwt.sign({ userId, videoId }, VERIFY_STATE_SECRET, {
    expiresIn: STATE_TTL_MS / 1000,
  });
}

export function verifyStateToken(state: string): VerifyStatePayload {
  if (!VERIFY_STATE_SECRET) {
    throw new YouTubeNotConfiguredError("Missing JWT_ACCESS_SECRET for verify-state signing");
  }
  const decoded = jwt.verify(state, VERIFY_STATE_SECRET) as Partial<VerifyStatePayload>;
  if (typeof decoded.userId !== "string" || typeof decoded.videoId !== "string") {
    throw new Error("Malformed verify-state payload");
  }
  return { userId: decoded.userId, videoId: decoded.videoId };
}

// ── Authorization URL ─────────────────────────────────────────────────────────

export function buildAuthUrl(state: string): string {
  if (!isYouTubeOAuthConfigured()) {
    throw new YouTubeNotConfiguredError(
      "YouTube OAuth is not configured — set YOUTUBE_OAUTH_CLIENT_ID and YOUTUBE_OAUTH_CLIENT_SECRET",
    );
  }

  const url = new URL(OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", process.env.YOUTUBE_OAUTH_CLIENT_ID!.trim());
  url.searchParams.set("redirect_uri", getYouTubeOAuthRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_READONLY_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("state", state);
  return url.toString();
}

// ── Token exchange ────────────────────────────────────────────────────────────

export interface TokenGrant {
  /** Short-lived (~1h) credential, used for the immediate subscription check. */
  accessToken: string;
  /**
   * Long-lived credential used to mint future access tokens, so a granted
   * channel subscription can be re-checked long after this round-trip.
   *
   * Null when Google did not return one. With `access_type=offline` Google issues
   * a refresh token on the first authorization for a given client/account pair
   * and may omit it afterwards, so a returning subscriber can legitimately
   * exchange a code and get none. Callers must treat null as "this grant cannot
   * be re-verified", not as "this user is not subscribed".
   */
  refreshToken: string | null;
}

export async function exchangeCodeForToken(code: string): Promise<TokenGrant> {
  if (!isYouTubeOAuthConfigured()) {
    throw new YouTubeNotConfiguredError("YouTube OAuth is not configured");
  }

  const body = new URLSearchParams({
    code,
    client_id: process.env.YOUTUBE_OAUTH_CLIENT_ID!.trim(),
    client_secret: process.env.YOUTUBE_OAUTH_CLIENT_SECRET!.trim(),
    redirect_uri: getYouTubeOAuthRedirectUri(),
    grant_type: "authorization_code",
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
    } | null;

    if (!res.ok || !data?.access_token) {
      throw new YouTubeApiError(
        data?.error
          ? `Google token exchange failed: ${data.error}`
          : `Google token exchange failed with ${res.status}`,
        res.status || 502,
      );
    }

    return {
      accessToken: data.access_token,
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Token refresh ─────────────────────────────────────────────────────────────
// The subscription grant outlives the access token issued alongside it, so the
// sweep that re-checks for cancellations mints a fresh one from the stored
// refresh token. Google normally omits refresh_token from a refresh response, so
// the caller's existing token is carried through untouched.

export async function refreshAccessToken(refreshToken: string): Promise<TokenGrant> {
  if (!isYouTubeOAuthConfigured()) {
    throw new YouTubeNotConfiguredError("YouTube OAuth is not configured");
  }

  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: process.env.YOUTUBE_OAUTH_CLIENT_ID!.trim(),
    client_secret: process.env.YOUTUBE_OAUTH_CLIENT_SECRET!.trim(),
    grant_type: "refresh_token",
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
    } | null;

    if (!res.ok || !data?.access_token) {
      throw new YouTubeApiError(
        data?.error
          ? `Google token refresh failed: ${data.error}`
          : `Google token refresh failed with ${res.status}`,
        res.status || 502,
      );
    }

    return {
      accessToken: data.access_token,
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : refreshToken,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Subscription check ────────────────────────────────────────────────────────
// Checks whether the authorized account is subscribed to the channel. The API
// returns exactly one item when the user subscribes to `forChannelId` (mine=true),
// and an empty items list otherwise. Costs 1 quota unit per call.

export async function checkChannelSubscription(
  accessToken: string,
  channelId: string,
): Promise<boolean> {
  const url = new URL(YOUTUBE_SUBSCRIPTIONS_URL);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("mine", "true");
  url.searchParams.set("forChannelId", channelId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as { items?: unknown[] } | null;

    if (!res.ok) {
      const message =
        (data as { error?: { message?: string } | undefined } | null)?.error?.message ??
        `YouTube subscriptions API responded with ${res.status}`;
      throw new YouTubeApiError(message, res.status || 502);
    }

    return (data?.items?.length ?? 0) > 0;
  } finally {
    clearTimeout(timer);
  }
}

// ── Verification cache ────────────────────────────────────────────────────────
// Keyed by userId. Redis-first with a bounded in-memory fallback so single
// instance (no REDIS_URL) deployments still get the quota protection.

const CACHE_PREFIX = "yt:sub:";
const inMemoryCache = new Map<string, { subscribed: boolean; verifiedAt: number }>();

export function verificationCacheKey(userId: string): string {
  return `${CACHE_PREFIX}${userId}`;
}

export function getVerificationCacheTtlMs(): number {
  return Number(process.env.YOUTUBE_VERIFY_CACHE_MS || 60 * 60 * 1000);
}

// How long a channel grant may go unconfirmed before the sweep re-checks it.
// This is the window in which a user who unsubscribes keeps access, so it trades
// detection latency against YouTube quota: one re-check per grant per window,
// and each check costs a token refresh plus 1 quota unit. Default 24h.
export function getChannelReverifyIntervalMs(): number {
  return Number(process.env.YOUTUBE_CHANNEL_REVERIFY_INTERVAL_MS || 24 * 60 * 60 * 1000);
}

export interface CachedVerification {
  subscribed: boolean;
  verifiedAt: string;
}

export async function getCachedVerification(userId: string): Promise<CachedVerification | null> {
  const redis = getRedisClient() as RedisClientType | null;
  if (redis) {
    const raw = await redis.get(verificationCacheKey(userId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { subscribed?: unknown; verifiedAt?: unknown };
      if (typeof parsed.subscribed === "boolean" && typeof parsed.verifiedAt === "string") {
        return { subscribed: parsed.subscribed, verifiedAt: parsed.verifiedAt };
      }
    } catch {
      return null;
    }
    return null;
  }

  const entry = inMemoryCache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.verifiedAt > getVerificationCacheTtlMs()) {
    inMemoryCache.delete(userId);
    return null;
  }
  return { subscribed: entry.subscribed, verifiedAt: new Date(entry.verifiedAt).toISOString() };
}

export async function setCachedVerification(userId: string, subscribed: boolean): Promise<void> {
  const verifiedAt = Date.now();
  const redis = getRedisClient() as RedisClientType | null;
  if (redis) {
    await redis.set(
      verificationCacheKey(userId),
      JSON.stringify({ subscribed, verifiedAt: new Date(verifiedAt).toISOString() }),
      { PX: getVerificationCacheTtlMs() },
    );
    return;
  }
  inMemoryCache.set(userId, { subscribed, verifiedAt });
}
