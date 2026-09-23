import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  isYouTubeConfigured,
  getYouTubeChannelId,
  getYouTubeChannelHandle,
  cardFromPlaylistItem,
  resolveChannelId,
  fetchLatestCards,
  fetchChannelLatestCards,
  YouTubeNotConfiguredError,
} from "../src/services/youtube.service.js";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function channelItem(id: string, uploads: string) {
  return { id, contentDetails: { relatedPlaylists: { uploads } } };
}

function playlistItem(videoId: string, title = "Video", publishedAt = "2026-01-01T00:00:00Z") {
  return {
    snippet: { title, description: "desc", publishedAt, resourceId: { videoId } },
  };
}

// Deterministic baseline: src/config/redis.ts loads the real .env via
// `import "dotenv/config"`, which leaks locally-configured YOUTUBE_* values
// into the test process. Clear them before every test so assertions that expect
// "unset" hold regardless of the developer's .env.
beforeEach(() => {
  vi.stubEnv("YOUTUBE_API_KEY", "");
  vi.stubEnv("YOUTUBE_CHANNEL_ID", "");
  vi.stubEnv("YOUTUBE_CHANNEL_HANDLE", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("isYouTubeConfigured", () => {
  it("returns false when YOUTUBE_API_KEY is unset", () => {
    expect(isYouTubeConfigured()).toBe(false);
  });

  it("returns true when YOUTUBE_API_KEY is set", () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    expect(isYouTubeConfigured()).toBe(true);
  });

  it("returns false for whitespace-only keys", () => {
    vi.stubEnv("YOUTUBE_API_KEY", "   ");
    expect(isYouTubeConfigured()).toBe(false);
  });
});

describe("channel env getters", () => {
  it("returns trimmed channel id or null", () => {
    expect(getYouTubeChannelId()).toBeNull();
    vi.stubEnv("YOUTUBE_CHANNEL_ID", "  UC123  ");
    expect(getYouTubeChannelId()).toBe("UC123");
  });

  it("returns trimmed channel handle or null", () => {
    expect(getYouTubeChannelHandle()).toBeNull();
    vi.stubEnv("YOUTUBE_CHANNEL_HANDLE", " @diasporaaffairsgh ");
    expect(getYouTubeChannelHandle()).toBe("@diasporaaffairsgh");
  });
});

describe("cardFromPlaylistItem", () => {
  it("derives all card fields from the snippet", () => {
    const card = cardFromPlaylistItem(playlistItem("abc123", "My Video"));
    expect(card).toEqual({
      youtubeVideoId: "abc123",
      title: "My Video",
      description: "desc",
      teaserUrl: "https://www.youtube.com/embed/abc123",
      thumbnailUrl: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
      publishedAt: new Date("2026-01-01T00:00:00Z"),
    });
  });

  it("returns null when the resource videoId is missing", () => {
    expect(cardFromPlaylistItem({ snippet: { title: "No id" } })).toBeNull();
  });

  it("falls back to a default title when missing", () => {
    const card = cardFromPlaylistItem({ snippet: { resourceId: { videoId: "x" } } });
    expect(card?.title).toBe("Untitled");
    expect(card?.description).toBe("");
  });
});

describe("resolveChannelId", () => {
  it("returns an explicit channelId without hitting the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveChannelId("UC-explicit")).resolves.toBe("UC-explicit");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to YOUTUBE_CHANNEL_ID from the environment", async () => {
    vi.stubEnv("YOUTUBE_CHANNEL_ID", "UC-env");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveChannelId()).resolves.toBe("UC-env");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves a @handle to a channel id via the API", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [channelItem("UC123", "UU789")] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveChannelId(undefined, "@diasporaaffairsgh")).resolves.toBe("UC123");

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/youtube/v3/channels");
    expect(url.searchParams.get("forHandle")).toBe("@diasporaaffairsgh");
  });

  it("throws YouTubeNotConfiguredError when nothing is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveChannelId()).rejects.toBeInstanceOf(YouTubeNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchChannelLatestCards", () => {
  it("resolves the channel and maps its latest uploads to cards", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [channelItem("UC123", "UU789")] }))
      .mockResolvedValueOnce(jsonResponse({ items: [channelItem("UC123", "UU789")] }))
      .mockResolvedValueOnce(
        jsonResponse({ items: [playlistItem("abc", "First"), playlistItem("def", "Second")] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { channelId, cards } = await fetchChannelLatestCards(undefined, "UC123", 6);

    expect(channelId).toBe("UC123");
    expect(cards.map((c) => c.youtubeVideoId)).toEqual(["abc", "def"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("forHandle=UC123"))).toBe(true);
    expect(calls.some((u) => u.includes("maxResults=6"))).toBe(true);
  });

  it("honors an explicit channelId and skips handle resolution", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [channelItem("UC999", "UU999")] }))
      .mockResolvedValueOnce(
        jsonResponse({ items: [playlistItem("abc", "First"), playlistItem("def", "Second")] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { channelId, cards } = await fetchChannelLatestCards("UC999", undefined, 2);

    expect(channelId).toBe("UC999");
    expect(cards).toHaveLength(2);
    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("forHandle="))).toBe(false);
    expect(calls.some((u) => u.includes("id=UC999"))).toBe(true);
  });

  it("drops empty items from the uploads response", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [channelItem("UC123", "UU789")] }))
      .mockResolvedValueOnce(jsonResponse({ items: [channelItem("UC123", "UU789")] }))
      .mockResolvedValueOnce(
        jsonResponse({ items: [playlistItem("abc"), { snippet: { title: "no id" } }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { cards } = await fetchChannelLatestCards(undefined, "UC123", 6);
    expect(cards).toHaveLength(1);
  });
});

describe("fetchLatestCards", () => {
  it("throws YouTubeApiError with the upstream status on a failed response", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [channelItem("UC123", "UU789")] }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "quota exceeded" } }, 403));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchLatestCards("UC123", 6)).rejects.toMatchObject({
      status: 403,
      message: "quota exceeded",
    });
  });

  it("clamps maxResults to YouTube's 50-item ceiling", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [channelItem("UC123", "UU789")] }))
      .mockResolvedValueOnce(jsonResponse({ items: [playlistItem("abc")] }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchLatestCards("UC123", 5000);

    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("maxResults=50"))).toBe(true);
  });
});
