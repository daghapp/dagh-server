// ─────────────────────────────────────────
// YouTube subscription verification — OAuth2 against the USER's Google account
// ─────────────────────────────────────────
// This file is the boundary between "what we store" and "what YouTube says".
// It holds everything that talks to Google on the user's behalf: the
// authorization URL, the code exchange, the token refresh, and the one call that
// answers the only question that matters — is the identity that authorized us
// subscribed to the configured channel.
//
// ── Why the check needs a Google credential at all ─────────────────────────────
// The app's email identifies the app account. It cannot answer the subscription
// question, because subscriptions.list has no email parameter: it answers for
// whichever account owns the bearer token, and only that. So the user must
// authorize the Google/YouTube account they actually subscribe with, and the
// server holds a renewable credential for it.
//
// This is the same credential, re-used across logins. That is why it is stored
// (sealed, see channel-access.service.ts) and why a refresh is part of the check
// rather than part of a fresh consent: re-prompting on every login would be a
// consent screen per app launch, which is not a product anybody would accept.
//
// ── The asymmetry that matters ─────────────────────────────────────────────────
// Every function here throws one of two error types, and the distinction is the
// whole contract with channel-access.service.ts:
//
//   YouTubeAuthorizationError  the CREDENTIAL is dead — 400 invalid_grant, 401,
//                              a token that cannot answer subscriptions.list.
//                              Unsubscribe detection has stopped working, and
//                              the correct response is to ask the user to
//                              reconnect. Denying access.
//
//   YouTubeApiError            WE could not find out — 429, 5xx, a timeout, a
//                              socket reset. Nothing was learned. Throwing this
//                              must never be read as "the user unsubscribed",
//                              because a Google outage would then lock out every
//                              subscriber at once.
//
// Neither is ever converted into the other, and neither is ever guessed at from
// the shape of a response. A verdict comes from a successful response's
// `items` array, or from nowhere.

import { envNumber } from "../helpers/env-number.js";
import { YouTubeNotConfiguredError } from "./youtube.service.js";

const OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/youtube/v3";
const REQUEST_TIMEOUT_MS = 10_000;

// ── Scopes ─────────────────────────────────────────────────────────────────────
// `openid email` is what turns an authorization into an IDENTITY: without it
// there is no id_token, so there is nothing to compare against the app account's
// own email, and the same-email rule cannot be enforced at all.
//
// `youtube.readonly` is what makes subscriptions.list answerable. A plain Google
// sign-in does NOT include it, which is why "logged in with Google" and "can we
// verify your subscription" are two different states, and why an ordinary app
// login leaves `requiresGoogleConnection: true`.
export const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
export const OPENID_EMAIL_SCOPES = ["openid", "email"] as const;

export function buildScopeString(): string {
  return [...OPENID_EMAIL_SCOPES, YOUTUBE_READONLY_SCOPE].join(" ");
}

/**
 * Whether a stored scope string can answer the subscription question.
 *
 * Checked on every verification, before any network call. A credential granted by
 * an ordinary app login is real and valid — it just cannot list subscriptions —
 * and discovering that by spending a token refresh and a quota unit to be told
 * "insufficient scope" is the same verdict for more money.
 */
export function hasYouTubeReadonlyScope(grantedScopes: string | null | undefined): boolean {
  if (!grantedScopes) return false;
  return grantedScopes.split(/\s+/).includes(YOUTUBE_READONLY_SCOPE);
}

// ── Errors ─────────────────────────────────────────────────────────────────────

export class YouTubeAuthorizationError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "YouTubeAuthorizationError";
    this.status = status;
  }
}

export class YouTubeApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "YouTubeApiError";
    this.status = status;
  }
}

/**
 * A timeout or a socket failure.
 *
 * Categorised as a plain Error rather than one of the two above, because it is
 * neither: the credential may be perfectly good and Google may be perfectly
 * reachable a second later. Callers classify it as CHECK_FAILED, which changes
 * nothing about the stored access.
 */
function transient(message: string): Error {
  const error = new Error(message);
  error.name = "YouTubeTransientError";
  return error;
}

/**
 * A response we cannot use, split by what the status code actually proves.
 *
 * 400/401 → the credential is dead. 400 on the token endpoint is `invalid_grant`
 * or `unauthorized_client`, and 401 on the API is a rejected token; both mean
 * "reconnect", and both mean an unsubscribe could no longer be detected, so
 * access has to close.
 *
 * 403 → insufficient scope. Same conclusion, same handling: this token cannot
 * answer subscriptions.list and never will.
 *
 * 429 and 5xx → Google is having a moment. No information either way.
 */
/**
 * Turns a non-2xx token response into the right error class.
 *
 * `body` is `unknown` rather than a shaped error object because a token endpoint
 * can answer with anything — a string, an HTML error page from a proxy, a JSON
 * success-shaped body with a 500 — and an unrecognised shape must still be
 * classified by status code. Typing it as `{ error?: unknown }` would have
 * rejected every one of those shapes at the call site instead of at runtime,
 * where they belong.
 */
function classifyResponseError(status: number, body: unknown): Error {
  const detail = readGoogleError(body);
  const message = detail ?? `Google responded with HTTP ${status}`;

  if (status === 400 || status === 401 || status === 403) {
    return new YouTubeAuthorizationError(message, status);
  }
  return new YouTubeApiError(message, status);
}

/**
 * Best-effort extraction of a human-readable reason from a Google error body.
 *
 * Used for the error *class* and for a coarse reason on the failure. Never for
 * anything a client sees verbatim: Google's `error_description` can echo the
 * client_id, and this codebase does not put raw Google text in a response body.
 */
function readGoogleError(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = (body as { error?: unknown }).error;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const asRecord = raw as { message?: unknown; error?: unknown };
    if (typeof asRecord.message === "string") return asRecord.message;
    if (typeof asRecord.error === "string") return asRecord.error;
  }
  return null;
}

// ── Configuration ──────────────────────────────────────────────────────────────

/** The OAuth client credentials exist. Necessary, not sufficient — see below. */
export function isYouTubeOAuthConfigured(): boolean {
  return Boolean(
    process.env.YOUTUBE_OAUTH_CLIENT_ID?.trim() && process.env.YOUTUBE_OAUTH_CLIENT_SECRET?.trim(),
  );
}

/**
 * Whether this deployment can check subscriptions at all.
 *
 * Deliberately stricter than "are the client credentials present": a redirect URI
 * we cannot mint is a credential that cannot complete a round-trip, and an
 * unconfigured deployment must answer CHECK_FAILED rather than quietly hand out
 * standing access. `getYouTubeOAuthRedirectUri` throws on the same conditions, so
 * this is the non-throwing form of the question.
 */
export function isYouTubeVerificationAvailable(): boolean {
  if (!isYouTubeOAuthConfigured()) return false;
  try {
    getYouTubeOAuthRedirectUri();
    return true;
  } catch {
    return false;
  }
}

export function getYouTubeOAuthClientId(): string {
  const id = process.env.YOUTUBE_OAUTH_CLIENT_ID?.trim();
  if (!id) {
    throw new YouTubeNotConfiguredError(
      "YouTube OAuth is not configured — set YOUTUBE_OAUTH_CLIENT_ID and YOUTUBE_OAUTH_CLIENT_SECRET",
    );
  }
  return id;
}

/**
 * The HTTPS backend callback. Registered with Google; never a mobile deep link.
 *
 * The system browser completes this leg, and control only returns to the app
 * afterwards through a separate redirect — so the app's `diasporansync://` URL
 * is not, and cannot be, a Google-registered redirect target.
 */
export function getYouTubeOAuthRedirectUri(): string {
  const explicit = process.env.YOUTUBE_OAUTH_REDIRECT_URI?.trim();
  if (explicit) return explicit;

  const apiUrl = process.env.API_URL?.trim();
  if (apiUrl) return `${apiUrl.replace(/\/$/, "")}/community/youtube/callback`;

  throw new YouTubeNotConfiguredError(
    "No OAuth redirect URI — set YOUTUBE_OAUTH_REDIRECT_URI or API_URL",
  );
}

/**
 * The mobile deep link handed control back to once verification has finished.
 *
 * Its query parameters are HINTS ONLY. A callback can say `subscribed=true` and
 * the app must still fetch authenticated access status before unlocking anything;
 * the parameters exist so the app can tell the user where they landed, not so it
 * can decide anything.
 */
export function getVerifyReturnUrl(): string {
  return process.env.YOUTUBE_VERIFY_RETURN_URL?.trim() || "diasporansync://youtube/verify";
}

/**
 * Is this deep link one we are willing to redirect a browser to?
 *
 * Allowlisted rather than validated, because the value is compared against a
 * fixed set of configured schemes. A callback never supplies its own return URL —
 * the one it gets was stored server-side when the flow started — so this is a
 * second line of defence against a poisoned state record, not the primary one.
 */
export function isAllowedReturnUrl(url: string): boolean {
  const allowed = (process.env.YOUTUBE_VERIFY_RETURN_URL_ALLOWLIST ?? getVerifyReturnUrl())
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return allowed.includes(url.trim());
}

// ── Freshness ──────────────────────────────────────────────────────────────────

/**
 * How long a confirmed positive is honoured without re-asking Google.
 *
 * This is the revocation latency floor for the whole system, and the reason the
 * access record is a lease rather than a flag. YouTube publishes no unsubscribe
 * event — the documented push feed covers uploads and metadata edits, and the
 * Subscribe Button's subscribe/unsubscribe events are deprecated — so the only
 * way to learn about a cancellation is to ask. A positive answer is therefore
 * trusted for exactly this long and no longer, and no failure may extend it.
 *
 * Lower is faster to revoke and more expensive: every active user costs one
 * subscriptions.list call (1 quota unit) per lease. The default of 60s costs
 * ~1,440 units per continuously-active user per day, so it is priced against the
 * project's real quota, not chosen for convenience.
 */
export function getAccessLeaseMs(): number {
  return envNumber("COMMUNITY_ACCESS_LEASE_SECONDS", 60, 5, 3600) * 1000;
}

/**
 * The cadence we ask active clients to re-check at.
 *
 * Two jobs. It is advertised in the access object so a client knows how often to
 * poll instead of hammering the status endpoint, and it is the floor for
 * POST /community/youtube/verify, so an explicit re-check cannot be cheaper for
 * the attacker than the sanctioned cadence.
 */
export function getActiveRecheckSeconds(): number {
  return envNumber("COMMUNITY_ACTIVE_RECHECK_SECONDS", 60, 5, 3600);
}

/**
 * Reports the state of the subscription gate at boot.
 *
 * There is no fail-open branch here any more, and that is the point. The previous
 * version opened the gate when OAuth was unconfigured and printed a banner saying
 * so — which meant a misconfigured deployment let any authenticated caller unlock
 * any video, and said so only in a startup log nobody reads. The service now
 * answers CHECK_FAILED and closes access, so an unconfigured deployment fails
 * visibly instead of quietly succeeding.
 */
export function logYouTubeGateStatus(): void {
  const missing: string[] = [];
  if (!process.env.YOUTUBE_OAUTH_CLIENT_ID?.trim()) missing.push("YOUTUBE_OAUTH_CLIENT_ID");
  if (!process.env.YOUTUBE_OAUTH_CLIENT_SECRET?.trim()) missing.push("YOUTUBE_OAUTH_CLIENT_SECRET");
  if (!process.env.YOUTUBE_OAUTH_REDIRECT_URI?.trim() && !process.env.API_URL?.trim()) {
    missing.push("YOUTUBE_OAUTH_REDIRECT_URI (or API_URL)");
  }

  if (missing.length === 0) {
    if (process.env.NODE_ENV === "production") {
      console.log(
        `[YouTube] Subscription gate ACTIVE. Lease ${getAccessLeaseMs() / 1000}s, ` +
          `active re-check ${getActiveRecheckSeconds()}s.`,
      );
    }
    return;
  }

  const banner = [
    "",
    "  ==============================================================",
    "  !!  YOUTUBE SUBSCRIPTION VERIFICATION IS NOT CONFIGURED",
    "  ==============================================================",
    `  Missing: ${missing.join(", ")}`,
    "",
    "  Community videos will stay LOCKED for every user, and",
    "  POST /community/videos/:videoId/subscribe-intent returns 503",
    "  YOUTUBE_VERIFICATION_NOT_CONFIGURED. This is the intended failure mode:",
    "  an unconfigured deployment must not unlock anything.",
    "  ==============================================================",
    "",
  ].join("\n");

  if (process.env.NODE_ENV === "production") {
    console.error(banner);
  } else {
    console.warn(banner);
  }
}

// ── Authorization URL ──────────────────────────────────────────────────────────

export interface AuthUrlOptions {
  /** Opaque, single-use handle for this round-trip. Never carries the verdict. */
  state: string;
  /** Bound into the request and re-checked against the id_token `nonce` claim. */
  nonce: string;
  /**
   * Ask for a fresh consent screen.
   *
   * Set when the stored credential is missing the YouTube scope, because
   * `include_granted_scopes` alone will not make Google offer a scope it was
   * never asked for. Not set for an already-linked subscriber, so a plain
   * re-check does not re-prompt.
   */
  forceConsent?: boolean;
}

/**
 * Builds the Google URL the app opens in the system browser.
 *
 * `access_type=offline` is what produces a refresh token, and a refresh token is
 * the only reason a subscription can be re-checked on tomorrow's login instead of
 * tomorrow's consent screen. `include_granted_scopes` keeps the identity
 * incremental, so a user adding the YouTube scope to an existing grant does not
 * lose the access they already granted.
 *
 * `prompt` defaults to `select_account` so a user with several Google accounts
 * can pick the one they subscribe with — the identity is theirs to choose, and
 * choosing wrong is caught later by the same-email check rather than silently
 * producing a link that can never pass it.
 */
export function buildAuthUrl(options: AuthUrlOptions): string {
  if (!isYouTubeOAuthConfigured()) {
    throw new YouTubeNotConfiguredError(
      "YouTube OAuth is not configured — set YOUTUBE_OAUTH_CLIENT_ID and YOUTUBE_OAUTH_CLIENT_SECRET",
    );
  }

  const url = new URL(OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", getYouTubeOAuthClientId());
  url.searchParams.set("redirect_uri", getYouTubeOAuthRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", buildScopeString());
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("nonce", options.nonce);
  url.searchParams.set("state", options.state);
  url.searchParams.set("prompt", options.forceConsent ? "consent" : "select_account");
  return url.toString();
}

// ── Token exchange ─────────────────────────────────────────────────────────────

export interface TokenGrant {
  /** Short-lived (~1h) credential, used for the immediate subscription check. */
  accessToken: string;
  /**
   * Long-lived credential for future checks. Null when Google omitted one, which
   * it does on any exchange after the first authorization for a given
   * client/account pair. An omission means "unchanged", never "revoked" — callers
   * must keep the token they already hold.
   */
  refreshToken: string | null;
  /** What Google actually granted. Stored, and re-read on every check. */
  scope: string | null;
  /** Raw id_token, for identity verification. Only present on a code exchange. */
  idToken: string | null;
  /** Seconds until `accessToken` expires, when Google says. */
  expiresIn: number | null;
}

/** Exchanges an authorization code. Also returns the id_token that carries identity. */
export async function exchangeCodeForToken(code: string): Promise<TokenGrant> {
  return requestToken({
    code,
    grant_type: "authorization_code",
    redirect_uri: getYouTubeOAuthRedirectUri(),
  });
}

/**
 * Mints a new access token from a stored refresh token.
 *
 * Google's response normally omits `refresh_token` here — the grant has not
 * changed — so the token that came in is carried through untouched. Handing back
 * null and letting the caller overwrite its stored credential with it would make
 * every link unverifiable after one refresh.
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenGrant> {
  const grant = await requestToken({ refresh_token: refreshToken, grant_type: "refresh_token" });
  return { ...grant, refreshToken: grant.refreshToken ?? refreshToken };
}

async function requestToken(params: Record<string, string>): Promise<TokenGrant> {
  if (!isYouTubeOAuthConfigured()) {
    throw new YouTubeNotConfiguredError("YouTube OAuth is not configured");
  }

  const body = new URLSearchParams({
    client_id: process.env.YOUTUBE_OAUTH_CLIENT_ID!.trim(),
    client_secret: process.env.YOUTUBE_OAUTH_CLIENT_SECRET!.trim(),
    ...params,
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
      scope?: string;
      id_token?: string;
      expires_in?: number;
    } | null;

    if (!res.ok || !data?.access_token) {
      throw classifyResponseError(res.status || 502, data);
    }

    return {
      accessToken: data.access_token,
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
      // Google's `scope` field is absent on a refresh that granted nothing new.
      // Falling back to null rather than to the previous value is deliberate: the
      // caller only overwrites its stored scopes when it is told something.
      scope: typeof data.scope === "string" ? data.scope : null,
      idToken: typeof data.id_token === "string" ? data.id_token : null,
      expiresIn: typeof data.expires_in === "number" ? data.expires_in : null,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw transient("Google token request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// ── The subscription check ─────────────────────────────────────────────────────

/**
 * Asks Google whether the account behind this token subscribes to `channelId`.
 *
 *     GET /youtube/v3/subscriptions?part=id&mine=true&forChannelId=…&maxResults=1
 *
 * Exactly two outcomes count as evidence, and they are mutually exclusive:
 *
 *   200 with one or more items → subscribed
 *   200 with an EMPTY items array → not subscribed
 *
 * Anything else — an HTTP error, a timeout, an unreadable body — throws. A
 * response we could not parse is not an empty list, and treating it as one is how
 * a Google blip becomes a mass lockout.
 *
 * Costs 1 quota unit per call.
 */
export async function checkChannelSubscription(
  accessToken: string,
  channelId: string,
): Promise<boolean> {
  const url = new URL(`${API_BASE}/subscriptions`);
  url.searchParams.set("part", "id");
  url.searchParams.set("mine", "true");
  url.searchParams.set("forChannelId", channelId);
  url.searchParams.set("maxResults", "1");

  const body = await apiGet(url, accessToken);
  if (!Array.isArray(body?.items)) {
    // A 200 whose body we cannot read. Not evidence of anything — a malformed
    // response is a fault, not an answer.
    throw transient("YouTube subscriptions response had no items array");
  }
  return body.items.length > 0;
}

/**
 * The YouTube channel id of the account that authorized us, when Google will say.
 *
 * Purely diagnostic: the subscription check is answered by the access token's own
 * account, so this is not on the check path and cannot fail one. It is read once
 * during the callback, and stored so an operator reading a row can see which
 * channel the credential belongs to. Swallows every error, because "we could not
 * find out which channel this is" is not a reason to refuse a link.
 */
export async function fetchAuthorizedChannelId(accessToken: string): Promise<string | null> {
  const url = new URL(`${API_BASE}/channels`);
  url.searchParams.set("part", "id");
  url.searchParams.set("mine", "true");

  try {
    const body = await apiGet(url, accessToken);
    const first = Array.isArray(body?.items) ? body.items[0] : undefined;
    const id = (first as { id?: unknown } | undefined)?.id;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

interface GoogleApiBody {
  items?: unknown[];
  error?: { message?: string };
}

/** A single authenticated GET against the YouTube Data API, categorised on failure. */
async function apiGet(url: URL, accessToken: string): Promise<GoogleApiBody> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as GoogleApiBody | null;

    if (!res.ok) {
      throw classifyResponseError(res.status || 502, body);
    }
    // A 200 with no body at all is treated as unreadable rather than empty; the
    // caller decides, and only `items: []` may be read as a confirmed negative.
    return body ?? {};
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw transient("YouTube Data API request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
