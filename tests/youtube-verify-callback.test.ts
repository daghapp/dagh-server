import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";

/**
 * The OAuth callback is the only place the server confirms a subscription and
 * grants an unlock, so it is also the only place that can corrupt the funnel
 * numbers. These tests pin the two things that is easy to get wrong: the verdict
 * must be cached *before* the gated unlock reads it, and SUBSCRIBE_INTENT must
 * not be logged here (the client already logs the tap that started the flow).
 */

const communityMock = {
  getVideoRecord: vi.fn(),
  unlockVideo: vi.fn(),
  logInteraction: vi.fn(),
  getUnlockStatus: vi.fn(),
};

const oauthMock = {
  exchangeCodeForToken: vi.fn(),
  checkChannelSubscription: vi.fn(),
  setCachedVerification: vi.fn(),
  getCachedVerification: vi.fn(),
  getVerifyReturnUrl: vi.fn(() => "daghapp://youtube/verify"),
  signVerifyState: vi.fn(() => "state-token"),
  verifyStateToken: vi.fn(),
  buildAuthUrl: vi.fn(() => "https://accounts.google.com/o/oauth2/v2/auth?state=state-token"),
};

vi.mock("../src/services/community.service.js", () => communityMock);
vi.mock("../src/services/youtube-oauth.service.js", () => oauthMock);
vi.mock("../src/services/youtube.service.js", () => ({
  resolveChannelId: vi.fn(async () => "UC-channel"),
  YouTubeNotConfiguredError: class extends Error {},
  YouTubeApiError: class extends Error {
    status = 502;
  },
}));
vi.mock("../src/helpers/communityLogger.js", () => ({
  logCommunity: vi.fn(),
  logCommunityWarn: vi.fn(),
  logCommunityError: vi.fn(),
}));

const { YouTubeVerifyController } =
  await import("../src/modules/community/youtube-verify.controller.js");

const controller = new YouTubeVerifyController();

function mockRes(): { res: Response; redirect: ReturnType<typeof vi.fn> } {
  const redirect = vi.fn();
  const res = { redirect, type: vi.fn(), send: vi.fn() } as unknown as Response;
  return { res, redirect };
}

function callbackReq(query: Record<string, string>): Request {
  return { query } as unknown as Request;
}

const STATE = { userId: "user-1", videoId: "card-1" };

beforeEach(() => {
  vi.clearAllMocks();
  oauthMock.getVerifyReturnUrl.mockReturnValue("daghapp://youtube/verify");
  oauthMock.verifyStateToken.mockReturnValue(STATE);
  oauthMock.exchangeCodeForToken.mockResolvedValue("access-token");
  oauthMock.checkChannelSubscription.mockResolvedValue(true);
  oauthMock.setCachedVerification.mockResolvedValue(undefined);
  communityMock.unlockVideo.mockResolvedValue({
    success: true,
    isUnlocked: true,
    unlockedAt: new Date("2026-02-01T00:00:00Z"),
  });
  communityMock.logInteraction.mockResolvedValue({ success: true });
});

describe("YouTubeVerifyController.callback", () => {
  it("caches the positive verdict before the gated unlock reads it", async () => {
    const order: string[] = [];
    oauthMock.setCachedVerification.mockImplementation(async () => {
      order.push("cache");
    });
    communityMock.unlockVideo.mockImplementation(async () => {
      order.push("unlock");
      return { success: true, isUnlocked: true, unlockedAt: new Date() };
    });

    const { res } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(order).toEqual(["cache", "unlock"]);
    expect(oauthMock.setCachedVerification).toHaveBeenCalledWith("user-1", true);
  });

  it("logs only UNLOCK, leaving SUBSCRIBE_INTENT to the client tap", async () => {
    const { res } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(communityMock.logInteraction).toHaveBeenCalledTimes(1);
    expect(communityMock.logInteraction).toHaveBeenCalledWith("user-1", "card-1", "UNLOCK");
  });

  it("caches the negative verdict and grants nothing", async () => {
    oauthMock.checkChannelSubscription.mockResolvedValue(false);

    const { res, redirect } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(oauthMock.setCachedVerification).toHaveBeenCalledWith("user-1", false);
    expect(communityMock.unlockVideo).not.toHaveBeenCalled();
    expect(communityMock.logInteraction).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(
      "daghapp://youtube/verify?subscribed=false&videoId=card-1&unlocked=false",
    );
  });

  it("redirects with the unlocked flag when the grant succeeds", async () => {
    const { res, redirect } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(redirect).toHaveBeenCalledWith(
      "daghapp://youtube/verify?subscribed=true&videoId=card-1&unlocked=true",
    );
  });

  it("treats a consent denial as not subscribed without calling YouTube", async () => {
    const { res, redirect } = mockRes();
    await controller.callback(callbackReq({ error: "access_denied" }), res);

    expect(oauthMock.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(oauthMock.setCachedVerification).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("daghapp://youtube/verify?subscribed=false&videoId=");
  });

  it("rejects a tampered state token before exchanging the code", async () => {
    oauthMock.verifyStateToken.mockImplementation(() => {
      throw new Error("invalid signature");
    });

    const { res, redirect } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "forged" }), res);

    expect(oauthMock.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(communityMock.unlockVideo).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("daghapp://youtube/verify?subscribed=false&videoId=");
  });
});
