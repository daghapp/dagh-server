import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  isYouTubeConfigured,
  getYouTubeChannelId,
  getYouTubeChannelHandle,
  getChannelLinks,
  cardFromPlaylistItem,
  fetchVideoStatistics,
  buildPreviewEmbedUrl,
  buildFullWatchUrl,
  buildWatchLinks,
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

/** A `videos?part=statistics` response item — counters arrive as strings. */
function videoItem(id: string, viewCount: unknown, likeCount: unknown) {
  return { id, statistics: { viewCount, likeCount } };
}

/** The single `videos` statistics batch for a set of ids. */
function statisticsResponse(entries: Array<[string, unknown, unknown]>) {
  return jsonResponse({ items: entries.map(([id, v, l]) => videoItem(id, v, l)) });
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

describe("getChannelLinks", () => {
  it("returns all nulls when no channel is configured", () => {
    expect(getChannelLinks()).toEqual({
      channelId: null,
      handle: null,
      subscribeUrl: null,
      appUrl: null,
    });
  });

  it("builds both links from the channel id alone", () => {
    vi.stubEnv("YOUTUBE_CHANNEL_ID", "UC123");

    expect(getChannelLinks()).toEqual({
      channelId: "UC123",
      handle: null,
      subscribeUrl: "https://www.youtube.com/channel/UC123",
      appUrl: "vnd.youtube://channel/UC123",
    });
  });

  it("prefers the handle for the web URL but keeps the id deep link", () => {
    vi.stubEnv("YOUTUBE_CHANNEL_ID", "UC123");
    vi.stubEnv("YOUTUBE_CHANNEL_HANDLE", "@diasporaaffairsgh");

    expect(getChannelLinks()).toEqual({
      channelId: "UC123",
      handle: "@diasporaaffairsgh",
      subscribeUrl: "https://www.youtube.com/@diasporaaffairsgh",
      appUrl: "vnd.youtube://channel/UC123",
    });
  });

  it("normalises a handle written without the leading @", () => {
    vi.stubEnv("YOUTUBE_CHANNEL_HANDLE", "diasporaaffairsgh");

    expect(getChannelLinks().handle).toBe("@diasporaaffairsgh");
    expect(getChannelLinks().subscribeUrl).toBe("https://www.youtube.com/@diasporaaffairsgh");
  });

  it("omits the app deep link for a handle-only config, since the scheme has no handle form", () => {
    vi.stubEnv("YOUTUBE_CHANNEL_HANDLE", "@diasporaaffairsgh");

    const links = getChannelLinks();
    expect(links.channelId).toBeNull();
    expect(links.appUrl).toBeNull();
    expect(links.subscribeUrl).toBe("https://www.youtube.com/@diasporaaffairsgh");
  });
});

describe("buildWatchLinks", () => {
  it("builds an app deep link and a web fallback for the full video", () => {
    expect(buildWatchLinks("dQw4w9WgXcQ")).toEqual({
      appUrl: "vnd.youtube://watch?v=dQw4w9WgXcQ",
      webUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
  });

  it("uses the scheme's canonical watch?v= form rather than the bare-id shorthand", () => {
    // The bare `vnd.youtube://<id>` form is not part of the documented scheme,
    // so the server must not hand the app a link built from it.
    expect(buildWatchLinks("abc123").appUrl).toBe("vnd.youtube://watch?v=abc123");
  });

  it("keeps the two links pointing at the same video", () => {
    const links = buildWatchLinks("abc123");
    expect(links.appUrl).toContain(links.webUrl.split("?v=")[1]);
  });
});

describe("cardFromPlaylistItem", () => {
  it("derives all card fields from the snippet", () => {
    const card = cardFromPlaylistItem(playlistItem("abc123", "My Video"));
    expect(card).toEqual({
      youtubeVideoId: "abc123",
      title: "My Video",
      description: "desc",
      teaserUrl: "https://www.youtube.com/embed/abc123?start=0&end=30&rel=0",
      previewStartSeconds: 0,
      previewDurationSeconds: 30,
      thumbnailUrl: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
      publishedAt: new Date("2026-01-01T00:00:00Z"),
      viewCount: 0,
      likeCount: 0,
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

  it("merges the separately-fetched counters when they are supplied", () => {
    const card = cardFromPlaylistItem(playlistItem("abc123"), {
      viewCount: 4321,
      likeCount: 210,
    });
    expect(card?.viewCount).toBe(4321);
    expect(card?.likeCount).toBe(210);
  });
});

describe("fetchVideoStatistics", () => {
  it("parses the string counters YouTube returns", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValueOnce(
      statisticsResponse([
        ["abc", "1234", "56"],
        ["def", "7", "0"],
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const stats = await fetchVideoStatistics(["abc", "def"]);

    expect(stats.get("abc")).toEqual({ viewCount: 1234, likeCount: 56 });
    expect(stats.get("def")).toEqual({ viewCount: 7, likeCount: 0 });
  });

  it("batches every id into one request so the whole sync costs a single point", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValueOnce(statisticsResponse([["abc", "1", "1"]]));
    vi.stubGlobal("fetch", fetchMock);

    await fetchVideoStatistics(["abc", "def", "ghi"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/youtube/v3/videos");
    expect(url.searchParams.get("part")).toBe("statistics");
    expect(url.searchParams.get("id")).toBe("abc,def,ghi");
  });

  it("coerces missing, unparseable and negative counters to 0", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    // YouTube omits `statistics` entirely for private or removed videos, and
    // nothing downstream may treat that as a real count.
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        items: [
          { id: "gone" },
          videoItem("nan", "not-a-number", "-4"),
          videoItem("nulled", null, undefined),
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const stats = await fetchVideoStatistics(["gone", "nan", "nulled"]);

    expect(stats.get("gone")).toEqual({ viewCount: 0, likeCount: 0 });
    expect(stats.get("nan")).toEqual({ viewCount: 0, likeCount: 0 });
    expect(stats.get("nulled")).toEqual({ viewCount: 0, likeCount: 0 });
  });

  it("de-duplicates ids and makes no call when given none", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValueOnce(statisticsResponse([["abc", "1", "1"]]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchVideoStatistics([])).resolves.toEqual(new Map());
    await fetchVideoStatistics(["abc", "abc", ""]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("id")).toBe("abc");
  });
});

describe("buildPreviewEmbedUrl", () => {
  it("bounds the embed to the requested window", () => {
    expect(buildPreviewEmbedUrl("abc123", 30, 60)).toBe(
      "https://www.youtube.com/embed/abc123?start=30&end=90&rel=0",
    );
  });

  it("defaults to the first 30 seconds", () => {
    expect(buildPreviewEmbedUrl("abc123")).toBe(
      "https://www.youtube.com/embed/abc123?start=0&end=30&rel=0",
    );
  });

  it("clamps negative or fractional bounds instead of emitting invalid params", () => {
    expect(buildPreviewEmbedUrl("abc123", -10, 0)).toBe(
      "https://www.youtube.com/embed/abc123?start=0&end=1&rel=0",
    );
    expect(buildPreviewEmbedUrl("abc123", 10.9, 20.4)).toBe(
      "https://www.youtube.com/embed/abc123?start=10&end=30&rel=0",
    );
  });
});

describe("buildFullWatchUrl", () => {
  it("returns the unbounded embed URL", () => {
    expect(buildFullWatchUrl("abc123")).toBe("https://www.youtube.com/embed/abc123");
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
      )
      .mockResolvedValueOnce(
        statisticsResponse([
          ["abc", "900", "45"],
          ["def", "120", "3"],
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { channelId, cards } = await fetchChannelLatestCards(undefined, "UC123", 6);

    expect(channelId).toBe("UC123");
    expect(cards.map((c) => c.youtubeVideoId)).toEqual(["abc", "def"]);
    // channels lookup + uploads playlist + playlistItems + one statistics batch
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("forHandle=UC123"))).toBe(true);
    expect(calls.some((u) => u.includes("maxResults=6"))).toBe(true);
  });

  it("attaches each card's YouTube counters, matched by video id", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [channelItem("UC123", "UU789")] }))
      .mockResolvedValueOnce(
        jsonResponse({ items: [playlistItem("abc", "First"), playlistItem("def", "Second")] }),
      )
      // Deliberately out of order: the mapping must key on id, not array position.
      .mockResolvedValueOnce(
        statisticsResponse([
          ["def", "120", "3"],
          ["abc", "900", "45"],
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { cards } = await fetchChannelLatestCards("UC123");

    expect(cards[0]).toMatchObject({ youtubeVideoId: "abc", viewCount: 900, likeCount: 45 });
    expect(cards[1]).toMatchObject({ youtubeVideoId: "def", viewCount: 120, likeCount: 3 });
  });

  it("still syncs the uploads when the statistics call fails", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [channelItem("UC123", "UU789")] }))
      .mockResolvedValueOnce(jsonResponse({ items: [playlistItem("abc"), playlistItem("def")] }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "quota exceeded" } }, 403));
    vi.stubGlobal("fetch", fetchMock);

    const { cards } = await fetchChannelLatestCards("UC123");

    // Losing the ranking signal must not cost us the upload list we already paid for.
    expect(cards.map((c) => c.youtubeVideoId)).toEqual(["abc", "def"]);
    expect(cards.every((c) => c.viewCount === 0 && c.likeCount === 0)).toBe(true);
    expect(consoleError).toHaveBeenCalled();
  });

  it("honors an explicit channelId and skips handle resolution", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [channelItem("UC999", "UU999")] }))
      .mockResolvedValueOnce(
        jsonResponse({ items: [playlistItem("abc", "First"), playlistItem("def", "Second")] }),
      )
      .mockResolvedValueOnce(statisticsResponse([["abc", "1", "1"]]));
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
      )
      .mockResolvedValueOnce(statisticsResponse([["abc", "1", "1"]]));
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
      .mockResolvedValueOnce(jsonResponse({ items: [playlistItem("abc")] }))
      .mockResolvedValueOnce(statisticsResponse([["abc", "1", "1"]]));
    vi.stubGlobal("fetch", fetchMock);

    await fetchLatestCards("UC123", 5000);

    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("maxResults=50"))).toBe(true);
  });

  it("skips the statistics request entirely when the channel has no uploads", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [channelItem("UC123", "UU789")] }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchLatestCards("UC123", 6)).resolves.toEqual([]);
    // An empty id list would only burn quota on a call that cannot return anything.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
