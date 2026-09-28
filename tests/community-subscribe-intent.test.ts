import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";

/**
 * Tests for the combined "Subscribe to Unlock" endpoint.
 *
 * The behaviour worth pinning is not the happy path — it is the two ways this
 * endpoint could quietly damage data it is only supposed to record. The
 * SUBSCRIBE_INTENT event is the denominator of the conversion rate, so it has to
 * be written before anything that can fail, and it has to survive the server
 * being unable to verify anything. A dropped event does not error; it makes the
 * funnel report a better number than it earned.
 */

const communityMock = {
  getVideoRecord: vi.fn(),
  logInteraction: vi.fn(),
};

const oauthMock = {
  isYouTubeOAuthConfigured: vi.fn(),
  signVerifyState: vi.fn(() => "state-token"),
  buildAuthUrl: vi.fn(() => "https://accounts.google.com/o/oauth2/v2/auth?state=state-token"),
};

const CHANNEL_LINKS = {
  channelId: "UC123",
  handle: "@diasporaaffairsgh",
  subscribeUrl: "https://www.youtube.com/@diasporaaffairsgh",
  appUrl: "vnd.youtube://channel/UC123",
};

vi.mock("../src/services/community.service.js", () => communityMock);
vi.mock("../src/services/youtube-oauth.service.js", () => oauthMock);
vi.mock("../src/services/youtube.service.js", () => ({
  getChannelLinks: vi.fn(() => CHANNEL_LINKS),
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

/** The success body this endpoint is contracted to return. */
interface IntentBody {
  success: boolean;
  data: { videoId: string; authUrl: string | null; channel: typeof CHANNEL_LINKS };
}

/** Captures the status code and body the handler sends. */
function mockRes() {
  const state: { status?: number; body?: IntentBody } = {};
  const json = vi.fn((body: IntentBody) => {
    state.body = body;
    return state;
  });
  const status = vi.fn((code: number) => {
    state.status = code;
    return { json } as unknown as Response;
  });
  const res = { status, json } as unknown as Response;
  return { res, state };
}

function intentReq(videoId: string): Request {
  return { user: { id: "user-1" }, params: { videoId } } as unknown as Request;
}

/** The captured body, asserted present. Every path under test sends exactly one. */
function sentBody(state: { body?: IntentBody }): IntentBody {
  if (!state.body) throw new Error("handler did not send a body");
  return state.body;
}

beforeEach(() => {
  vi.clearAllMocks();
  oauthMock.isYouTubeOAuthConfigured.mockReturnValue(true);
  oauthMock.signVerifyState.mockReturnValue("state-token");
  oauthMock.buildAuthUrl.mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth?state=x");
  communityMock.getVideoRecord.mockResolvedValue({ id: "card-1" });
  communityMock.logInteraction.mockResolvedValue({ success: true });
});

describe("YouTubeVerifyController.subscribeIntent", () => {
  it("records the intent and returns the auth URL and channel links in one call", async () => {
    const { res, state } = mockRes();
    await controller.subscribeIntent(intentReq("card-1"), res);

    expect(communityMock.logInteraction).toHaveBeenCalledWith(
      "user-1",
      "card-1",
      "SUBSCRIBE_INTENT",
    );
    expect(sentBody(state).data).toEqual({
      videoId: "card-1",
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=x",
      channel: CHANNEL_LINKS,
    });
  });

  it("signs the state token with the canonical internal card id", async () => {
    // The app may pass the YouTube video id; the state token is verified on the
    // callback and its videoId is written to the unlock row, so it has to be the
    // internal id or the foreign key misses.
    communityMock.getVideoRecord.mockResolvedValue({ id: "canonical-card-uuid" });

    const { res } = mockRes();
    await controller.subscribeIntent(intentReq("dQw4w9WgXcQ"), res);

    expect(oauthMock.signVerifyState).toHaveBeenCalledWith("user-1", "canonical-card-uuid");
    expect(communityMock.logInteraction).toHaveBeenCalledWith(
      "user-1",
      "canonical-card-uuid",
      "SUBSCRIBE_INTENT",
    );
  });

  it("logs the intent before building the auth URL, so a failure cannot lose it", async () => {
    const order: string[] = [];
    communityMock.logInteraction.mockImplementation(async () => {
      order.push("log");
      return { success: true };
    });
    oauthMock.buildAuthUrl.mockImplementation(() => {
      order.push("authUrl");
      return "https://accounts.google.com/o/oauth2/v2/auth?state=x";
    });

    const { res } = mockRes();
    await controller.subscribeIntent(intentReq("card-1"), res);

    expect(order).toEqual(["log", "authUrl"]);
  });

  it("still returns the subscribe links when OAuth is not configured", async () => {
    // Not a 503: the tap happened and is worth recording, and the user can still
    // go and subscribe. Failing the call would throw away the funnel event to
    // report a config problem the app cannot act on.
    oauthMock.isYouTubeOAuthConfigured.mockReturnValue(false);

    const { res, state } = mockRes();
    await controller.subscribeIntent(intentReq("card-1"), res);

    expect(state.status).toBeUndefined();
    expect(sentBody(state).data.authUrl).toBeNull();
    expect(sentBody(state).data.channel).toEqual(CHANNEL_LINKS);
    expect(communityMock.logInteraction).toHaveBeenCalledWith(
      "user-1",
      "card-1",
      "SUBSCRIBE_INTENT",
    );
    expect(oauthMock.buildAuthUrl).not.toHaveBeenCalled();
  });

  it("does not sign a state token when OAuth is not configured", async () => {
    oauthMock.isYouTubeOAuthConfigured.mockReturnValue(false);

    const { res } = mockRes();
    await controller.subscribeIntent(intentReq("card-1"), res);

    expect(oauthMock.signVerifyState).not.toHaveBeenCalled();
  });

  it("still serves the tap when the interaction write reports failure", async () => {
    // The user's way to subscribe is not contingent on the analytics write
    // succeeding. Once the card is resolved this is a defensive branch —
    // logInteraction only reports failure for a missing video, which the lookup
    // above has already ruled out — but if it ever fires, withholding the
    // subscribe link would block the actual conversion to fix a metric.
    communityMock.logInteraction.mockResolvedValue({ success: false, code: "VIDEO_NOT_FOUND" });

    const { res, state } = mockRes();
    await controller.subscribeIntent(intentReq("card-1"), res);

    expect(sentBody(state).success).toBe(true);
    expect(sentBody(state).data.authUrl).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?state=x",
    );
  });

  it("404s an unknown card without logging an intent against it", async () => {
    communityMock.getVideoRecord.mockResolvedValue(null);

    const { res, state } = mockRes();
    await controller.subscribeIntent(intentReq("nope"), res);

    expect(state.status).toBe(404);
    expect(communityMock.logInteraction).not.toHaveBeenCalled();
  });
});
