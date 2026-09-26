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
  channelUnlock: {
    findFirst: vi.fn(),
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

const { toCardPayload, unlockVideo, listVideosForUser, getUnlockStatus, getUserUnlocks } =
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

/** A durable channel grant: one confirmed subscription to the channel. */
const CHANNEL_GRANT = {
  channelId: "UC123",
  unlockedAt: new Date("2026-02-01T00:00:00Z"),
  verifiedAt: new Date("2026-02-01T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
  prismaMock.communityVideo.findFirst.mockResolvedValue({ id: "card-1" });
  prismaMock.videoUnlock.findUnique.mockResolvedValue(null);
  prismaMock.videoUnlock.upsert.mockResolvedValue({ unlockedAt: new Date("2026-02-01T00:00:00Z") });
  // Default: no channel grant, so each test opts in explicitly.
  prismaMock.channelUnlock.findFirst.mockResolvedValue(null);
  prismaMock.channelUnlock.upsert.mockResolvedValue(CHANNEL_GRANT);
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

    const { videos, total, hasChannelAccess } = await listVideosForUser("user-1", 1, 20);

    expect(total).toBe(2);
    expect(hasChannelAccess).toBe(false);
    expect(videos[0].isUnlocked).toBe(false);
    expect(videos[0]).not.toHaveProperty("youtubeVideoId");
    expect(videos[0].channel).toEqual(CHANNEL);
    expect(videos[1].isUnlocked).toBe(true);
    expect(videos[1].youtubeVideoId).toBe("def456");
  });

  it("unlocks every card and reports the grant once, from the channel row", async () => {
    // The channel grant is the single source of truth here: no per-video row
    // exists for either card, which is exactly the state a subscriber is in
    // after unlocking video one and then browsing forward.
    prismaMock.communityVideo.findMany.mockResolvedValue([CARD, { ...CARD, id: "card-2" }]);
    prismaMock.communityVideo.count.mockResolvedValue(2);
    prismaMock.videoUnlock.findMany.mockResolvedValue([]);
    prismaMock.channelUnlock.findFirst.mockResolvedValue(CHANNEL_GRANT);

    const { videos, hasChannelAccess, channelAccess } = await listVideosForUser("user-1", 1, 20);

    expect(hasChannelAccess).toBe(true);
    expect(channelAccess?.channelId).toBe("UC123");
    expect(videos.every((v) => v.isUnlocked)).toBe(true);
    expect(videos.every((v) => v.requiresSubscription === false)).toBe(true);
    // No per-video row was needed to unlock them.
    expect(prismaMock.videoUnlock.upsert).not.toHaveBeenCalled();
  });
});

describe("getUnlockStatus", () => {
  it("reports CHANNEL for a subscriber so the client can hide subscribe CTAs", async () => {
    prismaMock.channelUnlock.findFirst.mockResolvedValue(CHANNEL_GRANT);

    await expect(getUnlockStatus("user-1", "card-1")).resolves.toEqual({
      isUnlocked: true,
      unlockedAt: CHANNEL_GRANT.unlockedAt,
      via: "CHANNEL",
      hasChannelAccess: true,
    });
  });

  it("falls back to VIDEO for a legacy per-video unlock", async () => {
    const unlockedAt = new Date("2026-01-15T00:00:00Z");
    prismaMock.videoUnlock.findUnique.mockResolvedValue({ unlockedAt });

    await expect(getUnlockStatus("user-1", "card-1")).resolves.toEqual({
      isUnlocked: true,
      unlockedAt,
      via: "VIDEO",
      hasChannelAccess: false,
    });
  });

  it("reports a locked card without touching the per-video table when a grant exists", async () => {
    prismaMock.channelUnlock.findFirst.mockResolvedValue(null);
    prismaMock.videoUnlock.findUnique.mockResolvedValue(null);

    await expect(getUnlockStatus("user-1", "card-1")).resolves.toEqual({
      isUnlocked: false,
      unlockedAt: null,
      via: null,
      hasChannelAccess: false,
    });
  });
});

describe("getUserUnlocks", () => {
  it("returns the channel grant alongside the per-video rows", async () => {
    // Reported as a flag, not expanded into one row per video: the app needs to
    // know "you have everything" and the channel keeps publishing.
    prismaMock.channelUnlock.findFirst.mockResolvedValue(CHANNEL_GRANT);
    prismaMock.videoUnlock.findMany.mockResolvedValue([
      { videoId: "card-1", unlockedAt: new Date("2026-02-01T00:00:00Z") },
    ]);

    const result = await getUserUnlocks("user-1");

    expect(result.hasChannelAccess).toBe(true);
    expect(result.channelAccess).toEqual({
      channelId: "UC123",
      unlockedAt: CHANNEL_GRANT.unlockedAt,
      verifiedAt: CHANNEL_GRANT.verifiedAt,
    });
    expect(result.unlocks).toEqual([
      { videoId: "card-1", unlockedAt: new Date("2026-02-01T00:00:00Z") },
    ]);
  });

  it("reports no grant for a non-subscriber", async () => {
    prismaMock.videoUnlock.findMany.mockResolvedValue([]);

    const result = await getUserUnlocks("user-1");

    expect(result.hasChannelAccess).toBe(false);
    expect(result.channelAccess).toBeNull();
    expect(result.unlocks).toEqual([]);
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

      expect(result).toEqual({
        success: true,
        isUnlocked: true,
        unlockedAt,
        channelGranted: false,
      });
      expect(oauthMock.getCachedVerification).not.toHaveBeenCalled();
      expect(prismaMock.videoUnlock.upsert).not.toHaveBeenCalled();
    });

    it("grants the channel so later videos need no further verification", async () => {
      // A YouTube subscription is to the channel, so one confirmation must cover
      // the whole feed — including videos published after the grant.
      oauthMock.getCachedVerification.mockResolvedValue({
        subscribed: true,
        verifiedAt: "2026-02-01T00:00:00.000Z",
      });
      const verifiedAt = new Date("2026-02-01T00:00:00Z");

      const result = await unlockVideo("user-1", "abc123", { channelId: "UC123", verifiedAt });

      expect(prismaMock.channelUnlock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: {
            userId: "user-1",
            channelId: "UC123",
            verifiedAt,
            refreshToken: null,
            lastVerifiedAt: verifiedAt,
          },
        }),
      );
      expect(result).toEqual(expect.objectContaining({ success: true, channelGranted: true }));
    });

    it("persists the refresh token so the grant can be re-verified later", async () => {
      // Without a stored refresh token the sweep cannot re-check the
      // subscription, so the grant would stay permanent — the exact behaviour
      // this token exists to end.
      oauthMock.getCachedVerification.mockResolvedValue({
        subscribed: true,
        verifiedAt: "2026-02-01T00:00:00.000Z",
      });
      const verifiedAt = new Date("2026-02-01T00:00:00Z");

      await unlockVideo("user-1", "abc123", {
        channelId: "UC123",
        verifiedAt,
        refreshToken: "refresh-abc",
      });

      expect(prismaMock.channelUnlock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ refreshToken: "refresh-abc" }),
        }),
      );
    });

    it("does not write a channel grant when no channel id is supplied", async () => {
      oauthMock.getCachedVerification.mockResolvedValue({
        subscribed: true,
        verifiedAt: "2026-02-01T00:00:00.000Z",
      });

      const result = await unlockVideo("user-1", "abc123");

      expect(prismaMock.channelUnlock.upsert).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ channelGranted: false }));
    });

    it("short-circuits on an existing channel grant without re-checking YouTube", async () => {
      prismaMock.channelUnlock.findFirst.mockResolvedValue(CHANNEL_GRANT);

      const result = await unlockVideo("user-1", "abc123");

      expect(result).toEqual({
        success: true,
        isUnlocked: true,
        unlockedAt: CHANNEL_GRANT.unlockedAt,
        channelGranted: true,
      });
      // Re-reading a grant that is never re-checked would be wasted quota.
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
