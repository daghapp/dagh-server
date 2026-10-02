import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Unit tests for the admin channel sync's engagement-counter handling.
 *
 * The YouTube client is mocked wholesale (it is exercised in youtube.test.ts) so
 * these tests can pin down what the sync writes: a card that already exists must
 * have its counters refreshed — that is the only thing that lets a video which
 * has since gone viral climb the "most watched" / "most liked" feeds — while
 * every admin-curated field on the row stays untouched.
 */

const prismaMock = {
  communityVideo: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
};

const youtubeMock = {
  resolveChannelId: vi.fn(async () => "UC123"),
  fetchLatestCards: vi.fn(),
  getCachedSync: vi.fn(),
  setCachedSync: vi.fn(),
  buildFullWatchUrl: (id: string) => `https://www.youtube.com/embed/${id}`,
  getChannelLinks: () => ({
    channelId: "UC123",
    handle: "@diasporaaffairsgh",
    subscribeUrl: "https://www.youtube.com/@diasporaaffairsgh",
    appUrl: "vnd.youtube://channel/UC123",
  }),
  DEFAULT_MAX_RESULTS: 6,
  DEFAULT_PREVIEW_DURATION_SECONDS: 45,
};

vi.mock("../src/config/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../src/config/index.js", () => ({ prisma: prismaMock }));
vi.mock("../src/services/youtube.service.js", () => youtubeMock);

const { syncVideosFromChannel } = await import("../src/services/community.service.js");

function card(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    youtubeVideoId: "abc123",
    title: "My Video",
    description: "desc",
    teaserUrl: "https://www.youtube.com/embed/abc123?start=0&end=45&rel=0",
    previewStartSeconds: 0,
    previewDurationSeconds: 45,
    thumbnailUrl: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
    publishedAt: new Date("2026-01-01T00:00:00Z"),
    viewCount: 1200,
    likeCount: 85,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.communityVideo.findUnique.mockResolvedValue(null);
  prismaMock.communityVideo.create.mockResolvedValue({});
  prismaMock.communityVideo.update.mockResolvedValue({});
  youtubeMock.getCachedSync.mockResolvedValue(null);
  youtubeMock.setCachedSync.mockResolvedValue(undefined);
  youtubeMock.resolveChannelId.mockResolvedValue("UC123");
  youtubeMock.fetchLatestCards.mockResolvedValue([card()]);
});

describe("syncVideosFromChannel", () => {
  it("stores the counters and the sync time on a newly created card", async () => {
    const summary = await syncVideosFromChannel({});

    expect(summary.created).toBe(1);
    expect(summary.updated).toBe(0);

    const data = prismaMock.communityVideo.create.mock.calls[0][0].data;
    expect(data.viewCount).toBe(1200);
    expect(data.likeCount).toBe(85);
    expect(data.statsSyncedAt).toBeInstanceOf(Date);
  });

  it("refreshes the counters on a card that already exists", async () => {
    prismaMock.communityVideo.findUnique.mockResolvedValue({ id: "card-1" });

    const summary = await syncVideosFromChannel({});

    expect(summary.updated).toBe(1);
    expect(summary.created).toBe(0);
    // Backwards-compatible alias: older clients read this field.
    expect(summary.alreadyPresent).toBe(1);

    const data = prismaMock.communityVideo.update.mock.calls[0][0].data;
    expect(data.viewCount).toBe(1200);
    expect(data.likeCount).toBe(85);
    expect(data.statsSyncedAt).toBeInstanceOf(Date);
    expect(prismaMock.communityVideo.create).not.toHaveBeenCalled();
  });

  it("writes only the counters to an existing row, never the curated fields", async () => {
    prismaMock.communityVideo.findUnique.mockResolvedValue({ id: "card-1" });

    await syncVideosFromChannel({});

    // A sync that also rewrote the title/description would silently revert every
    // admin edit, and re-publishing a card the admin had unpublished.
    const args = prismaMock.communityVideo.update.mock.calls[0][0];
    expect(Object.keys(args.data).sort()).toEqual(["likeCount", "statsSyncedAt", "viewCount"]);
    expect(args.where).toEqual({ id: "card-1" });
  });

  it("counts a run that mixes new and existing uploads", async () => {
    prismaMock.communityVideo.findUnique
      .mockResolvedValueOnce({ id: "card-1" })
      .mockResolvedValueOnce(null);
    youtubeMock.fetchLatestCards.mockResolvedValue([card(), card({ youtubeVideoId: "def456" })]);

    const summary = await syncVideosFromChannel({});

    expect(summary.fetched).toBe(2);
    expect(summary.created).toBe(1);
    expect(summary.updated).toBe(1);
  });

  it("checks the cooldown before it spends any quota", async () => {
    // Regression: the cooldown used to be consulted *after* the uploads fetch, so
    // it suppressed the database writes but not the ~22-point API call. A sync
    // repeated inside the window then cost exactly as much quota as the first
    // one, and the cooldown protected nothing.
    const order: string[] = [];
    youtubeMock.getCachedSync.mockImplementation(async () => {
      order.push("cooldown");
      return { syncedAt: "2026-02-01T00:00:00.000Z" };
    });
    youtubeMock.fetchLatestCards.mockImplementation(async () => {
      order.push("fetch");
      return [card()];
    });

    const summary = await syncVideosFromChannel({});

    expect(summary.cached).toBe(true);
    expect(order).toEqual(["cooldown"]);
    expect(youtubeMock.fetchLatestCards).not.toHaveBeenCalled();
  });

  it("forwards the requested page size to the uploads fetch", async () => {
    await syncVideosFromChannel({ maxResults: 20 });

    expect(youtubeMock.fetchLatestCards).toHaveBeenCalledWith("UC123", 20);
  });

  it("serves the cooldown cache without touching the database", async () => {
    youtubeMock.getCachedSync.mockResolvedValue({ syncedAt: "2026-02-01T00:00:00.000Z" });

    const summary = await syncVideosFromChannel({});

    expect(summary).toMatchObject({ cached: true, created: 0, updated: 0, alreadyPresent: 0 });
    expect(prismaMock.communityVideo.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.communityVideo.update).not.toHaveBeenCalled();
  });
});

describe("adminCreateVideo", () => {
  it("clamps a negative or non-numeric seeded count to 0", async () => {
    const { adminCreateVideo } = await import("../src/services/community.service.js");
    prismaMock.communityVideo.findUnique.mockResolvedValue(null);
    prismaMock.communityVideo.create.mockResolvedValue({ id: "card-1" });

    await adminCreateVideo({
      title: "t",
      description: "d",
      teaserUrl: "https://www.youtube.com/embed/abc123?start=0&end=45&rel=0",
      thumbnailUrl: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
      youtubeVideoId: "abc123",
      viewCount: -50,
      likeCount: Number.NaN,
    });

    const data = prismaMock.communityVideo.create.mock.calls[0][0].data;
    expect(data.viewCount).toBe(0);
    expect(data.likeCount).toBe(0);
  });

  it("leaves statsSyncedAt null when no counts were seeded", async () => {
    const { adminCreateVideo } = await import("../src/services/community.service.js");
    prismaMock.communityVideo.findUnique.mockResolvedValue(null);
    prismaMock.communityVideo.create.mockResolvedValue({ id: "card-1" });

    await adminCreateVideo({
      title: "t",
      description: "d",
      teaserUrl: "https://www.youtube.com/embed/abc123?start=0&end=45&rel=0",
      thumbnailUrl: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
      youtubeVideoId: "abc123",
    });

    // Nothing has confirmed these numbers with YouTube, so the card must not
    // claim a sync that never happened.
    expect(prismaMock.communityVideo.create.mock.calls[0][0].data).not.toHaveProperty(
      "statsSyncedAt",
    );
  });
});
