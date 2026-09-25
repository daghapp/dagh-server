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

const API_BASE = "https://www.googleapis.com/youtube/v3";
const DEFAULT_MAX_RESULTS = 6;
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

export interface YouTubeCard {
  youtubeVideoId: string;
  title: string;
  description: string;
  teaserUrl: string; // CLIPPED preview embed URL — never the full-length video
  previewStartSeconds: number;
  previewDurationSeconds: number;
  thumbnailUrl: string;
  publishedAt: Date;
}

// Default preview window handed to locked viewers: the first 45s of the upload.
export const DEFAULT_PREVIEW_START_SECONDS = 0;
export const DEFAULT_PREVIEW_DURATION_SECONDS = 45;

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

export function cardFromPlaylistItem(item: Record<string, unknown>): YouTubeCard | null {
  const snippet = (item?.snippet ?? {}) as Record<string, unknown>;
  const resourceId = (snippet.resourceId ?? {}) as Record<string, unknown>;
  const videoId = resourceId.videoId;

  if (typeof videoId !== "string" || !videoId) return null;

  const title =
    typeof snippet.title === "string" && snippet.title.trim() ? snippet.title.trim() : "Untitled";
  const description = typeof snippet.description === "string" ? snippet.description.trim() : "";
  const publishedAt =
    typeof snippet.publishedAt === "string" ? new Date(snippet.publishedAt) : new Date();

  return {
    youtubeVideoId: videoId,
    title,
    description,
    teaserUrl: buildPreviewEmbedUrl(videoId),
    previewStartSeconds: DEFAULT_PREVIEW_START_SECONDS,
    previewDurationSeconds: DEFAULT_PREVIEW_DURATION_SECONDS,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    publishedAt,
  };
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
  return items
    .map((item) => cardFromPlaylistItem(item))
    .filter((card: YouTubeCard | null): card is YouTubeCard => card !== null);
}

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

export async function getCachedSync(channelId: string): Promise<{ syncedAt: string } | null> {
  const redis = getRedisClient() as RedisClientType | null;
  if (!redis) return null;

  const raw = await redis.get(syncCacheKey(channelId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { syncedAt?: string };
    return parsed.syncedAt ? { syncedAt: parsed.syncedAt } : null;
  } catch {
    return null;
  }
}

export async function setCachedSync(channelId: string, summary: unknown): Promise<void> {
  const redis = getRedisClient() as RedisClientType | null;
  if (!redis) return;

  const cooldownMs = Number(process.env.YOUTUBE_SYNC_COOLDOWN_MS || 60 * 60 * 1000);
  await redis.set(syncCacheKey(channelId), JSON.stringify(summary), { PX: cooldownMs });
}
