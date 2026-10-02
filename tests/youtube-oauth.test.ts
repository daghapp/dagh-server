import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  buildAuthUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  checkChannelSubscription,
  fetchAuthorizedChannelId,
  hasYouTubeReadonlyScope,
  isYouTubeOAuthConfigured,
  isYouTubeVerificationAvailable,
  getAccessLeaseMs,
  getActiveRecheckSeconds,
  getYouTubeOAuthRedirectUri,
  getVerifyReturnUrl,
  isAllowedReturnUrl,
  YouTubeAuthorizationError,
  YouTubeApiError,
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
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// The tests below drive the OAuth service directly. The verdict cache and the
// signed state token that used to live here are gone: verdicts are rows in the
// database with a lease on them (channel-access.service.ts), and state/nonce
// binding is single-use server state (youtube-verify-state.ts, tested separately).
// What is asserted here is the part that cannot be asserted anywhere else — what
// Google is asked, and how each way it can answer is classified.

describe("buildAuthUrl", () => {
  it("requests identity plus readonly YouTube access, offline, with state and nonce", () => {
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_ID", "client-123");
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_SECRET", "secret-123");

    const url = new URL(buildAuthUrl({ state: "state-abc", nonce: "nonce-xyz" }));
    const scopes = (url.searchParams.get("scope") ?? "").split(" ").sort();

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(scopes).toEqual(["email", "https://www.googleapis.com/auth/youtube.readonly", "openid"]);
    // openid+email are what make the id_token carry a verified address; without
    // them the same-email check has nothing to compare against.
    expect(scopes).toContain("openid");
    expect(scopes).toContain("email");

    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://api.example.com/community/youtube/callback",
    );
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("nonce")).toBe("nonce-xyz");
    // Offline access is the only source of the refresh token that lets tomorrow's
    // login re-check the subscription without another consent screen.
    expect(url.searchParams.get("access_type")).toBe("offline");
    // Incremental: adding the YouTube scope must not revoke what is already granted.
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
  });

  it("asks for a consent screen only when the stored credential lacks the scope", () => {
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_ID", "client-123");
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_SECRET", "secret-123");

    // The common case: an already-linked subscriber re-checking. select_account,
    // not consent, so a plain re-check never re-prompts.
    const plain = new URL(buildAuthUrl({ state: "s", nonce: "n" }));
    expect(plain.searchParams.get("prompt")).toBe("select_account");

    // include_granted_scopes will not make Google offer a scope it was never
    // asked for, so a credential without the YouTube scope needs consent.
    const forced = new URL(buildAuthUrl({ state: "s", nonce: "n", forceConsent: true }));
    expect(forced.searchParams.get("prompt")).toBe("consent");
  });

  it("throws when OAuth client credentials are missing", () => {
    expect(() => buildAuthUrl({ state: "state-abc", nonce: "nonce-xyz" })).toThrow(
      /not configured/i,
    );
  });
});

describe("hasYouTubeReadonlyScope", () => {
  it("accepts a granted scope string containing the YouTube scope", () => {
    expect(
      hasYouTubeReadonlyScope("openid email https://www.googleapis.com/auth/youtube.readonly"),
    ).toBe(true);
  });

  it("rejects identity-only scopes, null and undefined", () => {
    // This is the check that decides whether a re-check can happen silently or
    // needs a consent screen, so it must not accept an identity-only grant.
    expect(hasYouTubeReadonlyScope("openid email")).toBe(false);
    expect(hasYouTubeReadonlyScope(null)).toBe(false);
    expect(hasYouTubeReadonlyScope(undefined)).toBe(false);
    expect(hasYouTubeReadonlyScope("")).toBe(false);
  });
});

describe("configuration", () => {
  it("requires both client credentials before any round-trip is possible", () => {
    expect(isYouTubeOAuthConfigured()).toBe(false);
    expect(isYouTubeVerificationAvailable()).toBe(false);

    // One half is not a credential. Completing a flow with only a client id
    // cannot produce a token, so the gate must close on it.
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_ID", "client-123");
    expect(isYouTubeOAuthConfigured()).toBe(false);
    expect(isYouTubeVerificationAvailable()).toBe(false);

    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_SECRET", "secret-123");
    expect(isYouTubeOAuthConfigured()).toBe(true);
    expect(isYouTubeVerificationAvailable()).toBe(true);
  });

  it("treats a missing target channel as its own problem, not as a working deployment", () => {
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_ID", "client-123");
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_SECRET", "secret-123");
    vi.stubEnv("YOUTUBE_CHANNEL_ID", "");
    vi.stubEnv("YOUTUBE_CHANNEL_HANDLE", "");

    // We can hold a link and still have nothing to compare it against. The
    // controller answers this with 503 YOUTUBE_VERIFICATION_NOT_CONFIGURED rather
    // than reporting an ordinary lock, so the operator can tell the difference
    // between "not subscribed" and "this deployment cannot ask".
    expect(isYouTubeVerificationAvailable()).toBe(true);
  });
});

describe("return URL allow-listing", () => {
  it("accepts the configured app scheme", () => {
    expect(getVerifyReturnUrl()).toBe("daghapp://youtube/verify");
    expect(isAllowedReturnUrl("daghapp://youtube/verify")).toBe(true);
  });

  it("rejects anything else, including a lookalike host", () => {
    // The callback redirects a browser, so this is an open-redirect boundary. A
    // substring or prefix test would accept "daghapp://youtube/verify.attacker".
    expect(isAllowedReturnUrl("https://youtube/verify")).toBe(false);
    expect(isAllowedReturnUrl("daghapp://youtube/verify.attacker.example")).toBe(false);
    expect(isAllowedReturnUrl("")).toBe(false);
  });
});

describe("lease and recheck configuration", () => {
  it("defaults the lease to 60 seconds", () => {
    vi.stubEnv("COMMUNITY_ACCESS_LEASE_SECONDS", "");
    expect(getAccessLeaseMs()).toBe(60_000);
  });

  it("honours a lease override", () => {
    vi.stubEnv("COMMUNITY_ACCESS_LEASE_SECONDS", "30");
    expect(getAccessLeaseMs()).toBe(30_000);
  });

  it("rejects a non-positive lease rather than handing out standing access", () => {
    // A zero or negative lease would mean "confirmed, but never trust it again",
    // which is the same as trusting it forever while looking configured.
    vi.stubEnv("COMMUNITY_ACCESS_LEASE_SECONDS", "0");
    expect(getAccessLeaseMs()).toBe(60_000);
  });

  it("honours an active recheck interval override", () => {
    vi.stubEnv("COMMUNITY_ACTIVE_RECHECK_SECONDS", "900");
    expect(getActiveRecheckSeconds()).toBe(900);
  });
});

describe("exchangeCodeForToken", () => {
  beforeEach(() => {
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_ID", "client-123");
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_SECRET", "secret-123");
  });

  it("exchanges an authorization code for a token and returns the id_token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ access_token: "tok-1", id_token: "jwt-1", expires_in: 3600 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const grant = await exchangeCodeForToken("code-abc");
    expect(grant.accessToken).toBe("tok-1");
    // The id_token is the only thing that carries a verified email, so losing it
    // here would cost the same-email check entirely.
    expect(grant.idToken).toBe("jwt-1");
    expect(grant.expiresIn).toBe(3600);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://oauth2.googleapis.com/token");
    expect(String(init.body)).toContain("code=code-abc");
    expect(String(init.body)).toContain("grant_type=authorization_code");
    expect(String(init.body)).toContain("client_id=client-123");
    // Must match the URL the browser was sent to, or Google rejects the code.
    expect(String(init.body)).toContain(
      encodeURIComponent("https://api.example.com/community/youtube/callback"),
    );
  });

  it("returns the refresh token when Google issues one", async () => {
    // The refresh token is what makes a link re-verifiable, so it must survive the
    // exchange rather than being dropped on the floor.
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ access_token: "tok-1", refresh_token: "refresh-1", expires_in: 3600 }),
        ),
    );

    const grant = await exchangeCodeForToken("code-abc");
    expect(grant.refreshToken).toBe("refresh-1");
  });

  it("reports an omitted refresh_token as null, not as a revocation", async () => {
    // Google omits refresh_token on every exchange after the first. Reading that
    // omission as "no credential" would silently unlink returning users.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ access_token: "tok-1", expires_in: 3600 })),
    );

    const grant = await exchangeCodeForToken("code-abc");
    expect(grant.refreshToken).toBeNull();
  });

  it("records the scope Google actually granted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          access_token: "tok-1",
          scope: "openid email https://www.googleapis.com/auth/youtube.readonly",
        }),
      ),
    );

    const grant = await exchangeCodeForToken("code-abc");
    expect(hasYouTubeReadonlyScope(grant.scope)).toBe(true);
  });

  it("classifies a rejected exchange as an authorization error", async () => {
    // 400 means the credential is unusable — a dead grant that can never answer
    // the question again. It must NOT be lumped in with transient faults, which
    // are retried and must never become an unsubscribe event.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400)),
    );

    const failure = await exchangeCodeForToken("bad-code").catch((error) => error);
    expect(failure).toBeInstanceOf(YouTubeAuthorizationError);
    expect(failure.status).toBe(400);
    expect(failure.message).toContain("invalid_grant");
  });

  it("throws when OAuth credentials are missing", async () => {
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_ID", "");
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_SECRET", "");
    await expect(exchangeCodeForToken("code")).rejects.toThrow(/not configured/i);
  });
});

describe("refreshAccessToken", () => {
  beforeEach(() => {
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_ID", "client-123");
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_SECRET", "secret-123");
  });

  it("mints a new access token from a stored refresh token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: "tok-2", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);

    const grant = await refreshAccessToken("refresh-1");
    expect(grant.accessToken).toBe("tok-2");
    // Google normally omits refresh_token on a refresh, so the caller's
    // credential must be carried through or the next sweep has nothing to use.
    expect(grant.refreshToken).toBe("refresh-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://oauth2.googleapis.com/token");
    expect(String(init.body)).toContain("refresh_token=refresh-1");
    expect(String(init.body)).toContain("grant_type=refresh_token");
  });

  it("adopts a rotated refresh token when Google returns one", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ access_token: "tok-2", refresh_token: "refresh-2" })),
    );

    const grant = await refreshAccessToken("refresh-1");
    expect(grant.refreshToken).toBe("refresh-2");
  });

  it("treats a spent refresh token as an authorization error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400)),
    );

    // This is the difference between "reconnect your Google account" and "we could
    // not ask just now". The caller maps it to REAUTH_REQUIRED, which is the only
    // path that legitimately closes a link without YouTube's say-so.
    const failure = await refreshAccessToken("spent").catch((error) => error);
    expect(failure).toBeInstanceOf(YouTubeAuthorizationError);
  });

  it("throws when OAuth credentials are missing", async () => {
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_ID", "");
    vi.stubEnv("YOUTUBE_OAUTH_CLIENT_SECRET", "");
    await expect(refreshAccessToken("refresh-1")).rejects.toThrow(/not configured/i);
  });
});

describe("checkChannelSubscription", () => {
  it("reports subscribed for a non-empty items array", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [{ id: "sub-1" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkChannelSubscription("tok-1", "UC123")).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.hostname).toBe("www.googleapis.com");
    expect(parsed.pathname).toBe("/youtube/v3/subscriptions");
    // mine=true answers for whichever account owns the bearer token, so a
    // credential for the wrong Google account returns someone else's answer.
    expect(parsed.searchParams.get("mine")).toBe("true");
    expect(parsed.searchParams.get("forChannelId")).toBe("UC123");
    // part=id is the cheapest response that still distinguishes empty from not.
    expect(parsed.searchParams.get("part")).toBe("id");
    // One row is enough to know; asking for more only spends quota.
    expect(parsed.searchParams.get("maxResults")).toBe("1");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
  });

  it("reports not subscribed for an empty items array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ items: [] })));
    await expect(checkChannelSubscription("tok-1", "UC123")).resolves.toBe(false);
  });

  it("refuses to read a missing items array as an unsubscribe", async () => {
    // A 200 we cannot parse is a fault, not an answer. Treating it as an empty
    // list is precisely how a Google blip becomes a mass lockout, so it throws —
    // and specifically as a transient fault, which callers map to CHECK_FAILED
    // rather than to the confirmed-negative path that revokes.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ kind: "youtube#list" })));

    const failure = await checkChannelSubscription("tok-1", "UC123").catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(YouTubeAuthorizationError);
    expect(failure).not.toBeInstanceOf(YouTubeApiError);
    expect(failure.name).toBe("YouTubeTransientError");
  });

  it("raises an authorization error for 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { message: "nope" } }, 401)),
    );

    const failure = await checkChannelSubscription("tok-1", "UC123").catch((error) => error);
    expect(failure).toBeInstanceOf(YouTubeAuthorizationError);
    expect(failure.status).toBe(401);
  });

  it("keeps 429 and 5xx out of the authorization class", async () => {
    // These are retried. If they landed in YouTubeAuthorizationError the sweep
    // would revoke every lease during a quota or outage event.
    for (const status of [429, 500, 503]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, status)));
      const failure = await checkChannelSubscription("tok-1", "UC123").catch((error) => error);
      expect(failure).toBeInstanceOf(YouTubeApiError);
      expect(failure).not.toBeInstanceOf(YouTubeAuthorizationError);
      expect(failure.status).toBe(status);
    }
  });
});

describe("fetchAuthorizedChannelId", () => {
  it("returns the authorized account's channel id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ items: [{ id: "UC-own" }] })));
    await expect(fetchAuthorizedChannelId("tok-1")).resolves.toBe("UC-own");
  });

  it("swallows failures instead of failing the link", async () => {
    // Diagnostic only. "We could not find out which channel this is" must never
    // stop a legitimate link from being recorded.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { message: "nope" } }, 403)),
    );
    await expect(fetchAuthorizedChannelId("tok-1")).resolves.toBeNull();
  });
});

describe("redirect URI", () => {
  // Both vars are stubbed deliberately. Leaving API_URL to ambient state made this
  // test pass on a developer machine with a .env and fail on CI, which has none.
  it("derives it from API_URL when the explicit URI is unset", () => {
    // Derived from the API URL when unset, but the OAuth redirect URI has to be
    // registered with Google exactly, so a wrong default fails at the exchange.
    vi.stubEnv("YOUTUBE_OAUTH_REDIRECT_URI", "");
    vi.stubEnv("API_URL", "https://api.example.com");
    expect(getYouTubeOAuthRedirectUri()).toBe("https://api.example.com/community/youtube/callback");
  });

  it("prefers the explicit URI over the derived one", () => {
    vi.stubEnv("YOUTUBE_OAUTH_REDIRECT_URI", "https://oauth.example.com/cb");
    vi.stubEnv("API_URL", "https://api.example.com");
    expect(getYouTubeOAuthRedirectUri()).toBe("https://oauth.example.com/cb");
  });

  it("throws when neither is configured", () => {
    // isYouTubeVerificationAvailable() is only false when this throws, so the
    // throw is load-bearing for the availability check — not just a guard.
    vi.stubEnv("YOUTUBE_OAUTH_REDIRECT_URI", "");
    vi.stubEnv("API_URL", "");
    expect(() => getYouTubeOAuthRedirectUri()).toThrow(/YOUTUBE_OAUTH_REDIRECT_URI or API_URL/);
  });
});
