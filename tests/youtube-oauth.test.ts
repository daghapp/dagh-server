import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  buildAuthUrl,
  signVerifyState,
  verifyStateToken,
  exchangeCodeForToken,
  checkChannelSubscription,
  getCachedVerification,
  setCachedVerification,
} from "../src/services/youtube-oauth.service.js";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

beforeEach(() => {
  vi.stubEnv("YOUTUBE_API_KEY", "");
  vi.stubEnv("YOUTUBE_CHANNEL_ID", "");
  vi.stubEnv("YOUTUBE_CHANNEL_HANDLE", "");
  vi.stubEnv("YOUTUBE_OAUTH_CLIENT_ID", "");
  vi.stubEnv("YOUTUBE_OAUTH_CLIENT_SECRET", "");
  vi.stubEnv("YOUTUBE_OAUTH_REDIRECT_URI", "https://api.example.com/community/youtube/callback");
  vi.stubEnv("YOUTUBE_VERIFY_RETURN_URL", "daghapp://youtube/verify");
  vi.stubEnv("YOUTUBE_VERIFY_CACHE_MS", "3600000");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("buildAuthUrl", () => {
  it("builds an authorization URL with the readonly scope and state", () => {
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_ID", "client-123");
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_SECRET", "secret-123");

    const url = new URL(buildAuthUrl("state-abc"));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/youtube.readonly");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://api.example.com/community/youtube/callback",
    );
    expect(url.searchParams.get("state")).toBe("state-abc");
  });

  it("throws when OAuth client credentials are missing", () => {
    expect(() => buildAuthUrl("state-abc")).toThrow(/not configured/i);
  });
});

describe("verify state token", () => {
  it("round-trips userId and videoId", () => {
    const token = signVerifyState("user-1", "video-1");
    expect(verifyStateToken(token)).toEqual({ userId: "user-1", videoId: "video-1" });
  });

  it("rejects a tampered token", () => {
    const token = signVerifyState("user-1", "video-1");
    expect(() => verifyStateToken(`${token}x`)).toThrow();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    const token = signVerifyState("user-1", "video-1");
    vi.advanceTimersByTime(16 * 60 * 1000);
    expect(() => verifyStateToken(token)).toThrow();
  });
});

describe("exchangeCodeForToken", () => {
  it("exchanges an authorization code for a token", async () => {
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_ID", "client-123");
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_SECRET", "secret-123");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: "tok-1", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);

    const token = await exchangeCodeForToken("code-abc");
    expect(token).toBe("tok-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://oauth2.googleapis.com/token");
    expect(String(init.body)).toContain("code=code-abc");
    expect(String(init.body)).toContain("grant_type=authorization_code");
    expect(String(init.body)).toContain("client_id=client-123");
  });

  it("throws when Google rejects the exchange", async () => {
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_ID", "client-123");
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_SECRET", "secret-123");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400)),
    );

    await expect(exchangeCodeForToken("bad-code")).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("invalid_grant"),
    });
  });

  it("throws when OAuth credentials are missing", async () => {
    await expect(exchangeCodeForToken("code")).rejects.toThrow(/not configured/i);
  });
});

describe("checkChannelSubscription", () => {
  it("returns true when the user is subscribed to the channel", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [{ snippet: { channelId: "UC123" } }] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkChannelSubscription("tok-1", "UC123")).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.hostname).toBe("www.googleapis.com");
    expect(parsed.pathname).toBe("/youtube/v3/subscriptions");
    expect(parsed.searchParams.get("mine")).toBe("true");
    expect(parsed.searchParams.get("forChannelId")).toBe("UC123");
    expect(init.headers.Authorization).toBe("Bearer tok-1");
  });

  it("returns false when the user is not subscribed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ items: [] })));
    await expect(checkChannelSubscription("tok-1", "UC123")).resolves.toBe(false);
  });

  it("throws YouTubeApiError with the upstream status on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { message: "nope" } }, 401)),
    );
    await expect(checkChannelSubscription("tok-1", "UC123")).rejects.toMatchObject({
      status: 401,
      message: "nope",
    });
  });
});

describe("verification cache", () => {
  it("stores and retrieves a verdict (in-memory fallback)", async () => {
    await setCachedVerification("user-1", true);
    const cached = await getCachedVerification("user-1");
    expect(cached?.subscribed).toBe(true);
    expect(cached?.verifiedAt).toBeTruthy();
  });

  it("returns null when nothing is cached", async () => {
    await expect(getCachedVerification("nobody")).resolves.toBeNull();
  });

  it("expires entries after the configured TTL", async () => {
    vi.stubEnv("YOUTUBE_VERIFY_CACHE_MS", "100");
    await setCachedVerification("user-1", false);
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    await expect(getCachedVerification("user-1")).resolves.toBeNull();
  });
});
