import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Unit tests for the community video unlock gate.
 *
 * Prisma and the YouTube OAuth service are mocked so the gating decisions can
 * be driven directly, without a database or quota-consuming API calls.
 */

const prismaMock = {
  communityVideo: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  videoUnlock: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  videoInteraction: {
    create: vi.fn(),
    groupBy: vi.fn(),
    aggregate: vi.fn(),
  },
  $transaction: vi.fn(),
};

const oauthMock = {
  isYouTubeOAuthConfigured: vi.fn(),
  getCachedVerification: vi.fn(),
};

vi.mock("../src/config/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../src/config/index.js", () => ({ prisma: prismaMock }));
vi.mock("../src/services/youtube-oauth.service.js", () => oauthMock);

const { toCardPayload, unlockVideo, listVideosForUser } =
  await import("../src/services/community.service.js");

const CARD = {
  id: "card-1",
  title: "My Video",
  description: "desc",
  teaserUrl: "https://www.youtube.com/embed/abc123?start=0&end=45&rel=0",
  previewStartSeconds: 0,
  previewDurationSeconds: 45,
  thumbnailUrl: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
  youtubeVideoId: "abc123",
  publishedAt: new Date("2026-01-01T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
  prismaMock.communityVideo.findFirst.mockResolvedValue({ id: "card-1" });
  prismaMock.videoUnlock.findUnique.mockResolvedValue(null);
  prismaMock.videoUnlock.upsert.mockResolvedValue({ unlockedAt: new Date("2026-02-01T00:00:00Z") });
  vi.stubEnv("YOUTUBE_CHANNEL_ID", "UC123");
  vi.stubEnv("YOUTUBE_CHANNEL_HANDLE", "@diasporaaffairsgh");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const CHANNEL = {
  channelId: "UC123",
  handle: "@diasporaaffairsgh",
  subscribeUrl: "https://www.youtube.com/@diasporaaffairsgh",
  appUrl: "vnd.youtube://channel/UC123",
};

describe("toCardPayload", () => {
  it("withholds the full video link and video id from a locked card", () => {
    const payload = toCardPayload(CARD, false, null);

    expect(payload.youtubeVideoId).toBeUndefined();
    expect(payload.watchUrl).toBeUndefined();
    expect(payload).not.toHaveProperty("youtubeVideoId");
    expect(payload).not.toHaveProperty("watchUrl");
    expect(payload.isUnlocked).toBe(false);
    expect(payload.requiresSubscription).toBe(true);
  });

  it("still gives a locked viewer enough to sample the video", () => {
    const payload = toCardPayload(CARD, false, null);

    expect(payload.thumbnailUrl).toBe(CARD.thumbnailUrl);
    expect(payload.teaserUrl).toBe(CARD.teaserUrl);
    expect(payload.previewStartSeconds).toBe(0);
    expect(payload.previewDurationSeconds).toBe(45);
  });

  it("returns the full video link once unlocked", () => {
    const unlockedAt = new Date("2026-02-01T00:00:00Z");
    const payload = toCardPayload(CARD, true, unlockedAt);

    expect(payload.youtubeVideoId).toBe("abc123");
    expect(payload.watchUrl).toBe("https://www.youtube.com/embed/abc123");
    expect(payload.isUnlocked).toBe(true);
    expect(payload.requiresSubscription).toBe(false);
    expect(payload.unlockedAt).toBe(unlockedAt);
  });
});

describe("card channel links", () => {
  it("gives a locked card somewhere to send the user to subscribe", () => {
    const payload = toCardPayload(CARD, false, null);

    expect(payload.channel).toEqual(CHANNEL);
  });

  it("gives an unlocked card the same channel links", () => {
    expect(toCardPayload(CARD, true, new Date()).channel).toEqual(CHANNEL);
  });

  it("degrades to nulls rather than omitting the field when no channel is configured", () => {
    vi.stubEnv("YOUTUBE_CHANNEL_ID", "");
    vi.stubEnv("YOUTUBE_CHANNEL_HANDLE", "");

    expect(toCardPayload(CARD, false, null).channel).toEqual({
      channelId: null,
      handle: null,
      subscribeUrl: null,
      appUrl: null,
    });
  });
});

describe("listVideosForUser", () => {
  it("gates each card individually based on that user's unlocks", async () => {
    const second = { ...CARD, id: "card-2", youtubeVideoId: "def456" };
    prismaMock.communityVideo.findMany.mockResolvedValue([CARD, second]);
    prismaMock.communityVideo.count.mockResolvedValue(2);
    prismaMock.videoUnlock.findMany.mockResolvedValue([
      { videoId: "card-2", unlockedAt: new Date() },
    ]);

    const { videos, total } = await listVideosForUser("user-1", 1, 20);

    expect(total).toBe(2);
    expect(videos[0].isUnlocked).toBe(false);
    expect(videos[0]).not.toHaveProperty("youtubeVideoId");
    expect(videos[0].channel).toEqual(CHANNEL);
    expect(videos[1].isUnlocked).toBe(true);
    expect(videos[1].youtubeVideoId).toBe("def456");
  });
});

describe("unlockVideo", () => {
  it("returns VIDEO_NOT_FOUND for an unpublished or unknown video", async () => {
    prismaMock.communityVideo.findFirst.mockResolvedValue(null);

    await expect(unlockVideo("user-1", "nope")).resolves.toEqual({
      success: false,
      code: "VIDEO_NOT_FOUND",
    });
    expect(prismaMock.videoUnlock.upsert).not.toHaveBeenCalled();
  });

  describe("with OAuth configured (gate closed)", () => {
    beforeEach(() => {
      oauthMock.isYouTubeOAuthConfigured.mockReturnValue(true);
    });

    it("refuses to unlock without a positive verdict", async () => {
      oauthMock.getCachedVerification.mockResolvedValue(null);

      const result = await unlockVideo("user-1", "abc123");

      expect(result).toEqual({
        success: false,
        code: "SUBSCRIPTION_REQUIRED",
        verifiedAt: null,
      });
      expect(prismaMock.videoUnlock.upsert).not.toHaveBeenCalled();
    });

    it("refuses to unlock on a negative verdict and surfaces the check time", async () => {
      oauthMock.getCachedVerification.mockResolvedValue({
        subscribed: false,
        verifiedAt: "2026-02-01T00:00:00.000Z",
      });

      const result = await unlockVideo("user-1", "abc123");

      expect(result).toEqual({
        success: false,
        code: "SUBSCRIPTION_REQUIRED",
        verifiedAt: "2026-02-01T00:00:00.000Z",
      });
      expect(prismaMock.videoUnlock.upsert).not.toHaveBeenCalled();
    });

    it("unlocks on a positive verdict", async () => {
      oauthMock.getCachedVerification.mockResolvedValue({
        subscribed: true,
        verifiedAt: "2026-02-01T00:00:00.000Z",
      });

      const result = await unlockVideo("user-1", "abc123");

      expect(result.success).toBe(true);
      expect(prismaMock.videoUnlock.upsert).toHaveBeenCalledOnce();
    });

    it("resolves the canonical card id so a raw YouTube id cannot orphan the row", async () => {
      oauthMock.getCachedVerification.mockResolvedValue({
        subscribed: true,
        verifiedAt: "2026-02-01T00:00:00.000Z",
      });

      await unlockVideo("user-1", "abc123");

      expect(prismaMock.videoUnlock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { userId: "user-1", videoId: "card-1" },
        }),
      );
    });

    it("does not re-check an existing unlock, so it never expires with the cache", async () => {
      const unlockedAt = new Date("2026-01-15T00:00:00Z");
      prismaMock.videoUnlock.findUnique.mockResolvedValue({ unlockedAt });

      const result = await unlockVideo("user-1", "abc123");

      expect(result).toEqual({ success: true, isUnlocked: true, unlockedAt });
      expect(oauthMock.getCachedVerification).not.toHaveBeenCalled();
      expect(prismaMock.videoUnlock.upsert).not.toHaveBeenCalled();
    });
  });

  describe("without OAuth configured (fail open)", () => {
    beforeEach(() => {
      oauthMock.isYouTubeOAuthConfigured.mockReturnValue(false);
    });

    it("preserves the legacy behaviour so videos are not permanently locked", async () => {
      const result = await unlockVideo("user-1", "abc123");

      expect(result.success).toBe(true);
      expect(oauthMock.getCachedVerification).not.toHaveBeenCalled();
      expect(prismaMock.videoUnlock.upsert).toHaveBeenCalledOnce();
    });
  });
});
