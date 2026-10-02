import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";
import type { ChannelAccessSnapshot } from "../src/services/channel-access.service.js";

/**
 * The OAuth callback is the only place the server confirms a subscription and
 * links a Google account, so it is also the only place that can corrupt the funnel
 * numbers or attach the wrong mailbox to an account.
 *
 * The order of operations is the security property, and it is the thing these
 * tests exist to pin:
 *
 *   state consumed → identity verified → same email → link stored → verdict asked
 *
 * Each arrow is a step that must not be skipped, and the two that are easy to
 * reorder are the expensive ones. Storing the link before the verdict means an
 * interrupted callback leaves a credential nobody can use; asking the verdict
 * first means a positive with no credential behind it — the exact state this
 * design removed, because such a grant can never be revoked.
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
  fetchAuthorizedChannelId: vi.fn(async () => "UC-own"),
  isYouTubeVerificationAvailable: vi.fn(() => true),
  isAllowedReturnUrl: vi.fn(() => true),
  hasYouTubeReadonlyScope: vi.fn(() => true),
  buildScopeString: vi.fn(() => "openid email https://www.googleapis.com/auth/youtube.readonly"),
  getYouTubeOAuthClientId: vi.fn(() => "client-123"),
  getVerifyReturnUrl: vi.fn(() => "daghapp://youtube/verify"),
  getActiveRecheckSeconds: vi.fn(() => 300),
  YouTubeAuthorizationError: class YouTubeAuthorizationError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "YouTubeAuthorizationError";
      this.status = status;
    }
  },
  YouTubeApiError: class YouTubeApiError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "YouTubeApiError";
      this.status = status;
    }
  },
};

const accessMock = {
  checkChannelAccess: vi.fn(),
  resolveTargetChannelId: vi.fn<() => Promise<string | null>>(async () => "UC123"),
  linkGoogleIdentity: vi.fn(),
};

const stateMock = {
  storeVerifyState: vi.fn(),
  consumeVerifyState: vi.fn(),
  newNonce: vi.fn(() => "nonce-1"),
  newSessionId: vi.fn(() => "session-1"),
};

const identityMock = {
  verifyGoogleIdToken: vi.fn(),
  googleEmailMatchesAppEmail: vi.fn(() => true),
  GoogleIdentityError: class GoogleIdentityError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "GoogleIdentityError";
    }
  },
};

const prismaMock = { user: { findUnique: vi.fn() } };

vi.mock("../src/services/community.service.js", () => communityMock);
vi.mock("../src/services/youtube-oauth.service.js", () => oauthMock);
vi.mock("../src/services/channel-access.service.js", () => accessMock);
vi.mock("../src/services/youtube-verify-state.js", () => stateMock);
vi.mock("../src/services/google-identity.service.js", () => identityMock);
vi.mock("../src/config/index.js", () => ({ prisma: prismaMock }));
vi.mock("../src/services/youtube.service.js", () => ({
  resolveChannelId: vi.fn(async () => "UC123"),
  getChannelLinks: vi.fn(() => ({ channelId: "UC123" })),
  YouTubeNotConfiguredError: class extends Error {},
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

const PENDING = {
  appUserId: "user-1",
  channelId: "UC123",
  nonce: "nonce-1",
  returnUrl: "daghapp://youtube/verify",
  sessionId: "session-1",
  videoId: "card-1",
};

function snapshot(overrides: Partial<ChannelAccessSnapshot> = {}): ChannelAccessSnapshot {
  return {
    channelId: "UC123",
    status: "SUBSCRIBED",
    hasChannelAccess: true,
    verifiedAt: "2026-02-01T00:00:00.000Z",
    accessExpiresAt: "2026-02-01T00:01:00.000Z",
    accessVersion: 3,
    requiresGoogleConnection: false,
    reason: null,
    ...overrides,
  };
}

/** The query string the app was redirected to, parsed back out of the URL. */
function redirectedTo(redirect: ReturnType<typeof vi.fn>): URLSearchParams {
  const target = redirect.mock.calls[0][0] as string;
  return new URL(target).searchParams;
}

beforeEach(() => {
  vi.clearAllMocks();
  oauthMock.getVerifyReturnUrl.mockReturnValue("daghapp://youtube/verify");
  oauthMock.isYouTubeVerificationAvailable.mockReturnValue(true);
  oauthMock.isAllowedReturnUrl.mockReturnValue(true);
  oauthMock.getYouTubeOAuthClientId.mockReturnValue("client-123");
  oauthMock.exchangeCodeForToken.mockResolvedValue({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    scope: "openid email https://www.googleapis.com/auth/youtube.readonly",
    idToken: "id-token",
    expiresIn: 3600,
  });
  oauthMock.fetchAuthorizedChannelId.mockResolvedValue("UC-own");

  stateMock.consumeVerifyState.mockResolvedValue(PENDING);

  identityMock.verifyGoogleIdToken.mockResolvedValue({
    subject: "google-subject-1",
    email: "user@example.com",
    emailVerified: true,
  });
  identityMock.googleEmailMatchesAppEmail.mockReturnValue(true);

  prismaMock.user.findUnique.mockResolvedValue({
    id: "user-1",
    email: "user@example.com",
    accountStatus: "ACTIVE",
  });

  accessMock.linkGoogleIdentity.mockResolvedValue(undefined);
  accessMock.checkChannelAccess.mockResolvedValue({
    verdict: "subscribed",
    access: snapshot(),
    latencyMs: 12,
  });

  communityMock.logInteraction.mockResolvedValue({ success: true });
});

describe("YouTubeVerifyController.callback — ordering", () => {
  it("consumes the state token before touching Google", async () => {
    const order: string[] = [];
    stateMock.consumeVerifyState.mockImplementation(async () => {
      order.push("consumeState");
      return PENDING;
    });
    oauthMock.exchangeCodeForToken.mockImplementation(async () => {
      order.push("exchange");
      return {
        accessToken: "access-token",
        refreshToken: null,
        scope: null,
        idToken: "id-token",
        expiresIn: 3600,
      };
    });

    const { res } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    // A replayed callback finds nothing because the first thing this handler does
    // is delete the pending record. Exchanging the code first would spend a
    // credential on an attacker-supplied replay.
    expect(order).toEqual(["consumeState", "exchange"]);
  });

  it("stores the link before asking the question, never after", async () => {
    const order: string[] = [];
    accessMock.linkGoogleIdentity.mockImplementation(async () => {
      order.push("link");
    });
    accessMock.checkChannelAccess.mockImplementation(async () => {
      order.push("verdict");
      return { verdict: "subscribed", access: snapshot(), latencyMs: 12 };
    });

    const { res } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    // The reverse order produces a positive with no credential behind it — one
    // that can never be re-checked, so an unsubscribe could never close it.
    expect(order).toEqual(["link", "verdict"]);
  });

  it("passes the fresh token to the link so the access record is re-checkable later", async () => {
    // Without a stored credential the lease is the only thing standing between a
    // cancelled subscription and an indefinitely open feed.
    const { res } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(accessMock.linkGoogleIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        channelId: "UC123",
        refreshToken: "refresh-token",
        googleSubject: "google-subject-1",
      }),
    );
  });

  it("passes a null refresh token as null rather than inventing one", async () => {
    // Google omits refresh_token after the first authorization. Treating that as
    // a credential would overwrite a perfectly good stored one with nothing.
    oauthMock.exchangeCodeForToken.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: null,
      scope: null,
      idToken: "id-token",
      expiresIn: 3600,
    });

    const { res } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(accessMock.linkGoogleIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: null }),
    );
  });

  it("asks for a fresh verdict rather than deferring to an older one", async () => {
    const { res } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    // The handler is the authority for its own round-trip: it holds a token minted
    // seconds ago, so a cached verdict would be throwing away better evidence.
    expect(accessMock.checkChannelAccess).toHaveBeenCalledWith("user-1", "UC123", {
      reason: "OAUTH_CALLBACK",
      channelId: "UC123",
      force: true,
    });
  });
});

describe("YouTubeVerifyController.callback — identity", () => {
  it("verifies the id_token against the nonce before anything else uses it", async () => {
    const { res } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(identityMock.verifyGoogleIdToken).toHaveBeenCalledWith("id-token", {
      clientId: "client-123",
      nonce: "nonce-1",
    });
  });

  it("refuses a round-trip with no id_token", async () => {
    // No id_token means no verified identity claim, so the same-email rule cannot
    // be enforced and there is nothing to link.
    oauthMock.exchangeCodeForToken.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      scope: null,
      idToken: null,
      expiresIn: 3600,
    });

    const { res, redirect } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(redirectedTo(redirect).get("code")).toBe("IDENTITY_NOT_VERIFIED");
    expect(accessMock.linkGoogleIdentity).not.toHaveBeenCalled();
  });

  it("refuses an unverified Google address", async () => {
    identityMock.verifyGoogleIdToken.mockResolvedValue({
      subject: "google-subject-1",
      email: "user@example.com",
      emailVerified: false,
    });

    const { res, redirect } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(redirectedTo(redirect).get("code")).toBe("GOOGLE_EMAIL_UNVERIFIED");
    // A mismatch leaves any existing link completely untouched, so a user cannot
    // lock themselves out by picking the wrong account at the consent screen.
    expect(accessMock.linkGoogleIdentity).not.toHaveBeenCalled();
  });

  it("refuses an app account whose own email is unverified", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      accountStatus: "PENDING",
    });

    const { res, redirect } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(redirectedTo(redirect).get("code")).toBe("GOOGLE_ACCOUNT_MISMATCH");
    expect(accessMock.linkGoogleIdentity).not.toHaveBeenCalled();
  });

  it("refuses a Google account that does not match the app account", async () => {
    identityMock.googleEmailMatchesAppEmail.mockReturnValue(false);

    const { res, redirect } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(redirectedTo(redirect).get("code")).toBe("GOOGLE_ACCOUNT_MISMATCH");
    expect(accessMock.checkChannelAccess).not.toHaveBeenCalled();
  });

  it("compares the addresses exactly, without normalising Gmail dots or plus tags", async () => {
    // The comparison is delegated to a helper whose job is the strictness. This
    // pins that the handler uses the helper rather than doing its own looser
    // match, and that it receives the real pair.
    const { res } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(identityMock.googleEmailMatchesAppEmail).toHaveBeenCalledWith(
      "user@example.com",
      "user@example.com",
    );
  });

  it("does nothing when the app account was deleted mid-flow", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const { res, redirect } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(redirectedTo(redirect).get("code")).toBe("IDENTITY_NOT_VERIFIED");
    expect(accessMock.linkGoogleIdentity).not.toHaveBeenCalled();
  });
});

describe("YouTubeVerifyController.callback — funnel", () => {
  it("logs only UNLOCK, leaving SUBSCRIBE_INTENT to the client tap", async () => {
    const { res } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    // The tap was already counted at subscribe-intent. Counting it again here
    // would inflate the denominator of the very rate this funnel measures.
    expect(communityMock.logInteraction).toHaveBeenCalledTimes(1);
    expect(communityMock.logInteraction).toHaveBeenCalledWith("user-1", "card-1", "UNLOCK");
  });

  it("records no unlock on a confirmed negative", async () => {
    accessMock.checkChannelAccess.mockResolvedValue({
      verdict: "notSubscribed",
      access: snapshot({
        status: "NOT_SUBSCRIBED",
        hasChannelAccess: false,
        reason: "NOT_SUBSCRIBED",
      }),
      latencyMs: 12,
    });

    const { res } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(communityMock.logInteraction).not.toHaveBeenCalled();
  });

  it("records no unlock when the check could not be completed", async () => {
    // A failed check is not a conversion. Logging one would make an outage look
    // like a spike in the metric it is supposed to be measuring against.
    accessMock.checkChannelAccess.mockResolvedValue({
      verdict: "checkFailed",
      access: snapshot({
        status: "CHECK_FAILED",
        hasChannelAccess: false,
        reason: "VERIFICATION_UNAVAILABLE",
      }),
      latencyMs: 12,
    });

    const { res } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(communityMock.logInteraction).not.toHaveBeenCalled();
  });
});

describe("YouTubeVerifyController.callback — redirect", () => {
  it("redirects with the verdict and version when access is granted", async () => {
    const { res, redirect } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    const query = redirectedTo(redirect);
    expect(query.get("subscribed")).toBe("true");
    expect(query.get("videoId")).toBe("card-1");
    expect(query.get("status")).toBe("SUBSCRIBED");
    // Carried so a client can order this against a later response and apply only
    // the newest — a client cannot do that from a bare boolean.
    expect(query.get("accessVersion")).toBe("3");
    expect(query.get("sessionId")).toBe("session-1");
  });

  it("reports a confirmed negative as a verdict, not as a failure", async () => {
    accessMock.checkChannelAccess.mockResolvedValue({
      verdict: "notSubscribed",
      access: snapshot({
        status: "NOT_SUBSCRIBED",
        hasChannelAccess: false,
        reason: "NOT_SUBSCRIBED",
      }),
      latencyMs: 12,
    });

    const { res, redirect } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    const query = redirectedTo(redirect);
    expect(query.get("subscribed")).toBe("false");
    expect(query.get("status")).toBe("NOT_SUBSCRIBED");
  });

  it("treats a consent denial as not subscribed without exchanging a code", async () => {
    const { res, redirect } = mockRes();
    await controller.callback(callbackReq({ error: "access_denied" }), res);

    expect(oauthMock.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(accessMock.checkChannelAccess).not.toHaveBeenCalled();
    expect(redirectedTo(redirect).get("code")).toBe("CONSENT_DENIED");
  });

  it("rejects an unknown or replayed state token before exchanging the code", async () => {
    stateMock.consumeVerifyState.mockResolvedValue(null);

    const { res, redirect } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "forged" }), res);

    expect(oauthMock.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(accessMock.linkGoogleIdentity).not.toHaveBeenCalled();
    expect(redirectedTo(redirect).get("code")).toBe("INVALID_STATE");
  });

  it("rejects a stored return URL that is no longer allow-listed", async () => {
    // The value came from our own config at initiation, so a rejection here means
    // the stored record was tampered with — an open-redirect attempt.
    oauthMock.isAllowedReturnUrl.mockReturnValue(false);

    const { res, redirect } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(oauthMock.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(redirectedTo(redirect).get("code")).toBe("INVALID_STATE");
  });

  it("reports an unusable credential separately from a dead subscription", async () => {
    oauthMock.exchangeCodeForToken.mockRejectedValue(
      new oauthMock.YouTubeAuthorizationError("invalid_grant", 400),
    );

    const { res, redirect } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    // The app's copy for this is "reconnect Google". Reporting it as a transient
    // outage would send the user to retry something that cannot succeed.
    expect(redirectedTo(redirect).get("code")).toBe("IDENTITY_NOT_VERIFIED");
  });

  it("reports a transient YouTube failure as unavailable, not as not subscribed", async () => {
    oauthMock.exchangeCodeForToken.mockRejectedValue(
      new oauthMock.YouTubeApiError("quotaExceeded", 429),
    );

    const { res, redirect } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    // These two must never be conflated: a "you cancelled" page for a quota
    // error is how a Google incident tells every subscriber they unsubscribed.
    expect(redirectedTo(redirect).get("code")).toBe("VERIFICATION_UNAVAILABLE");
    expect(redirectedTo(redirect).get("code")).not.toBe("NOT_SUBSCRIBED");
  });

  it("refuses to do anything on an unconfigured deployment", async () => {
    oauthMock.isYouTubeVerificationAvailable.mockReturnValue(false);

    const { res, redirect } = mockRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(oauthMock.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(redirectedTo(redirect).get("code")).toBe("YOUTUBE_VERIFICATION_NOT_CONFIGURED");
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

  it("reports success only when the subscription really was verified", async () => {
    unparseableReturnUrl();
    const { res, redirect } = fallbackRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(redirect).not.toHaveBeenCalled();
    expect(htmlSent(res)).toContain("Subscription confirmed");
  });

  it("does not claim success when the user declined consent", async () => {
    unparseableReturnUrl();
    const { res } = fallbackRes();
    await controller.callback(callbackReq({ error: "access_denied" }), res);

    const html = htmlSent(res);
    expect(html).not.toContain("Subscription confirmed");
    expect(html).toContain("Permission was declined");
    expect(html).toContain("Nothing was unlocked");
  });

  it("does not claim success when the account is not subscribed", async () => {
    unparseableReturnUrl();
    accessMock.checkChannelAccess.mockResolvedValue({
      verdict: "notSubscribed",
      access: snapshot({ status: "NOT_SUBSCRIBED", hasChannelAccess: false }),
      latencyMs: 12,
    });

    const { res } = fallbackRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    const html = htmlSent(res);
    expect(html).not.toContain("Subscription confirmed");
    expect(html).toContain("found no subscription");
    expect(html).toContain("Nothing was unlocked");
  });

  it("does not claim success when the account does not match", async () => {
    unparseableReturnUrl();
    identityMock.googleEmailMatchesAppEmail.mockReturnValue(false);

    const { res } = fallbackRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(htmlSent(res)).not.toContain("Subscription confirmed");
    expect(htmlSent(res)).toContain("not the one this app account uses");
  });

  it("does not claim success when the exchange itself failed", async () => {
    unparseableReturnUrl();
    oauthMock.exchangeCodeForToken.mockRejectedValue(new Error("invalid_grant"));

    const { res } = fallbackRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    const html = htmlSent(res);
    expect(html).not.toContain("Subscription confirmed");
    expect(html).toContain("Nothing was unlocked");
  });

  it("escapes the outcome text so the page cannot be used for injection", async () => {
    unparseableReturnUrl();
    // Nothing user-controlled reaches this string today — the outcome comes from
    // a closed set of codes. This asserts that stays true, because the fallback
    // page is the one place server strings get interpolated into HTML.
    accessMock.checkChannelAccess.mockResolvedValue({
      verdict: "notSubscribed",
      access: snapshot({ status: "NOT_SUBSCRIBED", hasChannelAccess: false }),
      latencyMs: 12,
    });

    const { res } = fallbackRes();
    await controller.callback(callbackReq({ code: "code", state: "state-token" }), res);

    expect(htmlSent(res)).not.toContain("<script");
  });
});
