// ─────────────────────────────────────────
// Community Service — Video Feed & Analytics
// ─────────────────────────────────────────
// Manages community video cards, per-user unlock state, interaction logging,
// basic analytics aggregation, and YouTube channel sync for the admin.

import { prisma } from "../config/index.js";
import {
  Prisma,
  VideoInteractionType,
  type CommunityVideo,
} from "../../generated/prisma/client.js";
import { decryptSecret, isEncryptedPayload } from "../helpers/encryption.js";
import {
  resolveChannelId,
  fetchLatestCards,
  getCachedSync,
  setCachedSync,
  buildFullWatchUrl,
  buildWatchLinks,
  getChannelLinks,
  type ChannelLinks,
  DEFAULT_MAX_RESULTS,
  DEFAULT_PREVIEW_DURATION_SECONDS,
} from "./youtube.service.js";
import {
  checkChannelAccess,
  readChannelAccess,
  resolveTargetChannelId,
  revokeAccessManually,
  reencryptLegacyRefreshTokens as reencryptStoredTokens,
  reverifyLapsedAccess,
  REFRESH_TOKEN_CONTEXT,
  type ChannelAccessSnapshot,
  type AccessCheckReason,
} from "./channel-access.service.js";

// ── Card payload gating ───────────────────────────────────────────────────────
// Locked videos must not hand out the full-length video. The YouTube video id
// and the derived full watch URL are therefore only present once the caller
// holds a durable unlock; everything needed to sample the content (thumbnail +
// clipped preview) is still returned so a locked card is not a dead end.
//
// `channel` is identical on every card — it is repeated rather than hoisted to
// the envelope so a card stays self-contained for the app's per-card action bar.

const CARD_SELECT = {
  id: true,
  title: true,
  description: true,
  teaserUrl: true,
  previewStartSeconds: true,
  previewDurationSeconds: true,
  thumbnailUrl: true,
  youtubeVideoId: true,
  publishedAt: true,
  viewCount: true,
  likeCount: true,
} as const;

type CardRecord = {
  id: string;
  title: string;
  description: string;
  teaserUrl: string;
  previewStartSeconds: number;
  previewDurationSeconds: number;
  thumbnailUrl: string;
  youtubeVideoId: string;
  publishedAt: Date;
  viewCount: number;
  likeCount: number;
};

export interface CardPayload {
  videoId: string;
  title: string;
  description: string;
  teaserUrl: string;
  previewStartSeconds: number;
  previewDurationSeconds: number;
  thumbnailUrl: string;
  isUnlocked: boolean;
  unlockedAt: Date | null;
  requiresSubscription: boolean;
  // YouTube's public counters, refreshed by the channel sync. Safe to expose on
  // a locked card: they describe the video, not grant access to it. Zero means
  // either genuinely unwatched or not yet synced — the feed is still usable
  // either way, so the app can render them unconditionally.
  viewCount: number;
  likeCount: number;
  // Where the "Subscribe to Unlock" call-to-action should send the user. Resolved
  // server-side so the app never hardcodes the channel. All fields are null when
  // YOUTUBE_CHANNEL_ID / YOUTUBE_CHANNEL_HANDLE are unset.
  channel: ChannelLinks;
  youtubeVideoId?: string;
  watchUrl?: string;
  // Where the end-of-preview "Watch Full Video on YouTube" call-to-action deep
  // links. Resolved server-side for the same reason `channel` is: the app is not
  // given a scheme string to concatenate. Present only when isUnlocked, so a
  // locked card still withholds every string that reconstructs the full video.
  watchAppUrl?: string;
  watchWebUrl?: string;
}

export function toCardPayload(
  record: CardRecord,
  isUnlocked: boolean,
  unlockedAt: Date | null,
): CardPayload {
  const base: CardPayload = {
    videoId: record.id,
    title: record.title,
    description: record.description,
    teaserUrl: record.teaserUrl,
    previewStartSeconds: record.previewStartSeconds,
    previewDurationSeconds: record.previewDurationSeconds,
    thumbnailUrl: record.thumbnailUrl,
    isUnlocked,
    unlockedAt,
    requiresSubscription: !isUnlocked,
    viewCount: record.viewCount,
    likeCount: record.likeCount,
    channel: getChannelLinks(),
  };

  if (!isUnlocked) {
    return base;
  }

  const watch = buildWatchLinks(record.youtubeVideoId);

  return {
    ...base,
    youtubeVideoId: record.youtubeVideoId,
    watchUrl: buildFullWatchUrl(record.youtubeVideoId),
    watchAppUrl: watch.appUrl,
    watchWebUrl: watch.webUrl,
  };
}

// ── Video identifier resolution ───────────────────────────────────────────────
// User-facing routes accept the internal card id (uuid) OR the YouTube video id
// (e.g. from a deep link), so the app never needs to know which it holds. Always
// resolve to the canonical DB id before writing unlock/interaction rows so the
// foreign key points at the real CommunityVideo.

async function resolvePublishedVideo(identifier: string) {
  return prisma.communityVideo.findFirst({
    where: { isPublished: true, OR: [{ id: identifier }, { youtubeVideoId: identifier }] },
    select: { id: true },
  });
}

/**
 * Card timestamps as Date, access snapshots as ISO strings.
 *
 * CardPayload carries Dates and the wire serialises them the same either way, so
 * the conversion is confined to this one helper rather than left implicit at each
 * call site. Going the other way — widening CardPayload to strings — would have
 * been a public API change made to satisfy a type checker.
 */
function asDate(iso: string | null): Date | null {
  return iso ? new Date(iso) : null;
}

// ─────────────────────────────────────────
// Channel-level access
// ─────────────────────────────────────────
// A YouTube subscription is granted per CHANNEL, not per video, so the record that
// opens the feed is channel-scoped. That record — and every rule about it — lives
// in channel-access.service.ts, because it is not a community concern: it is the
// authorization decision, and the only version of it is the one that service
// makes.
//
// What is left here is the community-specific half: turning one decision into the
// shapes the endpoints return. Nothing below reads a subscription, a credential,
// or a per-video grant to work out whether a user may watch something. It asks
// the service, and serialises the answer.
//
// Two boundaries are worth stating because both were violated before:
//
//   Per-video VideoUnlock rows are ANALYTICS, not authorization. They record
//   which card a conversion happened on. They are never consulted to open a feed,
//   and a confirmed unsubscribe deletes them, so a stale card read has nothing
//   left to find. That is why `getUnlockStatus` cannot be tricked into reopening
//   a channel by a leftover row.
//
//   One snapshot per response. A feed page is serialized from a single access
//   object, taken once. Resolving access per card would let two cards in one
//   response disagree, and a client would have no way to tell which was right.

// Re-exported so callers that only need the decision do not have to know which
// module owns it. The type is the canonical contract: one object, one shape, and
// every endpoint returns it unchanged.
export type { ChannelAccessSnapshot } from "./channel-access.service.js";
export {
  noRecordSnapshot,
  verificationNotConfiguredSnapshot,
  verificationUnavailableSnapshot,
} from "./channel-access.service.js";

export interface ReadChannelAccess {
  access: ChannelAccessSnapshot;
  /** True when a Google call was actually made for this read. */
  checked: boolean;
}

/**
 * The caller's decision for a read.
 *
 * Delegates entirely. The lease is the freshness policy — a confirmed positive is
 * honoured until it lapses, and a lapsed one is re-checked — so no caller here
 * decides when to ask Google, and two endpoints cannot disagree about it.
 *
 * `checked` is reported so a caller can log whether this request spent a quota
 * unit, and so the feed does not resolve the same thing twice.
 */
export async function resolveChannelAccessForRead(
  userId: string,
  options: { reason?: AccessCheckReason; now?: Date } = {},
): Promise<ReadChannelAccess> {
  return readChannelAccess(userId, { reason: options.reason ?? "READ", now: options.now });
}

/**
 * The caller's decision for a NEW authenticated session.
 *
 * Separate from the read path on purpose. A session boundary is exactly where
 * yesterday's evidence stops being evidence about today: a user who unsubscribed
 * at 09:00 and signs in at 09:01 must not be shown an unlocked feed on a lease
 * that is still live from yesterday's login. LOGIN therefore forces a check even
 * when a lease exists.
 *
 * Best effort by design — a successful app login must not depend on Google being
 * reachable. The failure modes are returned, not thrown: NOT_CONNECTED and
 * CHECK_FAILED both come back as a usable session with community content locked,
 * which is a much better outcome than refusing to sign someone in.
 */
export async function resolveChannelAccessForLogin(userId: string): Promise<ChannelAccessSnapshot> {
  const channelId = await resolveTargetChannelId();
  if (!channelId) {
    return {
      channelId: "",
      status: "NOT_CONNECTED",
      hasChannelAccess: false,
      verifiedAt: null,
      accessExpiresAt: null,
      accessVersion: 0,
      requiresGoogleConnection: false,
      reason: "VERIFICATION_NOT_CONFIGURED",
    };
  }

  try {
    const result = await checkChannelAccess(userId, channelId, { reason: "LOGIN", channelId });
    return result.access;
  } catch (error) {
    // Logged and swallowed. The session is still valid; only community content is
    // unavailable, and saying "verification is unavailable" is recoverable in a
    // way that a failed login is not.
    console.error(
      `[Community Access] Login check failed for user ${userId}; community content stays locked:`,
      error instanceof Error ? error.message : String(error),
    );
    return {
      channelId,
      status: "CHECK_FAILED",
      hasChannelAccess: false,
      verifiedAt: null,
      accessExpiresAt: null,
      accessVersion: 0,
      requiresGoogleConnection: false,
      reason: "VERIFICATION_UNAVAILABLE",
    };
  }
}

// ── Admin inspection ──────────────────────────────────────────────────────────
// The access table is otherwise unreachable from outside the process: the only
// reads are the per-user lookups on the feed hot path, and the only writers are
// the OAuth callback and the sweep. Without this, answering "does this account
// still have access, and can we still prove it?" meant writing a script against
// the database.
//
// Nothing here returns a refresh token, sealed or otherwise. `tokenEncrypted`
// reports only whether one is present and stored under the encryption helper, so
// the console can show how many links are still sitting in the clear.

export const CHANNEL_GRANT_STATUSES = ["active", "revoked", "all"] as const;
export type ChannelGrantStatus = (typeof CHANNEL_GRANT_STATUSES)[number];

export interface ChannelGrantRow {
  id: string;
  userId: string;
  user: { id: string; email: string | null; fullName: string | null } | null;
  channelId: string;
  unlockedAt: Date;
  /** Last check that completed, either direction. Null if none ever has. */
  verifiedAt: Date | null;
  accessVersion: number;
  status: string;
  accessExpiresAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  /** The Google account the check was made for. Diagnostic; never a credential. */
  googleSubject: string | null;
  googleEmail: string | null;
  grantedScopes: string | null;
  hasRefreshToken: boolean;
  /** False means the stored credential is still plaintext, or unreadable. */
  tokenEncrypted: boolean | null;
  /**
   * True when the link cannot be re-checked at all — no credential, or one we
   * cannot read. Such a row is REAUTH_REQUIRED, i.e. closed, because an
   * unverifiable grant is one no unsubscribe could ever revoke.
   */
  unverifiable: boolean;
  /** True when the lease has lapsed and the next read must re-check. */
  dueForRecheck: boolean;
}

export interface ChannelGrantSummary {
  /** Rows that will unlock content right now: SUBSCRIBED with a live lease. */
  active: number;
  revoked: number;
  /** Rows that can never be re-checked, whatever they claim. */
  unverifiable: number;
  /** Rows still holding a plaintext refresh token. */
  unencrypted: number;
  /** Lapsed or lease-less rows the sweep is due to re-decide. */
  due: number;
  /** CHECK_FAILED rows — our check failed, not the user's subscription. */
  checkFailed: number;
}

export interface ListChannelGrantsOptions {
  status?: ChannelGrantStatus;
  page?: number;
  limit?: number;
  /** Case-insensitive match on the user's email or name. */
  search?: string;
}

export async function listChannelGrants(
  options: ListChannelGrantsOptions = {},
): Promise<{ rows: ChannelGrantRow[]; total: number; summary: ChannelGrantSummary }> {
  const status = options.status ?? "active";
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 25));

  // "active" is now a computed notion rather than a stored flag: it means a
  // status of SUBSCRIBED with an unexpired lease. Filtering in SQL on a lease
  // expiry is expressible, and doing it there rather than in JS keeps the count
  // consistent with the page.
  const now = new Date();
  const statusFilter: Prisma.ChannelAccessWhereInput =
    status === "all"
      ? {}
      : status === "revoked"
        ? { revokedAt: { not: null } }
        : { status: "SUBSCRIBED", revokedAt: null, accessExpiresAt: { gt: now } };

  const search = options.search?.trim();
  const where: Prisma.ChannelAccessWhereInput = {
    ...statusFilter,
    ...(search
      ? {
          user: {
            OR: [
              { email: { contains: search, mode: "insensitive" } },
              { fullName: { contains: search, mode: "insensitive" } },
            ],
          },
        }
      : {}),
  };

  const [rows, total, active, revoked, noToken, tokens, due, checkFailed] =
    await prisma.$transaction([
      prisma.channelAccess.findMany({
        where,
        select: {
          id: true,
          userId: true,
          user: { select: { id: true, email: true, fullName: true } },
          channelId: true,
          unlockedAt: true,
          verifiedAt: true,
          accessVersion: true,
          status: true,
          accessExpiresAt: true,
          revokedAt: true,
          revokedReason: true,
          googleSubject: true,
          googleEmail: true,
          grantedScopes: true,
          refreshToken: true,
        },
        orderBy: { unlockedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.channelAccess.count({ where }),
      prisma.channelAccess.count({
        where: { status: "SUBSCRIBED", revokedAt: null, accessExpiresAt: { gt: now } },
      }),
      prisma.channelAccess.count({ where: { revokedAt: { not: null } } }),
      prisma.channelAccess.count({ where: { refreshToken: null } }),
      // Whether a token is sealed cannot be expressed in SQL — one we cannot read
      // has to be tried against the key to be told apart from one that is merely
      // plaintext. Admin-only, bounded by the subscriber count. Cheaper than
      // guessing and reporting a false "ok".
      prisma.channelAccess.findMany({
        where: { refreshToken: { not: null } },
        select: { refreshToken: true },
      }),
      prisma.channelAccess.count({
        where: {
          revokedAt: null,
          status: { in: ["SUBSCRIBED", "CHECK_FAILED"] },
          OR: [{ accessExpiresAt: null }, { accessExpiresAt: { lte: now } }],
        },
      }),
      prisma.channelAccess.count({ where: { status: "CHECK_FAILED" } }),
    ]);

  // Table-wide credential health, independent of the current page. Whether a
  // stored token is *sealed* is a prefix check; whether it is still *usable* is
  // not, because one sealed under a rotated-away key looks identical to a healthy
  // one until something tries to open it. Both are asked, because collapsing them
  // would either hide unusable links or report plaintext ones as fine.
  let undecryptable = 0;
  let plaintext = 0;
  for (const row of tokens) {
    const stored = row.refreshToken as string;
    if (!isEncryptedPayload(stored)) {
      plaintext += 1;
    } else if (!isCredentialReadable(stored)) {
      undecryptable += 1;
    }
  }

  return {
    rows: rows.map((row) => {
      const sealed = row.refreshToken ? isEncryptedPayload(row.refreshToken) : null;
      const readable = row.refreshToken && sealed ? isCredentialReadable(row.refreshToken) : null;
      const liveLease =
        row.accessExpiresAt !== null && row.accessExpiresAt.getTime() > now.getTime();
      return {
        id: row.id,
        userId: row.userId,
        user: row.user,
        channelId: row.channelId,
        unlockedAt: row.unlockedAt,
        verifiedAt: row.verifiedAt,
        accessVersion: row.accessVersion,
        status: row.status,
        accessExpiresAt: row.accessExpiresAt,
        revokedAt: row.revokedAt,
        revokedReason: row.revokedReason,
        googleSubject: row.googleSubject,
        googleEmail: row.googleEmail,
        grantedScopes: row.grantedScopes,
        hasRefreshToken: Boolean(row.refreshToken),
        tokenEncrypted: sealed === null ? null : sealed && readable,
        // A row with no usable credential is never trusted, whatever its status
        // column says — that is the whole point of REAUTH_REQUIRED.
        unverifiable: !row.refreshToken || readable === false,
        dueForRecheck: row.revokedAt === null && (!row.accessExpiresAt || !liveLease),
      };
    }),
    total,
    summary: {
      active,
      revoked,
      unverifiable: noToken + undecryptable,
      unencrypted: plaintext,
      due,
      checkFailed,
    },
  };
}

/**
 * Whether a sealed refresh token can still be opened with the current key.
 *
 * Distinct from isEncryptedPayload, which only asks whether the payload is in the
 * sealed format. A token sealed under a previous key is still sealed and no longer
 * usable, and the only way to tell the difference is to try. The plaintext is
 * discarded immediately and never logged or returned.
 */
function isCredentialReadable(stored: string): boolean {
  try {
    // Same AAD context the access service seals with, imported from it. Using a
    // different string here would not throw on a wrong key — GCM auth would fail
    // and this would report every healthy link as unreadable.
    decryptSecret(stored, REFRESH_TOKEN_CONTEXT);
    return true;
  } catch {
    // SecretDecryptionError or a malformed payload. Either way the link cannot
    // serve a re-check, which is REAUTH_REQUIRED territory.
    return false;
  }
}

/**
 * Closes a link on an admin's say-so, without consulting YouTube.
 *
 * The escape hatch for what polling cannot resolve: a support request, a refund,
 * a link stuck in a state no check will ever clear. Recorded as MANUAL so it is
 * distinguishable from a confirmed unsubscribe, and recoverable — a later
 * re-authorisation revives the same row.
 */
export async function revokeChannelGrantManually(
  userId: string,
  channelId?: string,
): Promise<boolean> {
  const result = await revokeAccessManually(userId, channelId);
  return result.revoked;
}

/**
 * Re-seals any refresh token still stored in the clear.
 *
 * New writes have been sealed since the encryption landed, and every successful
 * re-check re-seals the row it touches. This covers the rest, and is safe to run
 * repeatedly.
 */
export async function reencryptLegacyRefreshTokens(): Promise<{
  scanned: number;
  sealed: number;
  unsealable: number;
}> {
  return reencryptStoredTokens();
}

// ── Re-verification sweep ─────────────────────────────────────────────────────
// A YouTube subscription is mutable from outside our system and YouTube publishes
// no event when it changes, so access cannot stay authoritative forever without
// being re-asked. The sweep lives in channel-access.service.ts because the lease
// is what makes it safe to run at all: a check that cannot be performed leaves the
// row alone, an unsubscribe clears the lease and revokes, and a slow sweep
// therefore delays detection without ever granting standing access.
//
// The two deliberate differences from the previous implementation:
//
//   It no longer fails open. It could not, once a lease existed — leaving a grant
//   intact on a failed check was only defensible when a grant had no expiry, and
//   it turned a Google outage into indefinite access for everyone.
//
//   It is budget-bounded rather than count-bounded, because a fixed count cannot
//   promise to finish inside the lock TTL and therefore cannot bound revocation
//   latency as the subscriber base grows.

export type { ReverifySummary } from "./channel-access.service.js";

// Re-exported rather than redefined. The scheduler needs this value to size its
// lock, and a second implementation of "how long does a pass run" is a number
// that can disagree with the one the sweep actually honours.
export { getReverifyBudgetMs } from "./channel-access.service.js";

export interface ReverifyOptions {
  now?: Date;
  /** Overrides COMMUNITY_REVERIFY_BUDGET_MS. Mainly for tests. */
  budgetMs?: number;
  /**
   * Gate consulted once per due row, before any API call. Returning false skips
   * the row. The scheduled job passes a distributed claim here so an overlapping
   * run — or a second replica — cannot check the same row twice and spend the
   * quota twice.
   */
  shouldProcess?: (row: { userId: string; channelId: string }) => Promise<boolean>;
}

export async function reverifyChannelGrants(options: ReverifyOptions = {}) {
  return reverifyLapsedAccess({
    budgetMs: options.budgetMs,
    shouldProcess: options.shouldProcess,
    now: options.now ? () => options.now! : undefined,
  });
}

// ── Feed ordering ────────────────────────────────────────────────────────────
// The feed is ordered by one of three signals, all resolved from columns on
// community_videos so the sort stays a single indexed query — no in-memory
// ranking, no join against the interaction log.
//
//   NEWEST        publication date — the historical default
//   MOST_WATCHED  YouTube viewCount
//   MOST_LIKED    YouTube likeCount
//
// Engagement sorts put the channel's biggest draws first, which is a different
// (and deliberately non-chronological) feed: a two-year-old video can outrank
// last week's upload. Every ordering is given the same tie-break chain so
// LIMIT/OFFSET paging is stable — without it, rows sharing a count can shuffle
// between requests and a card appears on two pages or none at all.

export const VIDEO_SORTS = ["NEWEST", "MOST_WATCHED", "MOST_LIKED"] as const;
export type VideoSort = (typeof VIDEO_SORTS)[number];
export const DEFAULT_VIDEO_SORT: VideoSort = "NEWEST";

const VIDEO_ORDER_BY: Record<VideoSort, Prisma.CommunityVideoOrderByWithRelationInput[]> = {
  NEWEST: [{ publishedAt: "desc" }, { id: "desc" }],
  MOST_WATCHED: [{ viewCount: "desc" }, { publishedAt: "desc" }, { id: "desc" }],
  MOST_LIKED: [{ likeCount: "desc" }, { publishedAt: "desc" }, { id: "desc" }],
};

export interface ListVideosOptions {
  /** Falls back to NEWEST for an absent or unrecognised value. */
  sort?: VideoSort;
  /**
   * The caller's access decision, already resolved by
   * `resolveChannelAccessForRead`. Passed in so the feed does not re-resolve the
   * decision it just re-checked against YouTube — this is the hottest read in the
   * app and the lease lookup sits on it.
   *
   * There is no fallback lookup. A caller that has not gone through the read gate
   * gets a locked feed, which is the safe direction: it is visible in testing and
   * cannot happen in production, where every feed route resolves access first.
   */
  channelAccess?: ChannelAccessSnapshot | null;
}

// ── List published videos with per-user unlock state ─────────────────────────
// Used by GET /community/videos so the response already includes isUnlocked per
// card. Each card is run through the payload gate, so locked videos expose only
// their clipped preview.
//
// One boolean gates the entire page. That is the whole point of a channel-scoped
// subscription: there is no per-card state left to compute, so there is no second
// code path that could disagree with the first, and no per-video query to run.

export async function listVideosForUser(
  userId: string,
  page: number,
  limit: number,
  options: ListVideosOptions = {},
) {
  const skip = (page - 1) * limit;
  const sort: VideoSort = options.sort ?? DEFAULT_VIDEO_SORT;
  const access = options.channelAccess ?? null;

  const [videos, total] = await prisma.$transaction([
    prisma.communityVideo.findMany({
      where: { isPublished: true },
      orderBy: VIDEO_ORDER_BY[sort],
      skip,
      take: limit,
      select: CARD_SELECT,
    }),
    prisma.communityVideo.count({ where: { isPublished: true } }),
  ]);

  const hasChannelAccess = access?.hasChannelAccess === true;

  const enriched = videos.map((v) =>
    // A channel subscription covers every card, including ones published since,
    // and carries the timestamp the positive was confirmed at. Resolved once,
    // before the page is built, so no card can report a different answer from its
    // neighbour in the same response.
    toCardPayload(v, hasChannelAccess, hasChannelAccess ? asDate(access!.verifiedAt) : null),
  );

  return {
    videos: enriched,
    total,
    // Echoed so a client that pages through a sorted feed can confirm the server
    // honoured its `sort` — an unrecognised value silently becomes NEWEST.
    sort,
    // Feed-level flag so the app can hide every "Subscribe to Unlock" call to
    // action at once instead of evaluating the CTA per card.
    hasChannelAccess,
    // The decision the page was built from, returned verbatim so a client never
    // has to infer access from the cards.
    access,
  };
}

// ── Get a single published video ─────────────────────────────────────────────
// Accepts either the internal card id or the YouTube video id.

// Ungated read for internal callers that only need to resolve identifiers (e.g.
// the OAuth start flow, which signs a state token). Never return this to a client.
export async function getVideoRecord(videoId: string) {
  return prisma.communityVideo.findFirst({
    where: { isPublished: true, OR: [{ id: videoId }, { youtubeVideoId: videoId }] },
    select: CARD_SELECT,
  });
}

export async function getVideoForUser(
  userId: string,
  videoId: string,
  options: { channelAccess?: ChannelAccessSnapshot | null } = {},
) {
  const video = await getVideoRecord(videoId);
  if (!video) {
    return null;
  }

  const access = options.channelAccess ?? null;
  const unlocked = access?.hasChannelAccess === true;
  return toCardPayload(video, unlocked, unlocked ? asDate(access!.verifiedAt) : null);
}

// ── Get unlock status for a single video ─────────────────────────────────────

export interface UnlockStatus {
  isUnlocked: boolean;
  /**
   * When the positive was last confirmed by Google. For a channel-opened video
   * this is the subscription check, not a per-card event, which is why the two
   * are the same value — a card has no unlock moment of its own.
   */
  unlockedAt: string | null;
  /** Which record produced the answer — tells the app why a card is open. */
  via: "CHANNEL" | null;
  hasChannelAccess: boolean;
  /** The decision itself, so the caller can return one snapshot to the client. */
  access: ChannelAccessSnapshot | null;
}

export async function getUnlockStatus(
  userId: string,
  videoId: string,
  options: { channelAccess?: ChannelAccessSnapshot | null } = {},
): Promise<UnlockStatus> {
  const access = options.channelAccess ?? null;
  const unlocked = access?.hasChannelAccess === true;

  // No per-video row is consulted, and that is deliberate rather than an
  // oversight. Those rows are analytics: they answer "which card did this user
  // convert on", not "may this user watch". The moment they could answer the
  // second question, a confirmed unsubscribe would depend on a sweep happening
  // to run before the next read — and revocation already deletes them, so there
  // is nothing to find anyway.
  return {
    isUnlocked: unlocked,
    unlockedAt: unlocked ? access!.verifiedAt : null,
    via: unlocked ? "CHANNEL" : null,
    hasChannelAccess: unlocked,
    access,
  };
}

// ── Unlock a video for a user ─────────────────────────────────────────────────
// A full-length video is the reward for subscribing to the channel, so unlocking
// requires a server-confirmed subscription verdict — the client saying "I came
// back from YouTube" is not evidence of anything.
//
// The endpoint exists to let a client confirm and observe a decision; it is not a
// way to obtain one. A tap carries no proof, so this consults the subscription
// service exactly as a read would and then reports what it found. With no
// channel access the answer is 403, never a per-video grant, which is what stops
// this route from becoming the fail-open back door the OAuth callback is not.

export type UnlockResult =
  | { success: false; code: "VIDEO_NOT_FOUND" }
  | {
      success: false;
      code: "SUBSCRIPTION_REQUIRED";
      /** Carried so the client can tell "not subscribed" from "we could not ask". */
      reason: string | null;
      verifiedAt: string | null;
      access: ChannelAccessSnapshot | null;
    }
  | {
      success: true;
      isUnlocked: true;
      unlockedAt: string;
      access: ChannelAccessSnapshot;
    };

export interface UnlockOptions {
  /**
   * Access already resolved by `resolveChannelAccessForRead`. When supplied the
   * unlock costs no extra quota; when omitted the decision is resolved here.
   */
  channelAccess?: ChannelAccessSnapshot | null;
}

export async function unlockVideo(
  userId: string,
  videoId: string,
  options: UnlockOptions = {},
): Promise<UnlockResult> {
  const video = await resolvePublishedVideo(videoId);

  if (!video) {
    return { success: false, code: "VIDEO_NOT_FOUND" as const };
  }

  // PLAYBACK, not EXPLICIT: this is the request that supplies the full-length
  // fields, so it is the moment a lapsed verdict has to be refreshed. A live lease
  // is reused, which keeps a normal tap free.
  const access =
    options.channelAccess !== undefined
      ? options.channelAccess
      : (await resolveChannelAccessForRead(userId, { reason: "PLAYBACK" })).access;

  if (!access || !access.hasChannelAccess) {
    return {
      success: false,
      code: "SUBSCRIPTION_REQUIRED" as const,
      reason: access?.reason ?? null,
      verifiedAt: access?.verifiedAt ?? null,
      access,
    };
  }

  // The per-video row is written only now, when access is already established,
  // and only to attribute the conversion to a card. It grants nothing.
  const record = await prisma.videoUnlock.upsert({
    where: { userId_videoId: { userId, videoId: video.id } },
    update: {}, // already attributed; keep the original timestamp
    create: { userId, videoId: video.id },
    select: { unlockedAt: true },
  });

  return {
    success: true,
    isUnlocked: true as const,
    unlockedAt: access.verifiedAt ?? record.unlockedAt.toISOString(),
    access,
  };
}

// ── Log an interaction event ──────────────────────────────────────────────────
// Append-only analytics row. Validates the video exists before inserting.

export async function logInteraction(
  userId: string,
  videoId: string,
  action: VideoInteractionType,
  durationMs?: number,
) {
  const video = await resolvePublishedVideo(videoId);

  if (!video) {
    return { success: false, code: "VIDEO_NOT_FOUND" as const };
  }

  await prisma.videoInteraction.create({ data: { userId, videoId: video.id, action, durationMs } });
  return { success: true };
}

// ── Get all unlocked video IDs for a user ─────────────────────────────────────
// Used by GET /community/my-unlocks to rehydrate local state on app launch.
//
// A channel grant means the whole feed is open, so it is reported alongside the
// per-video rows rather than being expanded into one row per video: the app
// needs to know "you have everything" in order to stop showing subscribe CTAs,
// and materialising every video id would grow without bound as the channel does.

export async function getUserUnlocks(
  userId: string,
  options: { channelAccess?: ChannelAccessSnapshot | null } = {},
) {
  const access = options.channelAccess ?? null;
  const unlocks = await prisma.videoUnlock.findMany({
    where: { userId },
    select: { videoId: true, unlockedAt: true },
    orderBy: { unlockedAt: "desc" },
  });

  return {
    hasChannelAccess: access?.hasChannelAccess === true,
    // The decision, not a trimmed copy of it. A client comparing versions needs
    // accessVersion, and it is absent from the old three-field shape.
    access,
    // Analytics only. Reported alongside access so the two are never confused:
    // a non-empty list here does not mean the feed is open.
    unlocks: unlocks.map((u) => ({ videoId: u.videoId, unlockedAt: u.unlockedAt })),
  };
}

// ── Admin: get interaction counts for a video ─────────────────────────────────

export async function getVideoAnalytics(videoId: string) {
  const video = await prisma.communityVideo.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      title: true,
      youtubeVideoId: true,
      viewCount: true,
      likeCount: true,
      statsSyncedAt: true,
    },
  });

  if (!video) {
    return null;
  }

  const rows = await prisma.videoInteraction.groupBy({
    by: ["action"],
    where: { videoId },
    _count: { action: true },
  });

  // Build a zeroed-out base then overwrite with real counts
  const counts: Record<VideoInteractionType, number> = {
    SUBSCRIBE_INTENT: 0,
    PREVIEW_CLIP: 0,
    WATCH_FULL_VIDEO: 0,
    UNLOCK: 0,
  };

  for (const row of rows) {
    counts[row.action] = row._count.action;
  }

  const totalUnlocks = await prisma.videoUnlock.count({ where: { videoId } });

  // Aggregate client-reported watch time (durationMs) across interactions.
  const watchTime = await prisma.videoInteraction.aggregate({
    where: { videoId, durationMs: { not: null } },
    _sum: { durationMs: true },
    _avg: { durationMs: true },
  });

  return {
    videoId: video.id,
    title: video.title,
    youtubeVideoId: video.youtubeVideoId,
    interactions: counts,
    totalUnlocks,
    // Channel-wide engagement from YouTube, kept separate from the in-app
    // `interactions` above: the gap between the two is the whole point of the
    // panel — a high likeCount with few in-app previews means the feed is not
    // surfacing a video the audience already cares about.
    youtube: {
      viewCount: video.viewCount,
      likeCount: video.likeCount,
      // null when the card predates the counters or the last sync could not read
      // them, so a stale ranking is distinguishable from a genuinely unwatched one.
      statsSyncedAt: video.statsSyncedAt,
    },
    conversionRate:
      counts.SUBSCRIBE_INTENT > 0 ? Number((totalUnlocks / counts.SUBSCRIBE_INTENT).toFixed(4)) : 0,
    totalWatchTimeMs: watchTime._sum.durationMs ?? null,
    avgWatchTimeMs: watchTime._avg.durationMs ? Math.round(watchTime._avg.durationMs) : null,
  };
}

// ── Admin: create a video card ────────────────────────────────────────────────

export interface CreateVideoPayload {
  title: string;
  description: string;
  teaserUrl: string; // CLIPPED preview embed URL — not the full-length video
  thumbnailUrl: string;
  youtubeVideoId: string;
  previewStartSeconds?: number;
  previewDurationSeconds?: number;
  isPublished?: boolean;
  // Seed engagement for a hand-made card so it is not buried under the
  // engagement sorts until the next channel sync sees it. Overwritten by any
  // later sync, which is the authority on these numbers.
  viewCount?: number;
  likeCount?: number;
}

// Explicit discriminated union so callers can narrow on result.success. Without
// it TS widens both arms to `success: boolean` and `data` stays `| undefined`.
export type CreateVideoResult =
  { success: false; code: "DUPLICATE_VIDEO_ID" } | { success: true; data: CommunityVideo };

/** Counters arrive from an admin request body, so clamp rather than trust. */
function countOrZero(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) > 0 ? Math.floor(value as number) : 0;
}

export async function adminCreateVideo(payload: CreateVideoPayload): Promise<CreateVideoResult> {
  const existing = await prisma.communityVideo.findUnique({
    where: { youtubeVideoId: payload.youtubeVideoId },
    select: { id: true },
  });

  if (existing) {
    return { success: false, code: "DUPLICATE_VIDEO_ID" as const };
  }

  const video = await prisma.communityVideo.create({
    data: {
      title: payload.title,
      description: payload.description,
      teaserUrl: payload.teaserUrl,
      thumbnailUrl: payload.thumbnailUrl,
      youtubeVideoId: payload.youtubeVideoId,
      previewStartSeconds: payload.previewStartSeconds ?? 0,
      previewDurationSeconds: payload.previewDurationSeconds ?? DEFAULT_PREVIEW_DURATION_SECONDS,
      isPublished: payload.isPublished ?? true,
      viewCount: countOrZero(payload.viewCount),
      likeCount: countOrZero(payload.likeCount),
      // A hand-seeded count has not been confirmed by YouTube, so it does not
      // claim a sync that never happened.
      ...(payload.viewCount === undefined && payload.likeCount === undefined
        ? {}
        : { statsSyncedAt: new Date() }),
    },
  });

  return { success: true, data: video };
}

// ── Admin: update a video card ────────────────────────────────────────────────

export interface UpdateVideoPayload {
  title?: string;
  description?: string;
  teaserUrl?: string;
  thumbnailUrl?: string;
  previewStartSeconds?: number;
  previewDurationSeconds?: number;
  isPublished?: boolean;
}

export type AdminUpdateVideoResult =
  { success: false; code: "VIDEO_NOT_FOUND" } | { success: true; data: CommunityVideo };

export async function adminUpdateVideo(
  videoId: string,
  payload: UpdateVideoPayload,
): Promise<AdminUpdateVideoResult> {
  const existing = await prisma.communityVideo.findUnique({
    where: { id: videoId },
    select: { id: true },
  });

  if (!existing) {
    return { success: false, code: "VIDEO_NOT_FOUND" as const };
  }

  const video = await prisma.communityVideo.update({
    where: { id: videoId },
    data: payload,
  });

  return { success: true, data: video };
}

// ── Admin: soft-delete (unpublish) a video card ───────────────────────────────

export async function adminDeleteVideo(videoId: string) {
  const existing = await prisma.communityVideo.findUnique({
    where: { id: videoId },
    select: { id: true },
  });

  if (!existing) {
    return { success: false, code: "VIDEO_NOT_FOUND" as const };
  }

  await prisma.communityVideo.update({
    where: { id: videoId },
    data: { isPublished: false },
  });

  return { success: true };
}

// ── Admin: sync latest uploads from the configured YouTube channel ────────────
// Fetches the channel's most recent uploads via the YouTube Data API and adds
// any missing videos to the feed. Cards that already exist keep their
// admin-edited content (title/description, teaser bounds) and their soft-delete
// (isPublished=false) — only the engagement counters are refreshed, because
// those belong to YouTube rather than to us.
//
// That refresh is what makes the engagement rankings mean anything: a
// never-updated row keeps the counts it had the day it was first seen, so a
// video that has since gone viral would never climb the "most watched" feed.
//
// Teasers are derived from the video's own embed URL bounded to the first 45
// seconds, so a freshly synced card can only ever serve a preview until the
// viewer subscribes. The full-length URL is never stored.

export interface SyncVideosPayload {
  channelId?: string;
  handle?: string;
  maxResults?: number;
}

export async function syncVideosFromChannel(payload: SyncVideosPayload) {
  // Resolve the channel first — it is the cooldown cache key, so nothing can be
  // skipped without it. This costs at most 1 quota unit on a handle-only config
  // and 0 when YOUTUBE_CHANNEL_ID is set, which is a good trade for not spending
  // the full fetch below.
  const sourceChannelId = await resolveChannelId(payload.channelId, payload.handle);

  const cached = await getCachedSync(sourceChannelId);
  if (cached) {
    return {
      channelId: sourceChannelId,
      fetched: 0,
      created: 0,
      updated: 0,
      alreadyPresent: 0,
      syncedAt: cached.syncedAt,
      cached: true,
    };
  }

  // Only now do we spend quota. The cooldown check used to sit after this call,
  // which meant it suppressed the database writes but not the API call — so a
  // sync repeated inside the window cost exactly as much quota as the first one
  // and the cooldown protected nothing.
  const cards = await fetchLatestCards(sourceChannelId, payload.maxResults ?? DEFAULT_MAX_RESULTS);

  const syncedAt = new Date();
  let created = 0;
  let updated = 0;

  const existingRows = await prisma.communityVideo.findMany({
    where: { youtubeVideoId: { in: cards.map((c) => c.youtubeVideoId) } },
    select: { id: true, youtubeVideoId: true },
  });
  const existingMap = new Map(existingRows.map((r) => [r.youtubeVideoId, r.id]));

  for (const card of cards) {
    const engagement = {
      viewCount: card.viewCount,
      likeCount: card.likeCount,
      statsSyncedAt: syncedAt,
    };

    const existingId = existingMap.get(card.youtubeVideoId);
    if (existingId) {
      await prisma.communityVideo.update({ where: { id: existingId }, data: engagement });
      updated += 1;
      continue;
    }

    await prisma.communityVideo.create({ data: { ...card, ...engagement } });
    created += 1;
  }

  const summary = {
    channelId: sourceChannelId,
    fetched: cards.length,
    created,
    updated,
    // Kept in the summary for backwards compatibility with the original response
    // shape; `created + updated` is the number of cards the run touched.
    alreadyPresent: updated,
    syncedAt: syncedAt.toISOString(),
    cached: false,
  };

  await setCachedSync(sourceChannelId, summary);

  return summary;
}
