// ─────────────────────────────────────────
// Community Service — Video Feed & Analytics
// ─────────────────────────────────────────
// Manages community video cards, per-user unlock state, interaction logging,
// basic analytics aggregation, and YouTube channel sync for the admin.

import { prisma } from "../config/index.js";
import { VideoInteractionType, type CommunityVideo } from "../../generated/prisma/client.js";
import {
  fetchChannelLatestCards,
  getCachedSync,
  setCachedSync,
  buildFullWatchUrl,
  getChannelLinks,
  type ChannelLinks,
  DEFAULT_PREVIEW_DURATION_SECONDS,
} from "./youtube.service.js";
import { isYouTubeOAuthConfigured, getCachedVerification } from "./youtube-oauth.service.js";

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

// ── List published videos with per-user unlock state ─────────────────────────
// Used by GET /community/videos so the response already includes isUnlocked per
// card. Each card is run through the payload gate, so locked videos expose only
// their clipped preview.

export async function listVideosForUser(userId: string, page: number, limit: number) {
  const skip = (page - 1) * limit;

  const [videos, total, unlocks] = await prisma.$transaction([
    prisma.communityVideo.findMany({
      where: { isPublished: true },
      orderBy: { publishedAt: "desc" },
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
  ]);

  const unlockedMap = new Map(unlocks.map((u) => [u.videoId, u.unlockedAt]));

  const enriched = videos.map((v) =>
    toCardPayload(v, unlockedMap.has(v.id), unlockedMap.get(v.id) ?? null),
  );

  return { videos: enriched, total };
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

export async function getUnlockStatus(userId: string, videoId: string) {
  const record = await prisma.videoUnlock.findUnique({
    where: { userId_videoId: { userId, videoId } },
    select: { unlockedAt: true },
  });

  return {
    isUnlocked: Boolean(record),
    unlockedAt: record?.unlockedAt ?? null,
  };
}

// ── Unlock a video for a user ─────────────────────────────────────────────────
// A full-length video is the reward for subscribing to the channel, so unlocking
// requires a server-confirmed subscription verdict — the client saying "I came
// back from YouTube" is not evidence of anything. Idempotent: an existing unlock
// is returned untouched and never re-checked against the YouTube API.

export type UnlockResult =
  | { success: false; code: "VIDEO_NOT_FOUND" }
  | { success: false; code: "SUBSCRIPTION_REQUIRED"; verifiedAt: string | null }
  | { success: true; isUnlocked: true; unlockedAt: Date };

export async function unlockVideo(userId: string, videoId: string): Promise<UnlockResult> {
  const video = await resolvePublishedVideo(videoId);

  if (!video) {
    return { success: false, code: "VIDEO_NOT_FOUND" as const };
  }

  const existing = await prisma.videoUnlock.findUnique({
    where: { userId_videoId: { userId, videoId: video.id } },
    select: { unlockedAt: true },
  });

  if (existing) {
    return { success: true, isUnlocked: true, unlockedAt: existing.unlockedAt };
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

  return { success: true, isUnlocked: true, unlockedAt: record.unlockedAt };
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

export async function getUserUnlocks(userId: string) {
  const unlocks = await prisma.videoUnlock.findMany({
    where: { userId },
    select: { videoId: true, unlockedAt: true },
    orderBy: { unlockedAt: "desc" },
  });

  return unlocks.map((u) => ({ videoId: u.videoId, unlockedAt: u.unlockedAt }));
}

// ── Admin: get interaction counts for a video ─────────────────────────────────

export async function getVideoAnalytics(videoId: string) {
  const video = await prisma.communityVideo.findUnique({
    where: { id: videoId },
    select: { id: true, title: true, youtubeVideoId: true },
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
}

// Explicit discriminated union so callers can narrow on result.success. Without
// it TS widens both arms to `success: boolean` and `data` stays `| undefined`.
export type CreateVideoResult =
  { success: false; code: "DUPLICATE_VIDEO_ID" } | { success: true; data: CommunityVideo };

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
// any missing videos to the feed. Existing cards are never overwritten, so
// admin edits (title/description) and soft-deletes (isPublished=false) are
// preserved across sync runs.
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
      alreadyPresent: 0,
      syncedAt: cached.syncedAt,
      cached: true,
    };
  }

  let created = 0;
  let alreadyPresent = 0;

  for (const card of cards) {
    const existing = await prisma.communityVideo.findUnique({
      where: { youtubeVideoId: card.youtubeVideoId },
      select: { id: true },
    });

    if (existing) {
      alreadyPresent += 1;
      continue;
    }

    await prisma.communityVideo.create({ data: { ...card } });
    created += 1;
  }

  const summary = {
    channelId: sourceChannelId,
    fetched: cards.length,
    created,
    alreadyPresent,
    syncedAt: new Date().toISOString(),
    cached: false,
  };

  await setCachedSync(sourceChannelId, summary);

  return summary;
}
