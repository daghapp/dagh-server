// ─────────────────────────────────────────
// Channel Access — the one authorization decision
// ─────────────────────────────────────────
// Every surface that can show community content asks this service and nothing
// else. The feed, the single-card read, unlock, the status endpoint the app
// polls, the login response and the background re-check all call
// `checkChannelAccess` or `readChannelAccess`; none of them consults a
// subscription, a cache, or a per-video row for itself.
//
// That is not tidiness, it is the requirement. Before this existed, each endpoint
// re-derived "does this user have access" from whatever it had to hand, so a
// revocation observed by the feed was invisible to the status poll, and the two
// answers could contradict each other in the same session. One decision, one
// record, one version.
//
// ── Why access is a lease and not a flag ─────────────────────────────────────
// A YouTube subscription is mutable from outside our system, and YouTube does not
// tell us when it changes. The documented push feed carries uploads and
// title/description edits; the Subscribe Button's subscribe/unsubscribe events are
// deprecated. So the only way to learn that someone unsubscribed is to ask, and
// the question has to be asked on a schedule.
//
// A boolean grant is the wrong shape for that. It is either permanent — which
// means an unsubscribed user keeps the feed until some other process happens to
// notice — or it is re-derived constantly, which is a quota problem. `status`
// plus `accessExpiresAt` splits the difference: a confirmed positive is honoured
// until its lease lapses, and lapsing is a hard stop that no failure can extend.
//
// ── The failure asymmetry ────────────────────────────────────────────────────
// This is the rule the whole file is built around, and it is not symmetric:
//
//   SUBSCRIBED       the API said yes          → extend the lease, clear revocation
//   NOT_SUBSCRIBED   the API said no           → clear the lease, revoke, publish
//   REAUTH_REQUIRED  the credential is dead    → deny, ask the user to reconnect
//   CHECK_FAILED     we could not find out     → say so, change nothing
//
// The last row is the one that is easy to get wrong. A Google outage, a timeout
// and a quota rejection are all "no information", and treating any of them as
// evidence of an unsubscribe locks out every subscriber at once — while treating
// them as success hands access to someone who cancelled months ago. Neither is
// acceptable, so a failed check is its own status, the existing lease is left to
// expire on its own schedule rather than being extended, and the app is told
// verification is unavailable instead of being told to go subscribe.

import { prisma } from "../config/index.js";
import { ChannelAccessStatus } from "../../generated/prisma/client.js";
import { encryptSecret, decryptSecret, isEncryptedPayload } from "../helpers/encryption.js";
import { getRedisClient } from "../config/redis.js";
import { resolveChannelId } from "./youtube.service.js";
import {
  checkChannelSubscription,
  refreshAccessToken,
  getAccessLeaseMs,
  hasYouTubeReadonlyScope,
  isYouTubeVerificationAvailable,
  YouTubeAuthorizationError,
  YOUTUBE_READONLY_SCOPE,
} from "./youtube-oauth.service.js";
import { logCommunity, logCommunityError } from "../helpers/communityLogger.js";
import { publishAccessChanged } from "../helpers/community-events.js";
import { envNumber } from "../helpers/env-number.js";

// ── Refresh-token storage ─────────────────────────────────────────────────────
// A refresh token is the whole basis of the guarantee: it is what lets a
// subscription be re-checked after the ~1h access token expired, so it carries
// the same weight as the subscription itself. Stored sealed with the same
// AES-256-GCM helper the payment credentials use, under its own AAD context so a
// ciphertext cannot be lifted from one column and replayed into the other.
//
// Reusing PAYMENT_GATEWAY_ENCRYPTION_KEY keeps the key count at one and rules
// out a second secret that is simply absent at boot. The coupling is real and
// documented: rotating that key invalidates stored YouTube tokens, which then
// read as "no credential" and drop into REAUTH_REQUIRED. The user reconnects.
// The alternative — a separate key nobody remembers to provision — fails worse.
//
// `listChannelAccess` reports rows as `tokenEncrypted: false` so the operator
// can see how many links are sitting in the clear.

export const REFRESH_TOKEN_CONTEXT = "youtube:refreshToken";

export class ChannelAccessEncryptionError extends Error {
  constructor(cause?: unknown) {
    super(
      "Refresh tokens must be stored encrypted, but PAYMENT_GATEWAY_ENCRYPTION_KEY " +
        "is missing or unusable. Refusing to store the credential in plaintext.",
    );
    this.name = "ChannelAccessEncryptionError";
    this.cause = cause;
  }
}

/**
 * Seals a refresh token, or throws.
 *
 * There is deliberately no plaintext fallback. An earlier version of this
 * function degraded to storing the token in the clear when the key was absent,
 * on the argument that a readable credential keeps renewals working. That trades
 * a loud, immediate failure for a quiet one: the database dump becomes a
 * credential store, and nothing reports it. Given that this token can be
 * exchanged for the subscription state of every linked account, the correct
 * response to a missing key is to refuse the link and let the operator fix the
 * configuration, not to write the secret down.
 *
 * Callers decide what refusal means: the OAuth callback fails, while an
 * in-flight re-check keeps whatever sealed token it already had.
 */
function sealRefreshToken(token: string): string {
  try {
    return encryptSecret(token, REFRESH_TOKEN_CONTEXT);
  } catch (error) {
    throw new ChannelAccessEncryptionError(error);
  }
}

/**
 * The usable credential, or null when there is none.
 *
 * Three distinct problems collapse to null here, and they all land on the same
 * user-visible outcome (REAUTH_REQUIRED) for different reasons: no token was ever
 * stored, the row predates token persistence, or the encryption key no longer
 * decrypts it. Keeping them apart at this layer would be a distinction without a
 * difference — from the user's side they are all "reconnect Google".
 */
/**
 * A `{ refreshToken }` patch for an already-linked row, or an empty patch when
 * the rotated credential cannot be sealed.
 *
 * Deliberately not "store it anyway". The pre-existing sealed token stays where
 * it is: a `refresh_token` omitted from the update means "unchanged", and an
 * unreadable new one is not worth a plaintext copy. The cost is that the next
 * check may hit `invalid_grant` and ask the user to reconnect, which is the
 * honest outcome of a key that has gone missing.
 */
function sealedRefreshTokenField(token: string): { refreshToken?: string } {
  try {
    return { refreshToken: sealRefreshToken(token) };
  } catch (error) {
    logCommunityError("ChannelAccess.refreshTokenRotate", {
      message:
        "Cannot seal rotated refresh token; keeping the existing sealed credential. " +
        "This link will likely need a reconnect on the next check.",
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

/**
 * The usable credential, or null when there is none.
 *
 * Three distinct problems collapse to null here, and they all land on the same
 * user-visible outcome (REAUTH_REQUIRED) for different reasons: no token was ever
 * stored, the row predates token persistence, or the encryption key no longer
 * decrypts it. Keeping them apart at this layer would be a distinction without a
 * difference — from the user's side they are all "reconnect Google".
 */
function unsealRefreshToken(stored: string | null): string | null {
  if (!stored) return null;
  // Written before tokens were sealed.
  if (!isEncryptedPayload(stored)) return stored;

  try {
    return decryptSecret(stored, REFRESH_TOKEN_CONTEXT);
  } catch {
    // Wrong key, tampered row, or a key rotated since. Treated as "no
    // credential" so the link becomes REAUTH_REQUIRED and the user is asked to
    // reconnect. Revoking outright would close access on a still-valid
    // subscription because of our own key management.
    return null;
  }
}

// ── The access object ─────────────────────────────────────────────────────────
// The single shape every endpoint returns. One object, one source, so no client
// has to reconcile a feed that says unlocked against a status that says locked.

export interface ChannelAccessSnapshot {
  channelId: string;
  status: ChannelAccessStatus;
  /** True only for a status of SUBSCRIBED with an unexpired lease. */
  hasChannelAccess: boolean;
  verifiedAt: string | null;
  accessExpiresAt: string | null;
  accessVersion: number;
  /** The user must complete (or repeat) the Google connection before anything unlocks. */
  requiresGoogleConnection: boolean;
  /** Why access is not open, for the app's copy. Null whenever it is. */
  reason: ChannelAccessReason | null;
}

export const CHANNEL_ACCESS_REASONS = {
  /** No Google account has been linked to this app account yet. */
  GOOGLE_NOT_CONNECTED: "GOOGLE_NOT_CONNECTED",
  /** A link exists but cannot be used — revoked, wrong scopes, or unreadable. */
  REAUTHORIZATION_REQUIRED: "REAUTHORIZATION_REQUIRED",
  /** The check could not be completed. Not evidence of an unsubscribe. */
  VERIFICATION_UNAVAILABLE: "VERIFICATION_UNAVAILABLE",
  /** The check completed and the answer was no. */
  NOT_SUBSCRIBED: "NOT_SUBSCRIBED",
  /** A positive verdict exists but its lease lapsed before it could be re-confirmed. */
  LEASE_EXPIRED: "LEASE_EXPIRED",
  /** The server cannot check subscriptions at all — OAuth is not configured. */
  VERIFICATION_NOT_CONFIGURED: "VERIFICATION_NOT_CONFIGURED",
} as const;

export type ChannelAccessReason =
  (typeof CHANNEL_ACCESS_REASONS)[keyof typeof CHANNEL_ACCESS_REASONS];

// The reason a reader is being asked. Not cosmetic: it decides whether an
// existing lease may be reused, and it lands in the logs so a verdict can be
// traced back to what prompted it.
export const ACCESS_CHECK_REASONS = [
  // A brand-new authenticated session. Never reuses yesterday's verdict — this is
  // the whole answer to "do not carry access across sessions".
  "LOGIN",
  // The app came to the foreground, or the user returned from the OAuth callback.
  "FOREGROUND",
  // A periodic re-check while Community is visible or a clip is playing.
  "ACTIVE_POLL",
  // Before serving full-video fields, when the last check is stale.
  "PLAYBACK",
  // The user explicitly asked to re-check (POST /community/youtube/verify).
  "EXPLICIT",
  // The background re-check job.
  "SCHEDULED",
  // The OAuth callback itself, which has a fresh access token in hand.
  "OAUTH_CALLBACK",
  // An ordinary feed or detail read.
  "READ",
] as const;

export type AccessCheckReason = (typeof ACCESS_CHECK_REASONS)[number];

/**
 * Reasons that must consult YouTube even when a lease is still valid.
 *
 * LOGIN is the important one. Reusing a live lease there would mean a user who
 * unsubscribed at 09:00 and logs in at 09:01 sees an unlocked feed, because the
 * lease from yesterday's login has not lapsed yet. A session boundary is exactly
 * the moment where yesterday's evidence stops being evidence about today.
 *
 * OAUTH_CALLBACK already holds a freshly minted access token, so re-deciding
 * costs no extra round-trip and lets a user who just subscribed skip the wait.
 */
const FORCED_CHECK_REASONS: ReadonlySet<AccessCheckReason> = new Set<AccessCheckReason>([
  "LOGIN",
  "EXPLICIT",
  "OAUTH_CALLBACK",
]);

// ── Single-flight ─────────────────────────────────────────────────────────────
// Concurrent Home + feed + status requests for the same user must collapse into
// one Google call. Left alone they are three token refreshes and three quota
// units for one answer, and the client pays the latency of the slowest — and
// whichever finishes last decides what it renders.
//
// Two layers, because neither alone is enough. The in-process map collapses
// concurrent requests inside one instance, which is the common case and costs
// nothing. The Redis claim extends that across instances; without Redis a
// multi-instance deployment would still collapse per-instance, which is correct
// if not maximally efficient.

const inFlightChecks = new Map<string, Promise<CheckChannelAccessResult>>();

const SINGLE_FLIGHT_CLAIM_PREFIX = "yt:access:lock:";
const SINGLE_FLIGHT_CLAIM_TTL_MS = 30_000;

function singleFlightKey(appUserId: string, channelId: string): string {
  return `${appUserId}:${channelId}`;
}

async function acquireDistributedClaim(key: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return true;
  const acquired = await redis.set(`${SINGLE_FLIGHT_CLAIM_PREFIX}${key}`, "1", {
    NX: true,
    PX: SINGLE_FLIGHT_CLAIM_TTL_MS,
  });
  return acquired === "OK";
}

async function releaseDistributedClaim(key: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  await redis.del(`${SINGLE_FLIGHT_CLAIM_PREFIX}${key}`).catch(() => {});
}

// ── Row shape ─────────────────────────────────────────────────────────────────

/** The columns any decision needs, and nothing that could leak a credential. */
const ACCESS_SELECT = {
  id: true,
  userId: true,
  channelId: true,
  status: true,
  accessVersion: true,
  verifiedAt: true,
  accessExpiresAt: true,
  revokedAt: true,
  revokedReason: true,
  grantedScopes: true,
  refreshToken: true,
  unlockedAt: true,
} as const;

type AccessRow = {
  id: string;
  userId: string;
  channelId: string;
  status: ChannelAccessStatus;
  accessVersion: number;
  verifiedAt: Date | null;
  accessExpiresAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  grantedScopes: string | null;
  refreshToken: string | null;
  unlockedAt: Date;
};

// ── Reading a decision without spending quota ─────────────────────────────────

/** The default verdict for a user with no record at all. */
export function noRecordSnapshot(channelId: string): ChannelAccessSnapshot {
  return {
    channelId,
    status: "NOT_CONNECTED",
    hasChannelAccess: false,
    verifiedAt: null,
    accessExpiresAt: null,
    accessVersion: 0,
    requiresGoogleConnection: true,
    reason: CHANNEL_ACCESS_REASONS.GOOGLE_NOT_CONNECTED,
  };
}

/**
 * The verdict for a server that cannot check subscriptions at all.
 *
 * Distinct from `noRecordSnapshot` because the app's next action differs: with no
 * record it should offer "connect Google", whereas here there is nothing for the
 * user to do — the channel or the OAuth client is missing on this deployment, and
 * prompting for a connection would send them through a round-trip that cannot
 * succeed. Locked, and not the user's fault.
 */
export function verificationNotConfiguredSnapshot(): ChannelAccessSnapshot {
  return {
    channelId: "",
    status: "NOT_CONNECTED",
    hasChannelAccess: false,
    verifiedAt: null,
    accessExpiresAt: null,
    accessVersion: 0,
    requiresGoogleConnection: false,
    reason: CHANNEL_ACCESS_REASONS.VERIFICATION_NOT_CONFIGURED,
  };
}

/**
 * The verdict for a check that could not be performed.
 *
 * Used where no decision could be reached at all — an error escaping the service,
 * or a server with no channel configured. Locked, explicitly not an unsubscribe,
 * and it asks for a retry rather than a re-subscribe.
 */
export function verificationUnavailableSnapshot(): ChannelAccessSnapshot {
  return {
    channelId: "",
    status: "CHECK_FAILED",
    hasChannelAccess: false,
    verifiedAt: null,
    accessExpiresAt: null,
    accessVersion: 0,
    requiresGoogleConnection: false,
    reason: CHANNEL_ACCESS_REASONS.VERIFICATION_UNAVAILABLE,
  };
}

/**
 * Turns a stored row into the answer, applying the two rules that a raw column
 * read would miss:
 *
 *   1. A positive verdict is only access while its lease is live. `status` alone
 *      saying SUBSCRIBED is not enough — the lease is what bounds an unsubscribe
 *      that nobody checked for.
 *   2. A row whose credential is gone cannot be re-checked, so it is not trusted
 *      even if its status still says SUBSCRIBED. An unverifiable subscription is
 *      not a subscription we can honour.
 */
export function snapshotFromRow(
  row: AccessRow | null,
  channelId: string,
  now: Date = new Date(),
): ChannelAccessSnapshot {
  if (!row) return noRecordSnapshot(channelId);

  const base = {
    channelId: row.channelId || channelId,
    accessVersion: row.accessVersion,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    accessExpiresAt: row.accessExpiresAt ? row.accessExpiresAt.toISOString() : null,
  };

  const leaseLive = row.accessExpiresAt !== null && row.accessExpiresAt.getTime() > now.getTime();

  if (row.status === "SUBSCRIBED") {
    if (leaseLive) {
      return {
        ...base,
        status: "SUBSCRIBED",
        hasChannelAccess: true,
        requiresGoogleConnection: false,
        reason: null,
      };
    }
    // Lapsed. Not an unsubscribe — nobody has asked since — so the app is told
    // the verdict is stale, not that the user cancelled.
    return {
      ...base,
      status: "SUBSCRIBED",
      hasChannelAccess: false,
      requiresGoogleConnection: false,
      reason: CHANNEL_ACCESS_REASONS.LEASE_EXPIRED,
    };
  }

  if (row.status === "NOT_SUBSCRIBED") {
    return {
      ...base,
      status: "NOT_SUBSCRIBED",
      hasChannelAccess: false,
      requiresGoogleConnection: false,
      reason: CHANNEL_ACCESS_REASONS.NOT_SUBSCRIBED,
    };
  }

  if (row.status === "REAUTH_REQUIRED") {
    return {
      ...base,
      status: "REAUTH_REQUIRED",
      hasChannelAccess: false,
      requiresGoogleConnection: true,
      reason: CHANNEL_ACCESS_REASONS.REAUTHORIZATION_REQUIRED,
    };
  }

  if (row.status === "CHECK_FAILED") {
    return {
      ...base,
      status: "CHECK_FAILED",
      hasChannelAccess: false,
      requiresGoogleConnection: false,
      reason: CHANNEL_ACCESS_REASONS.VERIFICATION_UNAVAILABLE,
    };
  }

  return {
    ...base,
    status: "NOT_CONNECTED",
    hasChannelAccess: false,
    requiresGoogleConnection: true,
    reason: CHANNEL_ACCESS_REASONS.GOOGLE_NOT_CONNECTED,
  };
}

// ── Verdict classification ────────────────────────────────────────────────────

type Verdict =
  | { kind: "subscribed" }
  | { kind: "notSubscribed" }
  | { kind: "reauthRequired"; detail: string }
  | { kind: "checkFailed"; detail: string };

/**
 * Maps an outcome onto a verdict, and is where the asymmetry above is enforced.
 *
 * Only two things count as evidence about the subscription: a successful
 * response, and the items array in it. Everything else is either a problem with
 * the credential (REAUTH_REQUIRED — the link is finished and the user must
 * reconnect) or a problem with the check (CHECK_FAILED — nothing is learned, so
 * nothing changes).
 */
export function classifyCheckOutcome(input: {
  subscribed: boolean;
  hasCredential: boolean;
  grantedScopes: string | null;
  error?: unknown;
}): Verdict {
  if (input.hasCredential && !hasYouTubeReadonlyScope(input.grantedScopes)) {
    return {
      kind: "reauthRequired",
      detail: `stored credential is missing the ${YOUTUBE_READONLY_SCOPE} scope`,
    };
  }
  if (input.error instanceof YouTubeAuthorizationError) {
    return { kind: "reauthRequired", detail: input.error.message };
  }
  if (input.error) {
    return {
      kind: "checkFailed",
      detail: input.error instanceof Error ? input.error.message : String(input.error),
    };
  }
  return input.subscribed ? { kind: "subscribed" } : { kind: "notSubscribed" };
}

// ── Committing a verdict ──────────────────────────────────────────────────────

/**
 * Writes a verdict with a new version, atomically, and refuses to let a slow
 * check overwrite a fresher one.
 *
 * The guard is a compare-and-swap on `accessVersion` plus a "not verified after
 * this check started" bound. Both exist for the same underlying race: an OAuth
 * callback and a background poll can be asking about the same user at the same
 * moment, and the slower one must not win. Whichever answer reached the database
 * first is the one with fresher evidence, and the loser is dropped rather than
 * applied.
 *
 * Returns null when the write lost that race, so the caller can report the
 * already-committed answer instead of its own stale one.
 */
async function commitVerdict(input: {
  row: AccessRow | null;
  userId: string;
  channelId: string;
  verdict: Verdict;
  startedAt: Date;
  now: Date;
  /** Applied on a positive verdict only; never overwrites with a null. */
  credentials?: { refreshToken?: string | null; grantedScopes?: string | null };
  /** Recorded on the first link, and when a reconnect replaces the identity. */
  identity?: {
    googleSubject?: string | null;
    googleEmail?: string | null;
    authorizedYoutubeChannelId?: string | null;
  } | null;
}): Promise<AccessSnapshotCommit | null> {
  const { row, userId, channelId, verdict, startedAt, now } = input;

  const leaseExpiresAt = new Date(now.getTime() + getAccessLeaseMs());

  const data =
    verdict.kind === "subscribed"
      ? {
          status: ChannelAccessStatus.SUBSCRIBED,
          verifiedAt: now,
          accessExpiresAt: leaseExpiresAt,
          revokedAt: null,
          revokedReason: null,
          // Google rotates refresh tokens on some exchanges; keep the newest so
          // the next check does not use a spent credential. Never overwritten
          // with null — losing the token would silently make the link
          // unverifiable, and an omitted refresh_token in a response means
          // "unchanged", not "revoked".
          ...(input.credentials?.refreshToken
            ? sealedRefreshTokenField(input.credentials.refreshToken)
            : {}),
          ...(input.credentials?.grantedScopes
            ? { grantedScopes: input.credentials.grantedScopes }
            : {}),
        }
      : verdict.kind === "notSubscribed"
        ? {
            status: ChannelAccessStatus.NOT_SUBSCRIBED,
            verifiedAt: now,
            // The lease is cleared rather than left to expire: a confirmed
            // negative is not a positive that ran out, and the next read must
            // not be able to treat this as anything but a refusal.
            accessExpiresAt: null,
            revokedAt: now,
            revokedReason: "UNSUBSCRIBED",
          }
        : verdict.kind === "reauthRequired"
          ? {
              status: ChannelAccessStatus.REAUTH_REQUIRED,
              // verifiedAt is left alone: the last successful check is still the
              // last successful check, and overwriting it would erase the
              // evidence that access was once justified.
              accessExpiresAt: null,
              revokedAt: null,
              revokedReason: null,
            }
          : {
              // CHECK_FAILED. The lease is deliberately NOT touched. A failed
              // check must not extend access (that would make an outage
              // permanent) but must not truncate it either (that would make a
              // two-second blip a revocation). Leaving it to expire on its own
              // schedule is the only behaviour that is wrong in neither
              // direction.
              status: ChannelAccessStatus.CHECK_FAILED,
            };

  const shared = {
    ...data,
    ...(input.identity
      ? {
          googleSubject: input.identity.googleSubject ?? undefined,
          googleEmail: input.identity.googleEmail ?? undefined,
          authorizedYoutubeChannelId: input.identity.authorizedYoutubeChannelId ?? undefined,
        }
      : {}),
  };

  if (!row) {
    const created = await prisma.channelAccess.create({
      data: {
        userId,
        channelId,
        unlockedAt: now,
        accessVersion: 1,
        ...shared,
        // A row created to record a failure has no credential by definition, and
        // says so rather than implying a link that does not exist.
        ...(verdict.kind === "checkFailed" ? { status: ChannelAccessStatus.NOT_CONNECTED } : {}),
      },
      select: ACCESS_SELECT,
    });
    return { row: created as AccessRow, changed: true, verdict, now };
  }

  // Compare-and-swap. `accessVersion` is what we read, so a concurrent commit
  // that already bumped it makes this update match nothing.
  const updated = await prisma.channelAccess.updateMany({
    where: {
      id: row.id,
      accessVersion: row.accessVersion,
      // Belt and braces for the case two commits land in the same millisecond:
      // nobody may be credited with evidence older than the check we just ran.
      ...(row.verifiedAt ? { verifiedAt: { lte: startedAt } } : {}),
    },
    data: { ...shared, accessVersion: { increment: 1 } },
  });

  if (updated.count === 0) return null;

  const fresh = await prisma.channelAccess.findUnique({
    where: { id: row.id },
    select: ACCESS_SELECT,
  });
  if (!fresh) return null;

  return { row: fresh as AccessRow, changed: true, verdict, now };
}

interface AccessSnapshotCommit {
  row: AccessRow;
  changed: boolean;
  verdict: Verdict;
  /** The instant this verdict was decided, used for every lease comparison. */
  now: Date;
}

// ── Revoking the implied per-video grants ─────────────────────────────────────

/**
 * Removes the per-video unlock rows a subscription implied.
 *
 * Those rows are the same reward restated per card. They exist for analytics —
 * which card got opened, what the conversion funnel looks like — and they must
 * never be able to reopen a channel. Deleting them is what enforces that: there
 * is no per-video state left for a stale card read to find. The append-only
 * VideoInteraction rows are untouched, so the funnel survives the revocation.
 */
async function revokeImpliedVideoUnlocks(userId: string): Promise<void> {
  await prisma.videoUnlock.deleteMany({ where: { userId } });
}

// ── The service ───────────────────────────────────────────────────────────────

export interface CheckChannelAccessOptions {
  reason: AccessCheckReason;
  /** Overrides the resolved target channel. Only the admin console passes this. */
  channelId?: string;
  now?: Date;
  /**
   * Bypasses the lease short-circuit and the single-flight cache. Used by the
   * OAuth callback, which is the authority for its own round-trip: it holds a
   * token minted seconds ago, so deferring to an older verdict would discard
   * better evidence.
   */
  force?: boolean;
}

export interface CheckChannelAccessResult {
  access: ChannelAccessSnapshot;
  /** True when a Google call was actually made. */
  checked: boolean;
  /** False when the commit lost a race to a fresher verdict. */
  committed: boolean;
  verdict: Verdict["kind"] | "REUSED" | "NOT_LINKED" | "NOT_CONFIGURED";
  /** Wall-clock cost of the Google round-trip, for the latency metric. */
  latencyMs: number | null;
}

function leaseIsUsable(row: AccessRow | null, now: Date): boolean {
  return (
    row !== null &&
    row.status === ChannelAccessStatus.SUBSCRIBED &&
    row.revokedAt === null &&
    row.accessExpiresAt !== null &&
    row.accessExpiresAt.getTime() > now.getTime()
  );
}

function shouldReuseLease(row: AccessRow | null, reason: AccessCheckReason, now: Date): boolean {
  if (!leaseIsUsable(row, now)) return false;
  return !FORCED_CHECK_REASONS.has(reason);
}

/**
 * Resolves, and where necessary refreshes, the caller's access to one channel.
 *
 * This is the only function in the codebase permitted to answer "can this user
 * watch this". The order below is the contract, and each step exists because the
 * one after it would be wrong without it:
 *
 *   resolve channel   Server-side config, never a request body. A client-supplied
 *                     channelId would let a caller check (and be refused for)
 *                     some other channel, or unlock a channel we never
 *                     configured.
 *   no record         NOT_CONNECTED. Not an error: most users are here, and the
 *                     answer is "connect Google", not "denied".
 *   live lease        Reused, unless the reason forbids it. This is the branch
 *                     that keeps the feed free — without it every read costs a
 *                     quota unit.
 *   single-flight     One Google call per user/channel however many surfaces ask
 *                     at once.
 *   refresh, check    One token refresh plus one 1-unit call.
 *   commit            Atomic, versioned, and refusing to overwrite a fresher
 *                     verdict.
 *   publish           Only when the effective access actually changed.
 */
export async function checkChannelAccess(
  appUserId: string,
  targetChannelId: string,
  options: CheckChannelAccessOptions,
): Promise<CheckChannelAccessResult> {
  const now = options.now ?? new Date();
  const key = singleFlightKey(appUserId, targetChannelId);

  // Collapses concurrent requests inside this process. Placed before the lease
  // check on purpose: two requests arriving together should share one answer,
  // not one of them trigger a check the other would have skipped.
  const existing = inFlightChecks.get(key);
  if (existing && !options.force) {
    return existing;
  }

  const run = (async (): Promise<CheckChannelAccessResult> => {
    const startedAt = new Date();
    const startedAtMs = Date.now();

    const row = await prisma.channelAccess.findUnique({
      where: { userId_channelId: { userId: appUserId, channelId: targetChannelId } },
      select: ACCESS_SELECT,
    });

    if (shouldReuseLease(row, options.reason, now)) {
      return {
        access: snapshotFromRow(row, targetChannelId, now),
        checked: false,
        committed: false,
        verdict: "REUSED" as const,
        latencyMs: null,
      };
    }

    if (!row) {
      // Nothing to check and nothing that could be checked. Reporting CHECK_FAILED
      // here would be wrong in a way that matters: it would tell the app
      // "verification is unavailable, try again" when the accurate statement is
      // "you have not connected a Google account yet".
      return {
        access: noRecordSnapshot(targetChannelId),
        checked: false,
        committed: false,
        verdict: "NOT_LINKED" as const,
        latencyMs: null,
      };
    }

    // A link with no usable credential cannot be re-checked. Report
    // REAUTH_REQUIRED even if the stored status still says SUBSCRIBED: a grant
    // nobody can re-verify is a grant nobody can revoke.
    const refreshToken = unsealRefreshToken(row.refreshToken);
    if (!refreshToken) {
      const committed = await commitVerdict({
        row,
        userId: appUserId,
        channelId: targetChannelId,
        verdict: { kind: "reauthRequired", detail: "no usable stored credential" },
        startedAt,
        now,
      });
      if (committed) await afterCommit(appUserId, row, committed, options.reason, 0);
      return {
        access: committed
          ? snapshotFromRow(committed.row, targetChannelId, now)
          : snapshotFromRow(row, targetChannelId, now),
        checked: false,
        committed: Boolean(committed),
        verdict: "reauthRequired",
        latencyMs: 0,
      };
    }

    if (!isYouTubeVerificationAvailable()) {
      // The server cannot reach Google at all. CHECK_FAILED, and — importantly —
      // the existing lease is left to lapse rather than being renewed. Deploying
      // with OAuth unconfigured must not quietly hand out standing access.
      const committed = await commitVerdict({
        row,
        userId: appUserId,
        channelId: targetChannelId,
        verdict: { kind: "checkFailed", detail: "YouTube verification is not configured" },
        startedAt,
        now,
      });
      if (committed) await afterCommit(appUserId, row, committed, options.reason, 0);
      return {
        access: committed
          ? snapshotFromRow(committed.row, targetChannelId, now)
          : snapshotFromRow(row, targetChannelId, now),
        checked: false,
        committed: Boolean(committed),
        // checkFailed, matching what was just committed. Labelling this
        // reauthRequired would send an operator to the user's Google connection
        // when the missing thing is on this server, and would file it under
        // "unverifiable" in the sweep — a category a redeploy clears and a
        // reconnect does not.
        verdict: "checkFailed",
        latencyMs: 0,
      };
    }

    // Distributed single-flight. Losing the claim is not an error: it means
    // another instance is already asking Google the same question and its answer
    // is authoritative. Re-read the row after a short wait so this request still
    // returns something current rather than the pre-check state.
    const claimed = await acquireDistributedClaim(key);
    if (!claimed) {
      const reloaded = await prisma.channelAccess.findUnique({
        where: { userId_channelId: { userId: appUserId, channelId: targetChannelId } },
        select: ACCESS_SELECT,
      });
      if (reloaded && reloaded.accessVersion !== row.accessVersion) {
        return {
          access: snapshotFromRow(reloaded, targetChannelId, now),
          checked: false,
          committed: false,
          verdict: "REUSED" as const,
          latencyMs: null,
        };
      }
      // The other instance has not committed yet. Answering from the pre-check
      // row would be a stale claim dressed as a current one, so this waits
      // briefly and re-reads rather than guessing.
      await sleep(SINGLE_FLIGHT_WAIT_MS);
      const after = await prisma.channelAccess.findUnique({
        where: { userId_channelId: { userId: appUserId, channelId: targetChannelId } },
        select: ACCESS_SELECT,
      });
      return {
        access: snapshotFromRow(after, targetChannelId, now),
        checked: false,
        committed: false,
        verdict: "REUSED" as const,
        latencyMs: null,
      };
    }

    // Gated before the round trip, not after it. A credential that cannot answer
    // subscriptions.list has already been reclassified as REAUTH_REQUIRED by
    // `classifyCheckOutcome`; doing that only once the answer came back meant every
    // such check still cost a token refresh and a quota unit to reach a verdict we
    // already knew. Same outcome, none of the spend.
    if (!hasYouTubeReadonlyScope(row.grantedScopes)) {
      const committed = await commitVerdict({
        row,
        userId: appUserId,
        channelId: targetChannelId,
        verdict: {
          kind: "reauthRequired",
          detail: `stored credential is missing the ${YOUTUBE_READONLY_SCOPE} scope`,
        },
        startedAt,
        now,
      });
      if (committed) await afterCommit(appUserId, row, committed, options.reason, 0);
      return {
        access: committed
          ? snapshotFromRow(committed.row, targetChannelId, now)
          : snapshotFromRow(row, targetChannelId, now),
        checked: false,
        committed: Boolean(committed),
        verdict: "reauthRequired",
        latencyMs: 0,
      };
    }

    try {
      let subscribed = false;
      let verdict: Verdict;
      let rotatedRefreshToken: string | null = null;

      try {
        const token = await refreshAccessToken(refreshToken);
        rotatedRefreshToken = token.refreshToken;
        subscribed = await checkChannelSubscription(token.accessToken, targetChannelId);
        verdict = classifyCheckOutcome({
          subscribed,
          hasCredential: true,
          grantedScopes: row.grantedScopes,
        });
      } catch (caught) {
        // The classification is the record: `caught` is folded into it, so a
        // failure is a verdict like any other rather than a second path that
        // has to be kept in step with the first.
        verdict = classifyCheckOutcome({
          subscribed: false,
          hasCredential: true,
          grantedScopes: row.grantedScopes,
          error: caught,
        });
      }

      const committed = await commitVerdict({
        row,
        userId: appUserId,
        channelId: targetChannelId,
        verdict,
        startedAt,
        now,
        credentials:
          verdict.kind === "subscribed"
            ? { refreshToken: rotatedRefreshToken, grantedScopes: row.grantedScopes }
            : undefined,
      });

      const latencyMs = Date.now() - startedAtMs;

      if (committed) {
        await afterCommit(appUserId, row, committed, options.reason, latencyMs);
        return {
          access: snapshotFromRow(committed.row, targetChannelId, now),
          checked: true,
          committed: true,
          verdict: verdict.kind,
          latencyMs,
        };
      }

      // Superseded by a fresher verdict that landed first. Report that one.
      const fresh = await prisma.channelAccess.findUnique({
        where: { userId_channelId: { userId: appUserId, channelId: targetChannelId } },
        select: ACCESS_SELECT,
      });
      return {
        access: snapshotFromRow(fresh, targetChannelId, now),
        checked: true,
        committed: false,
        verdict: verdict.kind,
        latencyMs,
      };
    } finally {
      await releaseDistributedClaim(key);
    }
  })();

  inFlightChecks.set(key, run);
  try {
    return await run;
  } finally {
    inFlightChecks.delete(key);
  }
}

const SINGLE_FLIGHT_WAIT_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Side effects that must happen only after a verdict is durably committed.
 *
 * Order is deliberate. The per-video rows are cleared before the event is
 * published, so a client that reacts instantly to the event and immediately
 * re-reads cannot observe a window where the channel says NOT_SUBSCRIBED while
 * the old per-video unlocks are still readable.
 */
async function afterCommit(
  userId: string,
  previous: AccessRow,
  commit: AccessSnapshotCommit,
  reason: AccessCheckReason,
  latencyMs: number,
): Promise<void> {
  const next = commit.row;

  if (commit.verdict.kind === "notSubscribed") {
    await revokeImpliedVideoUnlocks(userId).catch((error) => {
      // The revocation itself is committed; failing to clear the analytics rows
      // must not un-commit it. Logged loudly because it is a real leak: a stale
      // per-video unlock would let one card still play.
      logCommunityError("community.access.revoke_unlocks_failed", {
        userId,
        channelId: next.channelId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  // Both sides are judged against the commit's own clock. Comparing the old row
  // against the epoch would report a lapsed lease as "was open" and make every
  // re-check of a stale row look like a change worth an event.
  const { now } = commit;
  const wasOpen = previous.status === "SUBSCRIBED" && leaseIsUsable(previous, now);
  const isOpen =
    next.status === ChannelAccessStatus.SUBSCRIBED &&
    next.revokedAt === null &&
    next.accessExpiresAt !== null &&
    next.accessExpiresAt.getTime() > now.getTime();

  if (wasOpen === isOpen && previous.status === next.status) {
    // Nothing a client can observe changed. Publishing anyway would reset the
    // client's "what have I applied" bookkeeping for no reason, and a client
    // that treats every event as a re-render would thrash.
    logCommunity("community.access.unchanged", {
      userId,
      channelId: next.channelId,
      reason,
      status: next.status,
      accessVersion: next.accessVersion,
      latencyMs,
    });
    return;
  }

  // The snapshot the decision was made from, judged against the commit's clock
  // so it says exactly what the caller will be told — see publishAccessChanged
  // for why the two must not be built independently.
  await publishAccessChanged(userId, snapshotFromRow(next, next.channelId, now));

  logCommunity("community.access.changed", {
    userId,
    channelId: next.channelId,
    reason,
    from: previous.status,
    to: next.status,
    hasChannelAccess: isOpen,
    accessVersion: next.accessVersion,
    latencyMs,
  });
}

// ── Read path ─────────────────────────────────────────────────────────────────

export interface ReadChannelAccessResult {
  access: ChannelAccessSnapshot;
  /** True when a Google call was made for this read. */
  checked: boolean;
}

/**
 * The decision for a read, reusing a live lease and re-checking a lapsed one.
 *
 * The distinction from `checkChannelAccess` is who decides freshness. A read
 * re-checks because the lease has lapsed — a passive consequence of time, not a
 * request for certainty. LOGIN and EXPLICIT are passed through unchanged so the
 * forced-check rule still applies, but the feed does not need to know that: it
 * asks the same question and gets the same guarantee.
 */
export async function readChannelAccess(
  userId: string,
  options: { reason?: AccessCheckReason; channelId?: string; now?: Date } = {},
): Promise<ReadChannelAccessResult> {
  const channelId = await resolveTargetChannelId(options.channelId);
  if (!channelId) return { access: noRecordSnapshot(""), checked: false };

  const result = await checkChannelAccess(userId, channelId, {
    reason: options.reason ?? "READ",
    channelId,
    now: options.now,
  });
  return { access: result.access, checked: result.checked };
}

/**
 * The configured channel, resolved on the server.
 *
 * A null result means nothing is configured at all, which is different from
 * "this user is not subscribed" and is surfaced as such: the app can say the
 * feature is not set up, which is actionable, whereas NOT_SUBSCRIBED would send
 * a real subscriber off to re-subscribe for nothing.
 */
export async function resolveTargetChannelId(explicit?: string): Promise<string | null> {
  try {
    return await resolveChannelId(explicit);
  } catch {
    return null;
  }
}

// ── Linking a verified Google identity ────────────────────────────────────────

export interface LinkIdentityInput {
  userId: string;
  channelId: string;
  googleSubject: string;
  googleEmail: string;
  authorizedYoutubeChannelId: string | null;
  /** Space-separated scopes Google actually granted, or null when unknown. */
  grantedScopes: string | null;
  refreshToken: string | null;
  now?: Date;
}

/**
 * Records the Google identity and credential behind a completed round-trip.
 *
 * The verdict itself is NOT written here — it is decided by `checkChannelAccess`
 * from the same credential, so the callback and the background poll cannot
 * disagree about what the evidence means. This only establishes that a usable
 * link exists; the access status stays whatever it was until a check runs.
 *
 * `unlockedAt` is preserved on an existing row: it is the original conversion
 * timestamp, and rewriting it on every reconnect would quietly restate when the
 * user first subscribed.
 */
export async function linkGoogleIdentity(input: LinkIdentityInput): Promise<void> {
  const now = input.now ?? new Date();
  const data = {
    googleSubject: input.googleSubject,
    googleEmail: input.googleEmail,
    authorizedYoutubeChannelId: input.authorizedYoutubeChannelId,
    grantedScopes: input.grantedScopes,
    // Throws if the key is unusable, which aborts the callback and leaves the
    // row untouched: a half-linked account with a plaintext token is worse than
    // one that is simply not linked yet.
    ...(input.refreshToken ? { refreshToken: sealRefreshToken(input.refreshToken) } : {}),
    // A link that cannot answer the subscription question is not a working link,
    // whatever the previous status said. Recording it as REAUTH_REQUIRED is what
    // makes the app offer "reconnect" instead of "subscribe again".
    status: hasYouTubeReadonlyScope(input.grantedScopes)
      ? ChannelAccessStatus.NOT_SUBSCRIBED
      : ChannelAccessStatus.REAUTH_REQUIRED,
    // Force the next read to re-decide. The previous lease describes a check
    // against a credential that has now been replaced.
    accessExpiresAt: null,
    revokedAt: null,
    revokedReason: null,
  };

  await prisma.channelAccess.upsert({
    where: { userId_channelId: { userId: input.userId, channelId: input.channelId } },
    create: {
      userId: input.userId,
      channelId: input.channelId,
      unlockedAt: now,
      accessVersion: 1,
      ...data,
    },
    update: { ...data, accessVersion: { increment: 1 } },
  });
}

// ── Manual revocation (operator) ──────────────────────────────────────────────

/**
 * Closes access on an admin's say-so, without consulting YouTube.
 *
 * The escape hatch for what polling cannot resolve: a support request, a refund,
 * a link that is stuck in a state no check will ever clear. Recorded as MANUAL so
 * it is distinguishable from a confirmed unsubscribe, and recoverable — a later
 * re-authorisation revives the same row.
 */
export async function revokeAccessManually(
  userId: string,
  channelId?: string,
): Promise<{ revoked: boolean; access: ChannelAccessSnapshot | null }> {
  const now = new Date();

  // The status change and the per-video cleanup are one transaction, not two
  // writes in sequence. Between them there was a window where the channel record
  // said revoked but the implied unlock rows were still there — invisible to the
  // app, because reads go through the channel verdict, but visible to anything
  // that reports on unlock rows, which is exactly the kind of thing that turns
  // into a "you said it was revoked but the analytics still show it" ticket.
  const batch = await prisma.$transaction([
    prisma.channelAccess.updateMany({
      where: {
        userId,
        status: ChannelAccessStatus.SUBSCRIBED,
        ...(channelId ? { channelId } : {}),
      },
      data: {
        status: ChannelAccessStatus.NOT_SUBSCRIBED,
        accessExpiresAt: null,
        revokedAt: now,
        revokedReason: "MANUAL",
        accessVersion: { increment: 1 },
      },
    }),
    prisma.videoUnlock.deleteMany({ where: { userId } }),
    prisma.channelAccess.findMany({
      where: { userId, ...(channelId ? { channelId } : {}) },
      select: ACCESS_SELECT,
    }),
  ]);

  const updated = batch[0] as { count: number };
  const rows = batch[2] as AccessRow[];
  if (rows.length === 0) return { revoked: false, access: null };

  const target = rows[0]!;
  if (updated.count === 0) {
    // The update matches on status = SUBSCRIBED, so nothing here was open. The
    // row exists but was already closed: reporting a revocation for it would
    // announce a change that did not happen, which is worse than silence because
    // it resets every client's version bookkeeping.
    return { revoked: false, access: snapshotFromRow(target, target.channelId, now) };
  }

  for (const row of rows) {
    await publishAccessChanged(userId, snapshotFromRow(row, row.channelId, now));
  }

  return { revoked: true, access: snapshotFromRow(target, target.channelId, now) };
}

// ── Re-sealing legacy plaintext tokens ────────────────────────────────────────

/**
 * Backfills encryption for tokens stored before sealing existed.
 *
 * New links have been sealed since the encryption landed, and every successful
 * re-check re-seals the row it touches. This covers the rest — links Google
 * never rotated, and rows the sweep cannot reach — and is safe to run repeatedly.
 */
export async function reencryptLegacyRefreshTokens(): Promise<{
  scanned: number;
  sealed: number;
  unsealable: number;
}> {
  const rows = await prisma.channelAccess.findMany({
    where: { refreshToken: { not: null } },
    select: { id: true, refreshToken: true },
  });

  let sealed = 0;
  let unsealable = 0;

  for (const row of rows) {
    const stored = row.refreshToken;
    if (!stored) continue;

    if (isEncryptedPayload(stored)) {
      // Already in the sealed format, so there is nothing to rewrite. But "sealed"
      // is a claim about the payload's shape, not about whether we can still open
      // it, and a token sealed under a rotated-away key is both. Counting it here
      // is the only way an operator running this backfill learns these links are
      // dead rather than seeing a clean run.
      //
      // unsealRefreshToken reports an unreadable token as null rather than
      // throwing, which is right for the check path — there, "no credential" and
      // "wrong key" produce the same user outcome — so the null is the signal here.
      if (unsealRefreshToken(stored) === null) {
        unsealable += 1;
        logCommunityError("ChannelAccess.reencryptLegacy", {
          message:
            `Link ${row.id} holds a sealed token this deployment cannot decrypt — the ` +
            "encryption key has probably been rotated. Access is intact but the link can " +
            "no longer be re-verified or revoked. The user must reconnect.",
        });
      }
      continue;
    }

    let sealedToken: string;
    try {
      sealedToken = sealRefreshToken(stored);
    } catch (error) {
      // No key, so nothing was written. The row stays in the clear and the count
      // below does not claim otherwise.
      unsealable += 1;
      logCommunityError("ChannelAccess.reencryptLegacy", {
        message:
          `Left link ${row.id} in plaintext — no encryption key available. ` +
          "Re-run this once PAYMENT_GATEWAY_ENCRYPTION_KEY is set.",
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    await prisma.channelAccess.update({
      where: { id: row.id },
      data: { refreshToken: sealedToken },
    });
    sealed += 1;
  }

  return { scanned: rows.length, sealed, unsealable };
}

// ── Rows due for a background re-check ────────────────────────────────────────

/**
 * Access records whose lease has lapsed, oldest first.
 *
 * This is the query behind the active-user poll. It selects on the lease rather
 * than on `lastActiveAt` because the lease is the property that actually needs
 * re-deciding: a user who has not opened the app still has an access record, and
 * if that record's lease is live it is fine; if it is not, the next thing they do
 * — or the next background pass — has to fix it.
 */
export async function findLapsedAccess(
  limit: number,
): Promise<Array<{ userId: string; channelId: string }>> {
  const now = new Date();
  return prisma.channelAccess.findMany({
    where: {
      revokedAt: null,
      status: { in: [ChannelAccessStatus.SUBSCRIBED, ChannelAccessStatus.CHECK_FAILED] },
      OR: [{ accessExpiresAt: null }, { accessExpiresAt: { lte: now } }],
    },
    select: { userId: true, channelId: true },
    orderBy: { accessExpiresAt: { sort: "asc", nulls: "first" } },
    take: limit,
  });
}

/** How many rows one background pass will consider. */
export function getActiveRecheckBatchSize(): number {
  return envNumber("COMMUNITY_ACTIVE_RECHECK_BATCH", 200, 1, 2000);
}

// ── The background sweep ──────────────────────────────────────────────────────

export interface ReverifySummary {
  checked: number;
  stillSubscribed: number;
  revoked: number;
  /** Could not be decided. Their lease is left to lapse — see the note below. */
  failed: number;
  /** No usable credential, so the link can never be re-checked. */
  unverifiable: number;
  /** Stopped early on the wall-clock budget; rows remain due. */
  budgetExhausted: boolean;
}

/**
 * Re-decides every access record whose lease has run out.
 *
 * The lease is what makes this safe to run at all. YouTube offers no unsubscribe
 * webhook, so revocation latency is bounded by how long a positive answer is
 * trusted — not by how often this job happens to run. That changes the failure
 * mode of this sweep, and it is worth being explicit about:
 *
 * The old sweep "failed open" — a check it could not perform left the grant
 * intact and tried again next pass, so a YouTube outage never locked anyone out.
 * Without a lease that was the only defensible choice, but it also meant an
 * outage silently converted into indefinite access. Here a check that cannot be
 * performed does not extend anything: the row keeps the accessExpiresAt it
 * already had, which is in the past, so the next read re-checks and any client
 * polling sees CHECK_FAILED. A subscriber is not locked out by our outage — they
 * lose the *lease*, and the next successful pass hands it straight back.
 *
 * Budget-bounded rather than count-bounded because a fixed count cannot promise
 * to finish inside the lock TTL, and because quota per check is what actually
 * limits throughput.
 */
/**
 * Wall-clock budget for one sweep pass.
 *
 * Exported so the scheduler can size its distributed lock to the same number the
 * sweep will actually honour. A lock TTL derived from a second, separate read of
 * the variable is a lock TTL that can drift — and a lock that expires mid-pass is
 * precisely the double-spend the lock exists to prevent.
 */
export function getReverifyBudgetMs(): number {
  return envNumber("COMMUNITY_REVERIFY_BUDGET_MS", 600_000, 1_000);
}

export async function reverifyLapsedAccess(
  options: {
    budgetMs?: number;
    batchSize?: number;
    /** Test/ops hook: yields a per-row claim so replicas do not double-spend. */
    shouldProcess?: (row: { userId: string; channelId: string }) => boolean | Promise<boolean>;
    now?: () => Date;
  } = {},
): Promise<ReverifySummary> {
  const budgetMs = options.budgetMs ?? getReverifyBudgetMs();
  const batchSize = options.batchSize ?? getActiveRecheckBatchSize();
  const now = options.now ?? (() => new Date());
  const deadline = Date.now() + budgetMs;

  const summary: ReverifySummary = {
    checked: 0,
    stillSubscribed: 0,
    revoked: 0,
    failed: 0,
    unverifiable: 0,
    budgetExhausted: false,
  };

  let cursor: { userId: string; channelId: string }[] = await findLapsedAccess(batchSize);

  while (cursor.length > 0) {
    for (const row of cursor) {
      if (Date.now() >= deadline) {
        summary.budgetExhausted = true;
        break;
      }
      if (options.shouldProcess && !(await options.shouldProcess(row))) continue;

      const result = await checkChannelAccess(row.userId, row.channelId, {
        reason: "SCHEDULED",
        now: now(),
      });
      summary.checked += 1;

      switch (result.verdict) {
        case "subscribed":
          summary.stillSubscribed += 1;
          break;
        case "notSubscribed":
          summary.revoked += 1;
          break;
        case "reauthRequired":
          summary.unverifiable += 1;
          break;
        default:
          summary.failed += 1;
      }
    }

    if (summary.budgetExhausted) break;

    // The pass just rewrote the leases of everything it looked at, so re-querying
    // the same "lapsed" predicate advances through the table naturally. Rows whose
    // check failed stay lapsed and would come back immediately, so the next page
    // is capped at the batch size and the deadline is what eventually stops it.
    const next = await findLapsedAccess(batchSize);
    if (next.length === 0) break;
    if (
      next.every((r) => cursor.some((c) => c.userId === r.userId && c.channelId === r.channelId))
    ) {
      // Nothing new became due — every row we would re-fetch is one we just
      // failed on. Stop rather than spin on the same rows until the budget dies.
      break;
    }
    cursor = next;
  }

  return summary;
}

export { ChannelAccessStatus };
