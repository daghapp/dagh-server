import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ChannelAccessSnapshot } from "../src/services/channel-access.service.js";

/**
 * Unit tests for the community video gate.
 *
 * The access decision is mocked rather than produced here: checkChannelAccess,
 * the lease, the single-flight guard and the revocation rules all live in
 * channel-access.service.ts and are tested there. What is tested here is the part
 * this file owns — how one decision is turned into the shapes the endpoints
 * return — and the properties that used to be violated:
 *
 *   - a page of cards is gated by one boolean, so no card can disagree with
 *     another on the same response;
 *   - per-video rows are analytics and never open anything;
 *   - unlocking never grants, it only observes.
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

const accessMock = {
  readChannelAccess: vi.fn(),
  checkChannelAccess: vi.fn(),
  resolveTargetChannelId: vi.fn(async () => "UC123"),
};

vi.mock("../src/config/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../src/config/index.js", () => ({ prisma: prismaMock }));
vi.mock("../src/services/channel-access.service.js", () => accessMock);

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
  viewCount: 1200,
  likeCount: 85,
};

const VERIFIED_AT = "2026-02-01T00:00:00.000Z";

/** A live lease. Every card on the page opens, and none of them is special. */
const SUBSCRIBED: ChannelAccessSnapshot = {
  channelId: "UC123",
  status: "SUBSCRIBED",
  hasChannelAccess: true,
  verifiedAt: VERIFIED_AT,
  accessExpiresAt: "2026-02-01T00:01:00.000Z",
  accessVersion: 7,
  requiresGoogleConnection: false,
  reason: null,
};

const NOT_CONNECTED: ChannelAccessSnapshot = {
  channelId: "UC123",
  status: "NOT_CONNECTED",
  hasChannelAccess: false,
  verifiedAt: null,
  accessExpiresAt: null,
  accessVersion: 0,
  requiresGoogleConnection: true,
  reason: "GOOGLE_NOT_CONNECTED",
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
  prismaMock.communityVideo.findFirst.mockResolvedValue({ id: "card-1" });
  prismaMock.videoUnlock.upsert.mockResolvedValue({ unlockedAt: new Date(VERIFIED_AT) });
  prismaMock.videoUnlock.findMany.mockResolvedValue([]);
  // Default: no access. Each test opts in explicitly.
  accessMock.readChannelAccess.mockResolvedValue({ access: NOT_CONNECTED, checked: false });
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

    expect(payload.isUnlocked).toBe(false);
    expect(payload.requiresSubscription).toBe(true);
    // Every string that reconstructs the full video stays off a locked card —
    // the deep link is just another one of them, and any of them would let the
    // app skip the server entirely.
    expect(payload).not.toHaveProperty("youtubeVideoId");
    expect(payload).not.toHaveProperty("watchUrl");
    expect(payload).not.toHaveProperty("watchAppUrl");
    expect(payload).not.toHaveProperty("watchWebUrl");
  });

  it("still gives a locked viewer enough to sample the video", () => {
    const payload = toCardPayload(CARD, false, null);

    expect(payload.thumbnailUrl).toBe(CARD.thumbnailUrl);
    expect(payload.teaserUrl).toBe(CARD.teaserUrl);
    expect(payload.previewStartSeconds).toBe(0);
    expect(payload.previewDurationSeconds).toBe(45);
  });

  it("returns the full video link once unlocked", () => {
    const payload = toCardPayload(CARD, true, new Date(VERIFIED_AT));

    expect(payload.youtubeVideoId).toBe("abc123");
    expect(payload.watchUrl).toBe("https://www.youtube.com/embed/abc123");
    expect(payload.isUnlocked).toBe(true);
    expect(payload.requiresSubscription).toBe(false);
  });

  it("resolves the end-of-preview call-to-action deep link server-side once unlocked", () => {
    const payload = toCardPayload(CARD, true, new Date(VERIFIED_AT));

    // Both forms, so the app falls back to the web when YouTube is not installed
    // rather than having to know the scheme itself.
    expect(payload.watchAppUrl).toBe("vnd.youtube://watch?v=abc123");
    expect(payload.watchWebUrl).toBe("https://www.youtube.com/watch?v=abc123");
  });
});

describe("card channel links", () => {
  it("gives a locked card somewhere to send the user to subscribe", () => {
    expect(toCardPayload(CARD, false, null).channel).toEqual(CHANNEL);
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

describe("card engagement counters", () => {
  it("exposes the YouTube counts on a locked card — they reveal nothing about the video", () => {
    const payload = toCardPayload(CARD, false, null);

    expect(payload.viewCount).toBe(1200);
    expect(payload.likeCount).toBe(85);
  });

  it("exposes the same counts once unlocked", () => {
    const payload = toCardPayload(CARD, true, new Date());

    expect(payload.viewCount).toBe(1200);
    expect(payload.likeCount).toBe(85);
  });
});

describe("listVideosForUser", () => {
  it("gates the whole page on one decision, including cards published since", async () => {
    // The channel subscription is channel-scoped, so there is no per-card state
    // left to compute. This is the whole reason two cards on one response cannot
    // disagree: there is only one answer and it was resolved before the page.
    prismaMock.communityVideo.findMany.mockResolvedValue([CARD, { ...CARD, id: "card-2" }]);
    prismaMock.communityVideo.count.mockResolvedValue(2);

    const { videos, total, hasChannelAccess, access } = await listVideosForUser("user-1", 1, 20, {
      channelAccess: SUBSCRIBED,
    });

    expect(total).toBe(2);
    expect(hasChannelAccess).toBe(true);
    expect(access).toBe(SUBSCRIBED);
    expect(videos.every((v) => v.isUnlocked)).toBe(true);
    expect(videos.every((v) => v.requiresSubscription === false)).toBe(true);
    // The card's unlock time is the moment the subscription was confirmed — a
    // card has no unlock moment of its own.
    expect(videos.every((v) => v.unlockedAt?.toISOString() === VERIFIED_AT)).toBe(true);
  });

  it("never opens a page on per-video rows alone", async () => {
    // A leftover VideoUnlock must not resurrect a revoked channel. This is the
    // regression that per-video authorization permitted.
    prismaMock.communityVideo.findMany.mockResolvedValue([CARD]);
    prismaMock.communityVideo.count.mockResolvedValue(1);
    prismaMock.videoUnlock.findUnique.mockResolvedValue({ unlockedAt: new Date() });

    const { videos, hasChannelAccess } = await listVideosForUser("user-1", 1, 20, {
      channelAccess: NOT_CONNECTED,
    });

    expect(hasChannelAccess).toBe(false);
    expect(videos[0].isUnlocked).toBe(false);
    expect(videos[0]).not.toHaveProperty("youtubeVideoId");
  });

  it("does not query the per-video table at all when building a page", async () => {
    prismaMock.communityVideo.findMany.mockResolvedValue([CARD]);
    prismaMock.communityVideo.count.mockResolvedValue(1);

    await listVideosForUser("user-1", 1, 20, { channelAccess: SUBSCRIBED });

    // Nothing reads those rows for gating, so nothing is paid for them either.
    expect(prismaMock.videoUnlock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.videoUnlock.findUnique).not.toHaveBeenCalled();
  });

  it("fails closed when no decision was supplied", async () => {
    // Internal callers that never went through the read gate get a locked feed.
    // Visible in testing; unreachable in production, where every route resolves
    // access first. The alternative — a fallback lookup — is a second path that
    // could answer differently from the first.
    prismaMock.communityVideo.findMany.mockResolvedValue([CARD]);
    prismaMock.communityVideo.count.mockResolvedValue(1);

    const { videos, hasChannelAccess, access } = await listVideosForUser("user-1", 1, 20);

    expect(hasChannelAccess).toBe(false);
    expect(access).toBeNull();
    expect(videos[0].isUnlocked).toBe(false);
  });
});

describe("listVideosForUser ordering", () => {
  // The Prisma call is issued inside $transaction, so the query object is
  // whatever findMany received. Asserting on orderBy keeps these tests about the
  // contract the feed promises rather than about Postgres' use of the indexes.
  function findManyCall() {
    return prismaMock.communityVideo.findMany.mock.calls.at(-1)?.[0] as {
      orderBy: unknown;
      skip: number;
      take: number;
    };
  }

  beforeEach(() => {
    prismaMock.communityVideo.findMany.mockResolvedValue([CARD]);
    prismaMock.communityVideo.count.mockResolvedValue(1);
  });

  it("defaults to newest-first, the pre-existing feed order", async () => {
    const { sort } = await listVideosForUser("user-1", 1, 20, { channelAccess: NOT_CONNECTED });

    expect(sort).toBe("NEWEST");
    expect(findManyCall().orderBy).toEqual([{ publishedAt: "desc" }, { id: "desc" }]);
  });

  it("ranks by view count for MOST_WATCHED", async () => {
    const { sort } = await listVideosForUser("user-1", 1, 20, {
      sort: "MOST_WATCHED",
      channelAccess: NOT_CONNECTED,
    });

    expect(sort).toBe("MOST_WATCHED");
    expect(findManyCall().orderBy).toEqual([
      { viewCount: "desc" },
      { publishedAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("ranks by like count for MOST_LIKED", async () => {
    const { sort } = await listVideosForUser("user-1", 1, 20, {
      sort: "MOST_LIKED",
      channelAccess: NOT_CONNECTED,
    });

    expect(sort).toBe("MOST_LIKED");
    expect(findManyCall().orderBy).toEqual([
      { likeCount: "desc" },
      { publishedAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("breaks ties deterministically so paging a sorted feed cannot drop a card", async () => {
    await listVideosForUser("user-1", 2, 20, {
      sort: "MOST_LIKED",
      channelAccess: NOT_CONNECTED,
    });

    // Two cards on the same like count would otherwise be free to swap places
    // between requests, showing up on both pages or neither.
    const orderBy = findManyCall().orderBy as Record<string, unknown>[];
    expect(orderBy.at(-1)).toEqual({ id: "desc" });
  });

  it("keeps the same page window when the order changes", async () => {
    await listVideosForUser("user-1", 3, 10, {
      sort: "MOST_WATCHED",
      channelAccess: NOT_CONNECTED,
    });

    expect(findManyCall().skip).toBe(20);
    expect(findManyCall().take).toBe(10);
  });

  it("never widens the filter — a sort must not surface unpublished cards", async () => {
    await listVideosForUser("user-1", 1, 20, {
      sort: "MOST_LIKED",
      channelAccess: NOT_CONNECTED,
    });

    const args = prismaMock.communityVideo.findMany.mock.calls.at(-1)?.[0] as {
      where: unknown;
    };
    expect(args.where).toEqual({ isPublished: true });
  });
});

describe("getUnlockStatus", () => {
  it("reports CHANNEL for a subscriber so the client can hide subscribe CTAs", async () => {
    await expect(
      getUnlockStatus("user-1", "card-1", { channelAccess: SUBSCRIBED }),
    ).resolves.toEqual({
      isUnlocked: true,
      unlockedAt: VERIFIED_AT,
      via: "CHANNEL",
      hasChannelAccess: true,
      access: SUBSCRIBED,
    });
  });

  it("never reports VIDEO, however complete the per-video history looks", async () => {
    // There is no longer a per-video unlock to report. Keeping the value would
    // suggest the app may reason about individual videos, which is the path that
    // let a revoked channel stay open.
    prismaMock.videoUnlock.findUnique.mockResolvedValue({ unlockedAt: new Date() });

    const status = await getUnlockStatus("user-1", "card-1", { channelAccess: NOT_CONNECTED });

    expect(status.isUnlocked).toBe(false);
    expect(status.via).toBeNull();
  });

  it("carries the decision so the caller can return one snapshot", async () => {
    const status = await getUnlockStatus("user-1", "card-1", { channelAccess: NOT_CONNECTED });

    // Returning the snapshot is what lets the endpoint answer with one object
    // rather than a status the client has to reconcile against something else.
    expect(status.access).toBe(NOT_CONNECTED);
    expect(status.access?.reason).toBe("GOOGLE_NOT_CONNECTED");
    expect(status.access?.requiresGoogleConnection).toBe(true);
  });
});

describe("getUserUnlocks", () => {
  it("returns the full decision alongside the per-video rows", async () => {
    prismaMock.videoUnlock.findMany.mockResolvedValue([
      { videoId: "card-1", unlockedAt: new Date(VERIFIED_AT) },
    ]);

    const result = await getUserUnlocks("user-1", { channelAccess: SUBSCRIBED });

    expect(result.hasChannelAccess).toBe(true);
    // The snapshot, not a trimmed copy: a client ordering responses by
    // accessVersion needs the version, and it was not in the old three-field shape.
    expect(result.access).toBe(SUBSCRIBED);
    expect(result.access?.accessVersion).toBe(7);
  });

  it("reports the analytics rows without letting them imply access", async () => {
    prismaMock.videoUnlock.findMany.mockResolvedValue([
      { videoId: "card-1", unlockedAt: new Date(VERIFIED_AT) },
    ]);

    const result = await getUserUnlocks("user-1", { channelAccess: NOT_CONNECTED });

    expect(result.hasChannelAccess).toBe(false);
    expect(result.unlocks).toHaveLength(1);
  });

  it("reports no access and no rows for a non-subscriber", async () => {
    const result = await getUserUnlocks("user-1", { channelAccess: null });

    expect(result.hasChannelAccess).toBe(false);
    expect(result.access).toBeNull();
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

  it("refuses without access, and writes nothing", async () => {
    // The route exists so a client can confirm and observe a decision. It is not
    // a way to obtain one: a tap carries no evidence, and returning success here
    // would make it the fail-open door the OAuth callback is not.
    const result = await unlockVideo("user-1", "abc123", { channelAccess: NOT_CONNECTED });

    expect(result).toMatchObject({
      success: false,
      code: "SUBSCRIPTION_REQUIRED",
      reason: "GOOGLE_NOT_CONNECTED",
    });
    expect(prismaMock.videoUnlock.upsert).not.toHaveBeenCalled();
  });

  it("resolves access itself when the caller did not, as a playback read", async () => {
    accessMock.readChannelAccess.mockResolvedValue({ access: NOT_CONNECTED, checked: true });

    await unlockVideo("user-1", "abc123");

    // PLAYBACK, not EXPLICIT: this is the request that supplies the full-length
    // fields, so a lapsed lease has to be refreshed here — but a live one is
    // reused, which keeps a normal tap free.
    expect(accessMock.readChannelAccess).toHaveBeenCalledWith("user-1", {
      reason: "PLAYBACK",
    });
  });

  it("never re-resolves when the caller already supplied the decision", async () => {
    await unlockVideo("user-1", "abc123", { channelAccess: SUBSCRIBED });

    expect(accessMock.readChannelAccess).not.toHaveBeenCalled();
  });

  it("reports unlocked and attributes the conversion to the card", async () => {
    const result = await unlockVideo("user-1", "abc123", { channelAccess: SUBSCRIBED });

    expect(result).toEqual({
      success: true,
      isUnlocked: true,
      unlockedAt: VERIFIED_AT,
      access: SUBSCRIBED,
    });
    expect(prismaMock.videoUnlock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { userId: "user-1", videoId: "card-1" } }),
    );
  });

  it("resolves the canonical card id so a raw YouTube id cannot orphan the row", async () => {
    await unlockVideo("user-1", "abc123", { channelAccess: SUBSCRIBED });

    expect(prismaMock.videoUnlock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { userId: "user-1", videoId: "card-1" },
      }),
    );
  });

  it("keeps the first attribution when the row already exists", async () => {
    await unlockVideo("user-1", "abc123", { channelAccess: SUBSCRIBED });

    // Racing or repeat taps must not rewrite the conversion's timestamp, or the
    // analytics funnel would report whenever the user last tapped.
    expect(prismaMock.videoUnlock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} }),
    );
  });
});
