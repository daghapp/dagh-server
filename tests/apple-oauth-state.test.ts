import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAppleOAuthState,
  verifyAppleOAuthState,
} from "../src/modules/authentication/apple-oauth-state.js";
import { buildAppCallbackUrlWithFragment } from "../src/modules/authentication/oauth-state.js";

describe("Apple OAuth state", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_ACCESS_SECRET", "test-state-secret");
    vi.stubEnv("APPLE_OAUTH_STATE_SECRET", "");
    vi.stubEnv("APP_OAUTH_REDIRECTS", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips the app redirect and nonce hash", () => {
    const { state, nonceHash } = createAppleOAuthState("diasporansync:///oauth");
    expect(verifyAppleOAuthState(state)).toMatchObject({
      appRedirect: "diasporansync:///oauth",
      nonceHash,
    });
  });

  it("falls back to the default destination when the redirect is not allowlisted", () => {
    const { state } = createAppleOAuthState("https://evil.test/callback");
    expect(verifyAppleOAuthState(state).appRedirect).toBe("diasporansync:///oauth");
  });

  it("honors additional allowlisted destinations", () => {
    vi.stubEnv("APP_OAUTH_REDIRECTS", "diasporansync:///oauth, diasporansync://callback");
    const { state } = createAppleOAuthState("diasporansync://callback");
    expect(verifyAppleOAuthState(state).appRedirect).toBe("diasporansync://callback");
  });

  it("rejects tampered state", () => {
    const { state } = createAppleOAuthState();
    expect(() => verifyAppleOAuthState(`${state}tampered`)).toThrow("INVALID_APPLE_OAUTH_STATE");
  });

  it("builds the app callback with tokens in the fragment", () => {
    expect(
      buildAppCallbackUrlWithFragment("diasporansync:///oauth", {
        accessToken: "access",
        refreshToken: "refresh",
        email: "user@example.com",
      }),
    ).toBe(
      "diasporansync:///oauth#accessToken=access&refreshToken=refresh&email=user%40example.com",
    );
  });
});
