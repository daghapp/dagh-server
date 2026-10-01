import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";

/**
 * Tests for the combined "Subscribe to Unlock" endpoint.
 *
 * The behaviour worth pinning is not the happy path — it is the two ways this
 * endpoint could quietly damage data it is only supposed to record. The
 * SUBSCRIBE_INTENT event is the denominator of the conversion rate, so it has to
 * be written before anything that can fail, and it has to survive the server being
 * unable to verify anything. A dropped event does not error; it makes the funnel
 * report a better number than it earned.
 *
 * The 503 is the other half. This endpoint used to answer 200 with a null authUrl
 * when OAuth was unconfigured, and the unlock path then failed open. That shape is
 * the reason an unconfigured deployment could hand out content: the app saw a
 * success and unlocked.
 */

const communityMock = {
  getVideoRecord: vi.fn(),
  logInteraction: vi.fn(),
};

const oauthMock = {
  isYouTubeOAuthConfigured: vi.fn(),
  isYouTubeVerificationAvailable: vi.fn(),
  buildAuthUrl: vi.fn(() => "https://accounts.google.com/o/oauth2/v2/auth?state=state-token"),
  hasYouTubeReadonlyScope: vi.fn(() => false),
  getVerifyReturnUrl: vi.fn(() => "daghapp://youtube/verify"),
};

const accessMock = {
  resolveTargetChannelId: vi.fn<() => Promise<string | null>>(async () => "UC123"),
};

const stateMock = {
  storeVerifyState: vi.fn(async () => "state-token"),
  consumeVerifyState: vi.fn(),
  newNonce: vi.fn(() => "nonce-1"),
  newSessionId: vi.fn(() => "session-1"),
};

const prismaMock = { channelAccess: { findUnique: vi.fn() } };

const CHANNEL_LINKS = {
  channelId: "UC123",
  handle: "@diasporaaffairsgh",
  subscribeUrl: "https://www.youtube.com/@diasporaaffairsgh",
  appUrl: "vnd.youtube://channel/UC123",
};

vi.mock("../src/services/community.service.js", () => communityMock);
vi.mock("../src/services/youtube-oauth.service.js", () => oauthMock);
vi.mock("../src/services/channel-access.service.js", () => accessMock);
vi.mock("../src/services/youtube-verify-state.js", () => stateMock);
vi.mock("../src/config/index.js", () => ({ prisma: prismaMock }));
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

interface IntentBody {
  success: boolean;
  data?: { videoId: string; authUrl: string; channel: typeof CHANNEL_LINKS };
  error?: { code: string; message: string };
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
  const setHeader = vi.fn();
  const res = { status, json, setHeader } as unknown as Response;
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
  oauthMock.isYouTubeVerificationAvailable.mockReturnValue(true);
  oauthMock.buildAuthUrl.mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth?state=x");
  oauthMock.hasYouTubeReadonlyScope.mockReturnValue(false);
  accessMock.resolveTargetChannelId.mockResolvedValue("UC123");
  prismaMock.channelAccess.findUnique.mockResolvedValue(null);
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

  it("marks the response private and uncacheable", async () => {
    // The body carries an authorization URL bound to this user's round-trip. A
    // shared cache replaying it to the next reader would hand one user's
    // single-use state token to another.
    const { res } = mockRes();
    await controller.subscribeIntent(intentReq("card-1"), res);

    expect(
      (res as unknown as { setHeader: ReturnType<typeof vi.fn> }).setHeader,
    ).toHaveBeenCalledWith("Cache-Control", "private, no-store, max-age=0");
  });

  it("binds the round-trip to the canonical internal card id", async () => {
    // The app may pass the YouTube video id; the state token is verified on the
    // callback and its videoId is written to the interaction and access rows, so
    // it has to be the internal id or the foreign key misses.
    communityMock.getVideoRecord.mockResolvedValue({ id: "canonical-card-uuid" });

    const { res } = mockRes();
    await controller.subscribeIntent(intentReq("dQw4w9WgXcQ"), res);

    expect(stateMock.storeVerifyState).toHaveBeenCalledWith(
      expect.objectContaining({ appUserId: "user-1", videoId: "canonical-card-uuid" }),
    );
    expect(communityMock.logInteraction).toHaveBeenCalledWith(
      "user-1",
      "canonical-card-uuid",
      "SUBSCRIBE_INTENT",
    );
  });

  it("stores the channel, nonce and return URL the callback will need", async () => {
    // Every one of these is load-bearing. Without the nonce an id_token from any
    // other flow could satisfy the callback; without the channel there is nothing
    // to check against; without the return URL the callback cannot get the user
    // back to the app.
    const { res } = mockRes();
    await controller.subscribeIntent(intentReq("card-1"), res);

    expect(stateMock.storeVerifyState).toHaveBeenCalledWith({
      appUserId: "user-1",
      channelId: "UC123",
      nonce: "nonce-1",
      returnUrl: "daghapp://youtube/verify",
      sessionId: "session-1",
      videoId: "card-1",
    });
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

  it("asks for consent only when the stored credential lacks the YouTube scope", async () => {
    const { res } = mockRes();
    await controller.subscribeIntent(intentReq("card-1"), res);

    expect(prismaMock.channelAccess.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_channelId: { userId: "user-1", channelId: "UC123" } },
      }),
    );
    expect(oauthMock.buildAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({ forceConsent: true }),
    );
  });

  it("does not re-prompt an already-linked subscriber", async () => {
    // include_granted_scopes will not make Google offer a scope it was never asked
    // for, but once granted, one refresh answers the question — no consent screen.
    oauthMock.hasYouTubeReadonlyScope.mockReturnValue(true);

    const { res } = mockRes();
    await controller.subscribeIntent(intentReq("card-1"), res);

    expect(oauthMock.buildAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({ forceConsent: false }),
    );
  });

  it("503s when the server cannot check subscriptions, and unlocks nothing", async () => {
    // The regression this guards: a 200 with a null authUrl left the app in a
    // dead end it could not detect, and the dev fallback then unlocked the video
    // anyway. An unconfigured server says so loudly instead.
    oauthMock.isYouTubeVerificationAvailable.mockReturnValue(false);

    const { res, state } = mockRes();
    await controller.subscribeIntent(intentReq("card-1"), res);

    expect(state.status).toBe(503);
    expect(sentBody(state).success).toBe(false);
    expect(sentBody(state).error?.code).toBe("YOUTUBE_VERIFICATION_NOT_CONFIGURED");
    expect(sentBody(state).data).toBeUndefined();
    expect(oauthMock.buildAuthUrl).not.toHaveBeenCalled();
  });

  it("503s when the credentials exist but no channel is configured", async () => {
    // Distinct from the credentials case and equally unusable: a link could be
    // stored with nothing to compare it against.
    accessMock.resolveTargetChannelId.mockResolvedValue(null);

    const { res, state } = mockRes();
    await controller.subscribeIntent(intentReq("card-1"), res);

    expect(state.status).toBe(503);
    expect(sentBody(state).error?.code).toBe("YOUTUBE_VERIFICATION_NOT_CONFIGURED");
    expect(stateMock.storeVerifyState).not.toHaveBeenCalled();
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
    expect(sentBody(state).data?.authUrl).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?state=x",
    );
  });

  it("404s an unknown card without logging an intent against it", async () => {
    communityMock.getVideoRecord.mockResolvedValue(null);

    const { res, state } = mockRes();
    await controller.subscribeIntent(intentReq("nope"), res);

    expect(state.status).toBe(404);
    expect(communityMock.logInteraction).not.toHaveBeenCalled();
    expect(stateMock.storeVerifyState).not.toHaveBeenCalled();
  });
});
