import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";

/**
 * `resolveChannelAccessForRead` is where an unsubscribe is actually noticed. If a
 * controller forgets to call it, that user silently keeps access until the nightly
 * sweep — and nothing else in the suite would fail, because the service-level
 * function is correct and simply unused. These tests pin the wiring.
 */

const ACCESS = {
  channelId: "UC123",
  unlockedAt: new Date("2026-02-01T00:00:00Z"),
  verifiedAt: new Date("2026-02-01T00:00:00Z"),
};

const resolveChannelAccessForRead = vi.fn(
  async (_userId: string): Promise<{ access: typeof ACCESS | null; checked: boolean }> => ({
    access: ACCESS,
    checked: false,
  }),
);

const listVideosForUser = vi.fn(
  async (
    _userId: string,
    _page: number,
    _limit: number,
    _options?: { sort?: string; channelAccess?: typeof ACCESS | null },
  ) => ({
    videos: [] as unknown[],
    total: 0,
    hasChannelAccess: true,
    channelAccess: { channelId: "UC123" },
  }),
);

const serviceMock = {
  resolveChannelAccessForRead,
  listVideosForUser,
  getVideoForUser: vi.fn(),
  getUserUnlocks: vi.fn(),
  unlockVideo: vi.fn(),
  getUnlockStatus: vi.fn(),
  getVideoRecord: vi.fn(),
  VIDEO_SORTS: ["NEWEST", "MOST_WATCHED", "MOST_LIKED"],
  DEFAULT_VIDEO_SORT: "NEWEST",
  parseEnum: undefined,
};

vi.mock("../src/services/community.service.js", () => serviceMock);
vi.mock("../src/services/youtube.service.js", () => ({
  YouTubeApiError: class extends Error {},
  YouTubeNotConfiguredError: class extends Error {},
}));
vi.mock("../src/services/youtube-oauth.service.js", () => ({
  getCachedVerification: vi.fn(async () => null),
  getVerifyReturnUrl: vi.fn(() => "daghapp://youtube/verify"),
  isYouTubeOAuthConfigured: vi.fn(() => true),
}));
vi.mock("../src/helpers/communityLogger.js", () => ({
  logCommunity: vi.fn(),
  logCommunityWarn: vi.fn(),
  logCommunityError: vi.fn(),
}));

const { CommunityController } = await import("../src/modules/community/community.controller.js");
const controller = new CommunityController();

function req(query: Record<string, string> = {}, params: Record<string, string> = {}): Request {
  return { query, params, user: { id: "user-1" } } as unknown as Request;
}

function res(): Response {
  const json = vi.fn();
  return { json, status: vi.fn(() => ({ json })) } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveChannelAccessForRead.mockResolvedValue({ access: ACCESS, checked: false });
  listVideosForUser.mockResolvedValue({
    videos: [],
    total: 0,
    hasChannelAccess: true,
    channelAccess: { channelId: "UC123" },
  });
  serviceMock.getVideoForUser.mockResolvedValue(null);
  serviceMock.getUserUnlocks.mockResolvedValue({
    hasChannelAccess: true,
    channelAccess: { channelId: "UC123" },
    unlocks: [],
  });
  serviceMock.unlockVideo.mockResolvedValue({
    success: false,
    code: "SUBSCRIPTION_REQUIRED",
    verifiedAt: null,
  });
  serviceMock.getUnlockStatus.mockResolvedValue({
    isUnlocked: false,
    unlockedAt: null,
    via: null,
    hasChannelAccess: false,
  });
  serviceMock.getVideoRecord.mockResolvedValue({ id: "v1" });
});

describe("read paths go through the re-verify gate", () => {
  it("re-checks the grant on the feed listing", async () => {
    await controller.listVideos(req(), res());

    expect(resolveChannelAccessForRead).toHaveBeenCalledWith("user-1");
  });

  it("hands the resolved access to the feed so it is not looked up twice", async () => {
    await controller.listVideos(req(), res());

    expect(listVideosForUser.mock.calls[0][3]).toEqual(
      expect.objectContaining({ channelAccess: expect.objectContaining({ channelId: "UC123" }) }),
    );
  });

  it("re-checks the grant on a single-card read", async () => {
    await controller.getVideo(req({}, { videoId: "v1" }), res());

    expect(resolveChannelAccessForRead).toHaveBeenCalledWith("user-1");
    expect(serviceMock.getVideoForUser.mock.calls[0][2]).toEqual(
      expect.objectContaining({ channelAccess: expect.objectContaining({ channelId: "UC123" }) }),
    );
  });

  it("re-checks the grant on my-unlocks, which the app calls on launch", async () => {
    await controller.getMyUnlocks(req(), res());

    expect(resolveChannelAccessForRead).toHaveBeenCalledWith("user-1");
    expect(serviceMock.getUserUnlocks.mock.calls[0][1]).toEqual(
      expect.objectContaining({ channelAccess: expect.objectContaining({ channelId: "UC123" }) }),
    );
  });

  it("re-checks the grant before answering an unlock request", async () => {
    // Otherwise a stale grant short-circuits the unlock and the cancelled user is
    // told "unlocked" every time they ask.
    await controller.unlockVideo(req({}, { videoId: "v1" }), res());

    expect(resolveChannelAccessForRead).toHaveBeenCalledWith("user-1");
    expect(serviceMock.unlockVideo.mock.calls[0][2]).toEqual(
      expect.objectContaining({ channelAccess: expect.objectContaining({ channelId: "UC123" }) }),
    );
  });

  it("passes a null access through when the grant was just revoked", async () => {
    // A revoked grant must reach the service as an explicit null. Omitting it
    // would make the service fall back to its own lookup and re-read a row the
    // gate has already closed.
    resolveChannelAccessForRead.mockResolvedValue({ access: null, checked: true });

    await controller.listVideos(req(), res());

    expect(listVideosForUser.mock.calls[0][3]).toEqual(
      expect.objectContaining({ channelAccess: null }),
    );
  });

  it("re-checks the grant on the verification status the app polls", async () => {
    const { YouTubeVerifyController } =
      await import("../src/modules/community/youtube-verify.controller.js");
    const verify = new YouTubeVerifyController();

    await verify.status(req({}, { videoId: "v1" }), res());

    expect(resolveChannelAccessForRead).toHaveBeenCalledWith("user-1");
    expect(serviceMock.getUnlockStatus.mock.calls[0][2]).toEqual(
      expect.objectContaining({ channelAccess: expect.objectContaining({ channelId: "UC123" }) }),
    );
  });
});
