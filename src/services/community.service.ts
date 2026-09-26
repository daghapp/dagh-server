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
import {
  fetchChannelLatestCards,
  getCachedSync,
  setCachedSync,
  buildFullWatchUrl,
  getChannelLinks,
  type ChannelLinks,
  DEFAULT_PREVIEW_DURATION_SECONDS,
} from "./youtube.service.js";
import {
  isYouTubeOAuthConfigured,
  getCachedVerification,
  checkChannelSubscription,
  refreshAccessToken,
  getChannelReverifyIntervalMs,
} from "./youtube-oauth.service.js";

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

  return {
    ...base,
    youtubeVideoId: record.youtubeVideoId,
    watchUrl: buildFullWatchUrl(record.youtubeVideoId),
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

// ──────────────────────────────────────────────────────────────────────────
// Channel-level access
// ──────────────────────────────────────────────────────────────────────────
// A YouTube subscription is granted per CHANNEL, not per video, so the record
// that unlocks the feed is channel-scoped. Before this existed the only access
// record was per-video, which meant confirming a subscription unlocked exactly
// the card the user happened to tap — every other video from the same channel
// stayed locked, and the app had to re-run the whole OAuth round-trip for each
// one once the verdict cache lapsed (the gate fails closed on an absent verdict).
//
// The grant is re-confirmed rather than permanent: it is written once on a
// positive server-side verdict, then re-checked on a schedule
// (YOUTUBE_CHANNEL_REVERIFY_INTERVAL_MS, default 24h) so that unsubscribing on
// YouTube revokes it. That is the whole point of storing the OAuth refresh token
// — the grant outlives the ~1h access token it was issued with, and without a
// long-lived credential there is nothing to re-check with.
//
// Per-video VideoUnlock rows are deliberately kept alongside this. They answer a
// question a channel grant cannot — how many people unlocked *this* card, and
// what the SUBSCRIBE_INTENT → UNLOCK conversion funnel looks like. They are not,
// however, an independent grant: they are the same subscription restated per
// card, which is why revoking a channel grant deletes them (see
// revokeChannelAccess).

export interface ChannelAccess {
  channelId: string;
  unlockedAt: Date;
  verifiedAt: Date | null;
}

/**
 * The caller's active channel grant, or null.
 *
 * Revoked grants are invisible here: `revokedAt` is set by reverifyChannelGrants
 * when the sweep sees the subscription cancelled, and a cancelled subscription
 * must close the feed immediately rather than at the next sweep.
 *
 * Queried by userId alone rather than (userId, channelId): resolving a channel
 * id from a bare handle costs a YouTube API call, and the read sits on the feed
 * hot path. Safe today because CommunityVideo carries no channelId — every card
 * belongs to the one configured channel. If multi-channel support lands, add
 * channelId to CommunityVideo and filter on it here, or a grant for one channel
 * would unlock another's videos.
 */
export async function getChannelAccess(userId: string): Promise<ChannelAccess | null> {
  const row = await prisma.channelUnlock.findFirst({
    where: { userId, revokedAt: null },
    select: { channelId: true, unlockedAt: true, verifiedAt: true },
  });

  if (!row) return null;
  return { channelId: row.channelId, unlockedAt: row.unlockedAt, verifiedAt: row.verifiedAt };
}

/**
 * Records a confirmed subscription. Idempotent against a live grant: `unlockedAt`
 * is never rewritten, so re-running the flow does not erase the original audit
 * timestamp.
 *
 * A grant previously revoked by the sweep is revived in place rather than
 * duplicated — the (userId, channelId) unique constraint means this is the same
 * row — so a user who cancels and later resubscribes regains the feed without
 * any second grant, and the stored refresh token is replaced with the one from
 * the fresh round-trip.
 */
export async function grantChannelAccess(
  userId: string,
  input: { channelId: string; verifiedAt?: Date | null; refreshToken?: string | null },
): Promise<ChannelAccess> {
  const row = await prisma.channelUnlock.upsert({
    where: { userId_channelId: { userId, channelId: input.channelId } },
    update: {
      // A live grant is left alone apart from refreshing the credentials the
      // sweep needs; a revoked one is revived.
      ...(input.refreshToken ? { refreshToken: input.refreshToken } : {}),
      lastVerifiedAt: input.verifiedAt ?? new Date(),
      revokedAt: null,
      revokedReason: null,
    },
    create: {
      userId,
      channelId: input.channelId,
      verifiedAt: input.verifiedAt ?? null,
      refreshToken: input.refreshToken ?? null,
      lastVerifiedAt: input.verifiedAt ?? new Date(),
    },
    select: { channelId: true, unlockedAt: true, verifiedAt: true },
  });

  return { channelId: row.channelId, unlockedAt: row.unlockedAt, verifiedAt: row.verifiedAt };
}

// ── Revocation ────────────────────────────────────────────────────────────────
// A grant is no longer permanent: the sweep below re-checks it against the
// subscriptions API and closes it if the user cancelled. Revocation is a soft
// flag rather than a delete so the row remains the audit record of a
// subscription that was once held.

export type RevokeReason = "UNSUBSCRIBED" | "MANUAL";

/**
 * Closes a channel grant. Also removes the per-video unlock rows it implies:
 * those rows are the same reward restated per card, and leaving them behind
 * would let a cancelled subscriber keep watching the individual videos they
 * unlocked — the exact leak this revocation exists to close. The append-only
 * VideoInteraction rows are untouched, so funnel analytics survive.
 *
 * `notVerifiedAfter` guards a race: a grant re-confirmed by an OAuth callback
 * after the sweep started already holds fresher evidence than the sweep's stale
 * negative verdict (YouTube's own propagation lag makes a negative that old
 * unreliable), so such a grant is left alone and the next pass re-decides it.
 * Returns false when nothing was revoked.
 */
export async function revokeChannelAccess(
  userId: string,
  channelId: string,
  reason: RevokeReason = "UNSUBSCRIBED",
  notVerifiedAfter?: Date,
): Promise<boolean> {
  const { count } = await prisma.channelUnlock.updateMany({
    where: {
      userId,
      channelId,
      revokedAt: null,
      ...(notVerifiedAfter ? { lastVerifiedAt: { lte: notVerifiedAfter } } : {}),
    },
    data: { revokedAt: new Date(), revokedReason: reason },
  });

  if (count === 0) return false;

  await prisma.videoUnlock.deleteMany({ where: { userId } });

  return true;
}

// ── Re-verification sweep ─────────────────────────────────────────────────────
// A YouTube subscription is mutable from outside our system, so a grant written
// once cannot stay authoritative forever. This sweep re-confirms each grant and
// revokes the ones whose subscription is gone, which is what makes an unsubscribe
// on YouTube actually cost the user access.
//
// Two deliberate asymmetries:
//
//   - It runs on a schedule, not on the read path. Revoking inside a feed load
//     would put a YouTube round-trip on the hot path, and would make a slow
//     response indistinguishable from a revoked one.
//   - It fails OPEN. Only a definite negative verdict revokes. A thrown error
//     means "could not check" — a Google outage or an expired refresh token must
//     not lock out a paying subscriber, so the grant is left alone and retried
//     on the next pass.
//
// Grants with no stored refresh token are skipped entirely. They predate token
// persistence and cannot be re-checked; revoking them would close access on the
// strength of a credential we simply failed to save, which is our bug and not
// the user's.

const REVERIFY_BATCH_SIZE = 200;

export interface ReverifySummary {
  checked: number;
  stillSubscribed: number;
  revoked: number;
  /**
   * Rows reported a negative verdict but skipped by the race guard because an
   * OAuth callback re-confirmed them after this pass began. The next pass
   * re-decides them.
   */
  superseded: number;
  /** Rows skipped because they carry no refresh token and cannot be re-checked. */
  unverifiable: number;
  /** Rows where the check could not be completed; grant left intact. */
  failed: number;
}

export interface ReverifyOptions {
  now?: Date;
  /**
   * Gate consulted once per due grant, before any API call. Returning false
   * skips the row. The scheduled job passes a distributed claim here so a run
   * that overlaps a previous one — or a second instance — cannot check the same
   * grant twice and spend the quota twice.
   */
  shouldProcess?: (grantId: string) => Promise<boolean>;
}

export async function reverifyChannelGrants(
  options: ReverifyOptions = {},
): Promise<ReverifySummary> {
  const now = options.now ?? new Date();
  const { shouldProcess } = options;

  const summary: ReverifySummary = {
    checked: 0,
    stillSubscribed: 0,
    revoked: 0,
    superseded: 0,
    unverifiable: 0,
    failed: 0,
  };

  if (!isYouTubeOAuthConfigured()) {
    return summary;
  }

  const intervalMs = getChannelReverifyIntervalMs();
  const dueBefore = new Date(now.getTime() - intervalMs);

  const [due, unverifiable] = await Promise.all([
    // Active, re-checkable, and not already confirmed within the interval.
    prisma.channelUnlock.findMany({
      where: {
        revokedAt: null,
        refreshToken: { not: null },
        OR: [{ lastVerifiedAt: null }, { lastVerifiedAt: { lte: dueBefore } }],
      },
      select: { id: true, userId: true, channelId: true, refreshToken: true },
      orderBy: { lastVerifiedAt: { sort: "asc", nulls: "first" } },
      take: REVERIFY_BATCH_SIZE,
    }),
    prisma.channelUnlock.count({
      where: { revokedAt: null, refreshToken: null },
    }),
  ]);

  summary.unverifiable = unverifiable;

  for (const grant of due) {
    if (shouldProcess && !(await shouldProcess(grant.id))) {
      continue;
    }

    summary.checked += 1;

    try {
      const token = await refreshAccessToken(grant.refreshToken!);
      const subscribed = await checkChannelSubscription(token.accessToken, grant.channelId);

      if (!subscribed) {
        // The only path that revokes. Bounded by `now` so a grant re-confirmed
        // by a concurrent OAuth callback is not closed on a stale verdict.
        const revoked = await revokeChannelAccess(
          grant.userId,
          grant.channelId,
          "UNSUBSCRIBED",
          now,
        );
        if (revoked) {
          summary.revoked += 1;
        } else {
          summary.superseded += 1;
        }
        continue;
      }

      await prisma.channelUnlock.update({
        where: { id: grant.id },
        data: {
          lastVerifiedAt: now,
          // Google rotates the refresh token on some refreshes; keep the newest
          // so the next pass does not use a spent credential.
          ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
        },
      });
      summary.stillSubscribed += 1;
    } catch (error) {
      // "Could not check" — not a negative verdict. Leave the grant alone.
      summary.failed += 1;
      console.error(
        `[Channel Reverify] Could not re-verify grant ${grant.id} (user ${grant.userId}); ` +
          `leaving access intact:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return summary;
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
}

// ── List published videos with per-user unlock state ─────────────────────────
// Used by GET /community/videos so the response already includes isUnlocked per
// card. Each card is run through the payload gate, so locked videos expose only
// their clipped preview.
//
// A channel grant unlocks every card at once, so the whole page is gated on one
// boolean and the per-video unlock query is skipped entirely for a subscriber.

export async function listVideosForUser(
  userId: string,
  page: number,
  limit: number,
  options: ListVideosOptions = {},
) {
  const skip = (page - 1) * limit;
  const sort: VideoSort = options.sort ?? DEFAULT_VIDEO_SORT;

  const [videos, total, unlocks, channelAccess] = await prisma.$transaction([
    prisma.communityVideo.findMany({
      where: { isPublished: true },
      orderBy: VIDEO_ORDER_BY[sort],
      skip,
      take: limit,
      select: CARD_SELECT,
    }),
    prisma.communityVideo.count({ where: { isPublished: true } }),
    // Fetch all unlock records for this user in one query — avoids N+1
    prisma.videoUnlock.findMany({
      where: { userId },
      select: { videoId: true, unlockedAt: true },
    }),
    prisma.channelUnlock.findFirst({
      // Mirrors getChannelAccess: a revoked grant is inert, so the feed falls
      // back to per-card state for this user.
      where: { userId, revokedAt: null },
      select: { channelId: true, unlockedAt: true, verifiedAt: true },
    }),
  ]);

  const unlockedMap = new Map(unlocks.map((u) => [u.videoId, u.unlockedAt]));

  const enriched = videos.map((v) =>
    // The subscription covers the whole channel, so every card is unlocked and
    // carries the grant's timestamp — including cards published since.
    channelAccess
      ? toCardPayload(v, true, channelAccess.unlockedAt)
      : toCardPayload(v, unlockedMap.has(v.id), unlockedMap.get(v.id) ?? null),
  );

  return {
    videos: enriched,
    total,
    // Echoed so a client that pages through a sorted feed can confirm the server
    // honoured its `sort` — an unrecognised value silently becomes NEWEST.
    sort,
    // Feed-level flag so the app can hide every "Subscribe to Unlock" call to
    // action at once instead of evaluating the CTA per card.
    hasChannelAccess: Boolean(channelAccess),
    channelAccess: channelAccess
      ? {
          channelId: channelAccess.channelId,
          unlockedAt: channelAccess.unlockedAt,
          verifiedAt: channelAccess.verifiedAt,
        }
      : null,
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

export async function getVideoForUser(userId: string, videoId: string) {
  const video = await getVideoRecord(videoId);
  if (!video) {
    return null;
  }

  const { isUnlocked, unlockedAt } = await getUnlockStatus(userId, video.id);
  return toCardPayload(video, isUnlocked, unlockedAt);
}
// ── Get unlock status for a single video ─────────────────────────────────────

export interface UnlockStatus {
  isUnlocked: boolean;
  unlockedAt: Date | null;
  /** Which record produced the answer — tells the app why a card is open. */
  via: "CHANNEL" | "VIDEO" | null;
  hasChannelAccess: boolean;
}

export async function getUnlockStatus(userId: string, videoId: string): Promise<UnlockStatus> {
  // A channel subscription already covers this video, so the per-video row is
  // never consulted for a subscriber. Checking the channel first also keeps the
  // common case to a single indexed query.
  const channelAccess = await getChannelAccess(userId);

  if (channelAccess) {
    return {
      isUnlocked: true,
      unlockedAt: channelAccess.unlockedAt,
      via: "CHANNEL",
      hasChannelAccess: true,
    };
  }

  const record = await prisma.videoUnlock.findUnique({
    where: { userId_videoId: { userId, videoId } },
    select: { unlockedAt: true },
  });

  return {
    isUnlocked: Boolean(record),
    unlockedAt: record?.unlockedAt ?? null,
    via: record ? "VIDEO" : null,
    hasChannelAccess: false,
  };
}

// ── Unlock a video for a user ─────────────────────────────────────────────────
// A full-length video is the reward for subscribing to the channel, so unlocking
// requires a server-confirmed subscription verdict — the client saying "I came
// back from YouTube" is not evidence of anything. Idempotent: an existing unlock
// is returned untouched and never re-checked against the YouTube API.
//
// Because the subscription is channel-scoped, a successful verification also
// records a channel grant, which unlocks the whole feed from that point on —
// including videos published later. The per-video row is still written, because
// it is what the per-video analytics count.

export type UnlockResult =
  | { success: false; code: "VIDEO_NOT_FOUND" }
  | { success: false; code: "SUBSCRIPTION_REQUIRED"; verifiedAt: string | null }
  | {
      success: true;
      isUnlocked: true;
      unlockedAt: Date;
      /** True when this call also recorded the channel-wide grant. */
      channelGranted: boolean;
    };

export interface UnlockOptions {
  /**
   * Channel the subscription was verified against. Supplied by the OAuth
   * callback, which has already resolved it. Omitted when OAuth is not
   * configured, so the fail-open dev path grants the video without inventing a
   * channel grant.
   */
  channelId?: string | null;
  verifiedAt?: Date | null;
  /**
   * Google's long-lived credential from the same round-trip. Persisted with the
   * grant so the sweep can later detect an unsubscribe; without it the grant is
   * permanent, which is the pre-migration behaviour.
   */
  refreshToken?: string | null;
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

  // Already covered by a channel grant: report unlocked without touching the
  // YouTube API or the database at all.
  const existingChannelAccess = await getChannelAccess(userId);
  if (existingChannelAccess) {
    return {
      success: true,
      isUnlocked: true,
      unlockedAt: existingChannelAccess.unlockedAt,
      channelGranted: true,
    };
  }

  const existing = await prisma.videoUnlock.findUnique({
    where: { userId_videoId: { userId, videoId: video.id } },
    select: { unlockedAt: true },
  });

  if (existing) {
    return {
      success: true,
      isUnlocked: true,
      unlockedAt: existing.unlockedAt,
      channelGranted: false,
    };
  }

  // Gate on a positive, unexpired verification verdict. An absent verdict
  // (never verified, or the cache TTL lapsed) is treated as not subscribed, so
  // the gate fails closed.
  //
  // When the OAuth client is not configured at all there is no way to verify
  // anything, and failing closed would leave every video permanently
  // ununlockable — including on local/dev setups. In that case we fail open and
  // keep the legacy client-trusted behaviour. Configuring YOUTUBE_OAUTH_*
  // closes the gate.
  if (isYouTubeOAuthConfigured()) {
    const verdict = await getCachedVerification(userId);

    if (!verdict?.subscribed) {
      return {
        success: false,
        code: "SUBSCRIPTION_REQUIRED" as const,
        verifiedAt: verdict?.verifiedAt ?? null,
      };
    }
  }

  const record = await prisma.videoUnlock.upsert({
    where: { userId_videoId: { userId, videoId: video.id } },
    update: {}, // raced with a concurrent request — no-op
    create: { userId, videoId: video.id },
    select: { unlockedAt: true },
  });

  // The verified subscription is to the channel, so grant the channel too. This
  // is what stops the next video from needing another OAuth round-trip, and it
  // carries the refresh token the sweep needs to notice a later cancellation.
  let channelGranted = false;
  if (options.channelId) {
    await grantChannelAccess(userId, {
      channelId: options.channelId,
      verifiedAt: options.verifiedAt ?? null,
      refreshToken: options.refreshToken ?? null,
    });
    channelGranted = true;
  }

  return { success: true, isUnlocked: true, unlockedAt: record.unlockedAt, channelGranted };
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

export async function getUserUnlocks(userId: string) {
  const [unlocks, channelAccess] = await Promise.all([
    prisma.videoUnlock.findMany({
      where: { userId },
      select: { videoId: true, unlockedAt: true },
      orderBy: { unlockedAt: "desc" },
    }),
    getChannelAccess(userId),
  ]);

  return {
    hasChannelAccess: Boolean(channelAccess),
    channelAccess: channelAccess
      ? {
          channelId: channelAccess.channelId,
          unlockedAt: channelAccess.unlockedAt,
          verifiedAt: channelAccess.verifiedAt,
        }
      : null,
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
  const { channelId: sourceChannelId, cards } = await fetchChannelLatestCards(
    payload.channelId,
    payload.handle,
    payload.maxResults,
  );

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

  const syncedAt = new Date();
  let created = 0;
  let updated = 0;

  for (const card of cards) {
    const existing = await prisma.communityVideo.findUnique({
      where: { youtubeVideoId: card.youtubeVideoId },
      select: { id: true },
    });

    const engagement = {
      viewCount: card.viewCount,
      likeCount: card.likeCount,
      statsSyncedAt: syncedAt,
    };

    if (existing) {
      // Counters only — everything else on the row is ours to curate.
      await prisma.communityVideo.update({ where: { id: existing.id }, data: engagement });
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
