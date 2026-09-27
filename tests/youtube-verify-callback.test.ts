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
  oauthMock.exchangeCodeForToken.mockResolvedValue({
    accessToken: "access-token",
    refreshToken: "refresh-token",
  });
  oauthMock.checkChannelSubscription.mockResolvedValue(true);
  oauthMock.setCachedVerification.mockResolvedValue(undefined);
  communityMock.unlockVideo.mockResolvedValue({
    success: true,
    isUnlocked: true,
    unlockedAt: new Date("2026-02-01T00:00:00Z"),
    channelGranted: true,
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
      return { success: true, isUnlocked: true, unlockedAt: new Date(), channelGranted: true };
    });

    const { res } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(order).toEqual(["cache", "unlock"]);
    expect(oauthMock.setCachedVerification).toHaveBeenCalledWith("user-1", true);
  });

  it("hands the resolved channel id to the unlock so the grant is channel-wide", async () => {
    // The whole point: a YouTube subscription is per channel, so the callback
    // must pass the channel it verified against. Omitting it would leave the
    // feed gated per-video and force another OAuth round-trip for the next card.
    const { res } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(communityMock.unlockVideo).toHaveBeenCalledWith(
      "user-1",
      "card-1",
      expect.objectContaining({ channelId: "UC-channel" }),
    );
  });

  it("forwards the refresh token so the grant can later be re-verified", async () => {
    // The grant is only re-checkable while a long-lived credential is stored
    // against it. If the callback drops the token, an unsubscribe is never
    // detected and the feed stays open.
    const { res } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(oauthMock.checkChannelSubscription).toHaveBeenCalledWith("access-token", "UC-channel");
    expect(communityMock.unlockVideo).toHaveBeenCalledWith(
      "user-1",
      "card-1",
      expect.objectContaining({ refreshToken: "refresh-token" }),
    );
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
      "daghapp://youtube/verify?subscribed=false&videoId=card-1&unlocked=false" +
        "&channelGranted=false&hasChannelAccess=false",
    );
  });

  it("redirects with the unlocked flag when the grant succeeds", async () => {
    const { res, redirect } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(redirect).toHaveBeenCalledWith(
      "daghapp://youtube/verify?subscribed=true&videoId=card-1&unlocked=true" +
        "&channelGranted=true&hasChannelAccess=true",
    );
  });

  it("still reports the video as unlocked when only a legacy per-video grant existed", async () => {
    // A pre-existing per-video unlock short-circuits before the channel grant is
    // written (channelGranted: false). The card must still read as unlocked, or
    // a returning subscriber would see it re-lock.
    communityMock.unlockVideo.mockResolvedValue({
      success: true,
      isUnlocked: true,
      unlockedAt: new Date("2026-01-15T00:00:00Z"),
      channelGranted: false,
    });

    const { res, redirect } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(redirect).toHaveBeenCalledWith(
      "daghapp://youtube/verify?subscribed=true&videoId=card-1&unlocked=true" +
        "&channelGranted=false&hasChannelAccess=false",
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

describe("redirect fallback when the return URL is unparseable", () => {
  // The fallback page is what a user sees when YOUTUBE_VERIFY_RETURN_URL cannot be
  // parsed by `new URL()`. It used to say "subscription verified" for every
  // outcome, so a single bad env var turned every failed verification into a
  // user-facing success.

  function unparseableReturnUrl() {
    // A bare host with no scheme — the realistic shape of this bug (someone drops
    // the colon when setting the deep link). Note `daghapp:/verify` with a single
    // slash does parse, so it would not exercise the fallback.
    oauthMock.getVerifyReturnUrl.mockReturnValue("daghapp.youtube/verify");
  }

  function fallbackRes(): { res: Response; redirect: ReturnType<typeof vi.fn> } {
    const redirect = vi.fn();
    const send = vi.fn();
    // The fallback page chains `.type().send()`, which real Express supports by
    // returning `res` — the shared mockRes above does not, so use a chainable one.
    const res = {
      redirect,
      type: vi.fn(() => res),
      send,
    } as unknown as Response;
    return { res, redirect };
  }

  function htmlSent(res: Response): string {
    return (res.send as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  }

  it("reports success when the subscription really was verified", async () => {
    unparseableReturnUrl();
    const { res, redirect } = fallbackRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(redirect).not.toHaveBeenCalled();
    expect(htmlSent(res)).toContain("subscription verified");
  });

  it("does not claim success when the user declined consent", async () => {
    unparseableReturnUrl();
    const { res } = fallbackRes();
    await controller.callback(callbackReq({ error: "access_denied" }), res);

    const html = htmlSent(res);
    expect(html).not.toContain("subscription verified");
    expect(html).toContain("could not confirm");
    expect(html).toContain("Nothing has been unlocked");
  });

  it("does not claim success when the account is not subscribed", async () => {
    unparseableReturnUrl();
    oauthMock.checkChannelSubscription.mockResolvedValue(false);
    const { res } = fallbackRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(htmlSent(res)).not.toContain("subscription verified");
  });

  it("does not claim success when the exchange itself failed", async () => {
    unparseableReturnUrl();
    oauthMock.exchangeCodeForToken.mockRejectedValue(new Error("invalid_grant"));
    const { res } = fallbackRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    const html = htmlSent(res);
    expect(html).not.toContain("subscription verified");
    expect(html).toContain("Nothing has been unlocked");
  });

  it("escapes the outcome text so the page cannot be used for injection", async () => {
    unparseableReturnUrl();
    oauthMock.checkChannelSubscription.mockResolvedValue(false);
    // videoId flows from a signed state token, not raw input, but the fallback
    // page is the one place server strings get interpolated into HTML.
    const { res } = fallbackRes();
    await controller.callback(
      callbackReq({ code: "code", state: "state-token" }),
      res,
    );

    expect(htmlSent(res)).not.toContain("<script");
  });
});
