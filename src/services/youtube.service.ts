// ─────────────────────────────────────────
// YouTube Data API — Community Channel Sync
// ─────────────────────────────────────────
// Minimal client for the YouTube Data API v3 used by the admin channel-sync
// endpoint. Resolves a channel (by ID or @handle), pulls its latest uploads,
// and derives community video card fields from each upload.
//
// Quota notes: the `channels` lookup costs 1 point and `playlistItems` costs
// 1 point per item, so we use the uploads playlist instead of the `search`
// endpoint (100 points per call) to keep sync cheap and reliable.

import { getRedisClient } from "../config/redis.js";
import type { RedisClientType } from "redis";
import { envNumber } from "../helpers/env-number.js";

const API_BASE = "https://www.googleapis.com/youtube/v3";
export const DEFAULT_MAX_RESULTS = 6;
const REQUEST_TIMEOUT_MS = 10_000;

export class YouTubeNotConfiguredError extends Error {}

export class YouTubeApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "YouTubeApiError";
    this.status = status;
  }
}

export interface YouTubeStatistics {
  viewCount: number;
  likeCount: number;
}

export interface YouTubeCard extends YouTubeStatistics {
  youtubeVideoId: string;
  title: string;
  description: string;
  teaserUrl: string; // CLIPPED preview embed URL — never the full-length video
  previewStartSeconds: number;
  previewDurationSeconds: number;
  thumbnailUrl: string;
  publishedAt: Date;
}

// Default preview window handed to locked viewers: the first 30s of the upload.
// Long enough to read the premise, short enough that the end-of-preview CTA lands
// while the user is still leaning in. Per-card overrides win over this.
export const DEFAULT_PREVIEW_START_SECONDS = 0;
export const DEFAULT_PREVIEW_DURATION_SECONDS = 30;

// YouTube's embed player honours `start`/`end` query params, which is the only
// way to serve a bounded preview from the Data API without hosting our own clip
// files. `rel=0` drops the "more videos" sidebar so the preview cannot be used
// to hop to other uploads.
export function buildPreviewEmbedUrl(
  videoId: string,
  startSeconds: number = DEFAULT_PREVIEW_START_SECONDS,
  durationSeconds: number = DEFAULT_PREVIEW_DURATION_SECONDS,
): string {
  const start = Math.max(0, Math.floor(startSeconds));
  const end = start + Math.max(1, Math.floor(durationSeconds));
  return `https://www.youtube.com/embed/${videoId}?start=${start}&end=${end}&rel=0`;
}

// The full-length watch URL. Derived on demand and only returned to callers who
// already hold an unlock — never persisted, so it cannot leak from a feed read.
export function buildFullWatchUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}`;
}

// ── Full-video watch links ────────────────────────────────────────────────────
// Where the end-of-preview "Watch Full Video on YouTube" call-to-action should
// send an unlocked viewer.
//
// Built here for the same reason `getChannelLinks` exists below: the app should
// never assemble a YouTube URL itself. It used to be told to concatenate
// `vnd.youtube://<youtubeVideoId>` from the id it was handed, which duplicates
// scheme knowledge into the client and puts a second hand-rolled link next to
// one the server already resolves. Both forms are returned so the fallback is
// the caller's to pick — prefer `appUrl`, and use `webUrl` when the native app
// is not installed.

export interface WatchLinks {
  /** `vnd.youtube://` deep link, opening the native app on the full video. */
  appUrl: string;
  /** Mobile-web fallback, for a device with no YouTube app installed. */
  webUrl: string;
}

export function buildWatchLinks(videoId: string): WatchLinks {
  return {
    // `watch?v=` is the scheme's canonical form. The bare-id shorthand
    // (`vnd.youtube://<id>`) is not part of the documented scheme, so it is
    // avoided here.
    appUrl: `vnd.youtube://watch?v=${videoId}`,
    webUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

export function isYouTubeConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY?.trim());
}

export function getYouTubeChannelId(): string | null {
  const id = process.env.YOUTUBE_CHANNEL_ID?.trim();
  return id || null;
}

export function getYouTubeChannelHandle(): string | null {
  const handle = process.env.YOUTUBE_CHANNEL_HANDLE?.trim();
  return handle || null;
}

// ── Channel links ─────────────────────────────────────────────────────────────
// Where the "Subscribe to Unlock" call-to-action should send the user. Resolved
// from env so the app never has to hardcode the channel — otherwise changing
// YOUTUBE_CHANNEL_* leaves the client pointing at the old channel while the
// server verifies against the new one, and the user is told they are not
// subscribed after subscribing.
//
// Pure env reads, no API call: the feed is a hot path and a handle→id lookup
// costs a quota unit. A handle-only configuration therefore reports
// `appUrl: null` rather than paying for a resolution on every feed load; the
// OAuth callback resolves the id on its own, once per consent.

export interface ChannelLinks {
  /** Stable `UC…` id, when configured. */
  channelId: string | null;
  /** `@handle` with the leading `@` normalised in, when configured. */
  handle: string | null;
  /**
   * Web URL that lands on the channel page. The user still has to tap Subscribe
   * there — YouTube offers no link that completes a subscription directly, so
   * treat this as "get them to the channel", not "subscribe them".
   */
  subscribeUrl: string | null;
  /**
   * `vnd.youtube://` deep link for the native app. The scheme has no handle
   * form, so this is null when only a handle is configured — fall back to
   * `subscribeUrl`.
   */
  appUrl: string | null;
}

export function getChannelLinks(): ChannelLinks {
  const channelId = getYouTubeChannelId();
  const rawHandle = getYouTubeChannelHandle();
  const handle = rawHandle ? (rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`) : null;

  // Prefer the handle for the web URL: it is human-readable and survives the
  // channel being recreated under a different UC… id.
  const subscribeUrl = handle
    ? `https://www.youtube.com/${handle}`
    : channelId
      ? `https://www.youtube.com/channel/${channelId}`
      : null;

  return {
    channelId,
    handle,
    subscribeUrl,
    appUrl: channelId ? `vnd.youtube://channel/${channelId}` : null,
  };
}

async function apiRequest(path: string, params: Record<string, string>): Promise<unknown> {
  if (!isYouTubeConfigured()) {
    throw new YouTubeNotConfiguredError("YOUTUBE_API_KEY is not configured");
  }

  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set("key", process.env.YOUTUBE_API_KEY as string);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    const body: unknown = await res.json().catch(() => null);

    if (!res.ok) {
      const message =
        (body as { error?: { message?: string } })?.error?.message ??
        `YouTube API responded with ${res.status}`;
      throw new YouTubeApiError(message, res.status);
    }

    return body;
  } finally {
    clearTimeout(timer);
  }
}

// ── Channel resolution ──────────────────────────────────────────────────────
// Priority: explicit param > YOUTUBE_CHANNEL_ID > YOUTUBE_CHANNEL_HANDLE / @handle.

export async function resolveChannelId(channelId?: string, handle?: string): Promise<string> {
  const explicitId = channelId?.trim();
  if (explicitId) return explicitId;

  const envId = getYouTubeChannelId();
  if (envId) return envId;

  const lookup = handle?.trim() || getYouTubeChannelHandle();
  if (!lookup) {
    throw new YouTubeNotConfiguredError(
      "No channel configured — set YOUTUBE_CHANNEL_ID / YOUTUBE_CHANNEL_HANDLE or pass channelId/handle",
    );
  }

  const data = await apiRequest("/channels", { part: "contentDetails", forHandle: lookup });
  const item = (data as { items?: Array<Record<string, unknown>> })?.items?.[0] ?? {};
  const uploads = ((item.contentDetails ?? {}) as { relatedPlaylists?: { uploads?: string } })
    .relatedPlaylists?.uploads;

  if (typeof item.id !== "string" || !uploads) {
    throw new YouTubeApiError(`Channel not found for "${lookup}"`, 404);
  }

  return item.id;
}

export async function fetchUploadsPlaylistId(channelId: string): Promise<string> {
  const data = await apiRequest("/channels", { part: "contentDetails", id: channelId });
  const item = (data as { items?: Array<Record<string, unknown>> })?.items?.[0] ?? {};
  const uploads = ((item.contentDetails ?? {}) as { relatedPlaylists?: { uploads?: string } })
    .relatedPlaylists?.uploads;

  if (!uploads) {
    throw new YouTubeApiError(`No uploads playlist found for channel "${channelId}"`, 404);
  }

  return uploads;
}

// ── Mapping ──────────────────────────────────────────────────────────────────

/**
 * YouTube returns counters as strings, and omits the whole `statistics` object
 * for private/age-restricted/removed videos. Anything unparseable or negative
 * becomes 0 so a malformed value can never reach an ORDER BY or the client.
 */
function toCount(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function cardFromPlaylistItem(
  item: Record<string, unknown>,
  statistics?: YouTubeStatistics,
): YouTubeCard | null {
  const snippet = (item?.snippet ?? {}) as Record<string, unknown>;
  const resourceId = (snippet.resourceId ?? {}) as Record<string, unknown>;
  const videoId = resourceId.videoId;

  if (typeof videoId !== "string" || !videoId) return null;

  const title =
    typeof snippet.title === "string" && snippet.title.trim() ? snippet.title.trim() : "Untitled";
  const description = typeof snippet.description === "string" ? snippet.description.trim() : "";

  return {
    youtubeVideoId: videoId,
    title,
    description,
    teaserUrl: buildPreviewEmbedUrl(videoId),
    previewStartSeconds: DEFAULT_PREVIEW_START_SECONDS,
    previewDurationSeconds: DEFAULT_PREVIEW_DURATION_SECONDS,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    publishedAt:
      typeof snippet.publishedAt === "string" ? new Date(snippet.publishedAt) : new Date(),
    viewCount: statistics?.viewCount ?? 0,
    likeCount: statistics?.likeCount ?? 0,
  };
}

// ── Public engagement counters ───────────────────────────────────────────────
// `playlistItems.list` cannot return them: its parts are contentDetails, id,
// snippet and status, so viewCount/likeCount are only readable from `videos`.
// That costs one extra request, but the whole batch rides in a single call —
// `videos.list` accepts up to 50 comma-separated ids for 1 quota point, so the
// marginal cost is 1 point per sync regardless of how many uploads we pull.
//
// The feed needs these to rank "most watched" / "most liked", and the only
// other signal available in-process (VideoInteraction) sees just our own app's
// activity, not the channel's audience.

const STATISTICS_BATCH_SIZE = 50;

export async function fetchVideoStatistics(
  videoIds: string[],
): Promise<Map<string, YouTubeStatistics>> {
  const unique = [...new Set(videoIds.filter((id) => typeof id === "string" && id))];
  const stats = new Map<string, YouTubeStatistics>();

  if (unique.length === 0) return stats;

  for (let i = 0; i < unique.length; i += STATISTICS_BATCH_SIZE) {
    const batch = unique.slice(i, i + STATISTICS_BATCH_SIZE);
    const data = await apiRequest("/videos", { part: "statistics", id: batch.join(",") });
    const items = (data as { items?: Array<Record<string, unknown>> })?.items ?? [];

    for (const item of items) {
      const id = item?.id;
      if (typeof id !== "string") continue;
      const statistics = (item.statistics ?? {}) as Record<string, unknown>;
      stats.set(id, {
        viewCount: toCount(statistics.viewCount),
        likeCount: toCount(statistics.likeCount),
      });
    }
  }

  return stats;
}

export async function fetchLatestCards(
  channelId: string,
  maxResults: number = DEFAULT_MAX_RESULTS,
): Promise<YouTubeCard[]> {
  const playlistId = await fetchUploadsPlaylistId(channelId);
  const count = String(Math.min(50, Math.max(1, Math.floor(maxResults))));

  const data = await apiRequest("/playlistItems", {
    part: "snippet",
    playlistId,
    maxResults: count,
  });

  const items = (data as { items?: Array<Record<string, unknown>> })?.items ?? [];
  const cards = items
    .map((item) => cardFromPlaylistItem(item))
    .filter((card: YouTubeCard | null): card is YouTubeCard => card !== null);

  // Fails soft on purpose. A statistics error (quota, transient 5xx) must not
  // cost us the upload list we already paid for: new videos still get added,
  // they just rank as 0 until the next sync picks the counters up. The card's
  // statsSyncedAt stays null, which is how the app tells "nobody has watched
  // this" apart from "we have never checked".
  let stats = new Map<string, YouTubeStatistics>();
  try {
    stats = await fetchVideoStatistics(cards.map((card) => card.youtubeVideoId));
  } catch (error) {
    console.error(
      "[YouTube Sync] Could not read view/like counts; syncing cards without them:",
      error instanceof Error ? error.message : String(error),
    );
  }

  return cards.map((card) => ({
    ...card,
    ...(stats.get(card.youtubeVideoId) ?? { viewCount: 0, likeCount: 0 }),
  }));
}

/**
 * Resolve + fetch in one call.
 *
 * Callers that consult the sync cooldown must NOT use this: the cooldown key is
 * the channel id, so the check can only happen after `resolveChannelId` and
 * before the uploads fetch — and this function does both in one step, which
 * forces the quota to be spent first. `syncVideosFromChannel` therefore drives
 * the two primitives directly.
 */
export async function fetchChannelLatestCards(
  channelId?: string,
  handle?: string,
  maxResults?: number,
): Promise<{ channelId: string; cards: YouTubeCard[] }> {
  const resolvedChannelId = await resolveChannelId(channelId, handle);
  const cards = await fetchLatestCards(resolvedChannelId, maxResults ?? DEFAULT_MAX_RESULTS);
  return { channelId: resolvedChannelId, cards };
}

// ── Redis-backed cooldown cache ─────────────────────────────────────────────

const SYNC_CACHE_PREFIX = "yt:sync:";

export function syncCacheKey(channelId: string): string {
  return `${SYNC_CACHE_PREFIX}${channelId}`;
}

/**
 * Returns the cached sync timestamp, or null when there is nothing usable.
 *
 * Redis-only by design — there is no in-memory fallback, so a deployment without
 * REDIS_URL has no cooldown at all and every admin click reaches YouTube. That is
 * acceptable for a single-instance dev box but must not be true in production.
 *
 * An unparseable value is deleted rather than left in place: this key gates the
 * quota-spending fetch, so a poisoned entry would otherwise suppress every sync
 * for the rest of its TTL.
 */
export async function getCachedSync(channelId: string): Promise<{ syncedAt: string } | null> {
  const redis = getRedisClient() as RedisClientType | null;
  if (!redis) return null;

  const key = syncCacheKey(channelId);
  const raw = await redis.get(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { syncedAt?: string };
    if (parsed.syncedAt) return { syncedAt: parsed.syncedAt };
  } catch {
    // fall through to the delete below
  }

  await redis.del(key);
  return null;
}

export async function setCachedSync(channelId: string, summary: unknown): Promise<void> {
  const redis = getRedisClient() as RedisClientType | null;
  if (!redis) return;

  const cooldownMs = envNumber("YOUTUBE_SYNC_COOLDOWN_MS", 60 * 60 * 1000, 1);
  await redis.set(syncCacheKey(channelId), JSON.stringify(summary), { PX: cooldownMs });
}
