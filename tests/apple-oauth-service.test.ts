import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAppleAuthorizeUrl } from "../src/services/apple-oauth.service.js";

describe("Apple authorize URL", () => {
  beforeEach(() => {
    vi.stubEnv("APPLE_CLIENT_ID", "com.example.service.signin");
    vi.stubEnv("APPLE_TEAM_ID", "TEAMID1234");
    vi.stubEnv("APPLE_KEY_ID", "KEYID12345");
    vi.stubEnv("APPLE_CALLBACK_URL", "https://example.test/auth/apple/callback");
    vi.stubEnv("APPLE_PRIVATE_KEY", "inline-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends Apple the HTTPS backend callback and form_post response mode", () => {
    const url = new URL(buildAppleAuthorizeUrl("state-123", "nonce-hash"));
    expect(url.searchParams.get("redirect_uri")).toBe("https://example.test/auth/apple/callback");
    expect(url.searchParams.get("response_mode")).toBe("form_post");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("name email");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("nonce")).toBe("nonce-hash");
  });

  it("uses the production callback when the configured value is an app scheme", () => {
    vi.stubEnv("APPLE_CALLBACK_URL", "diasporansync:///oauth");
    const url = new URL(buildAppleAuthorizeUrl("state-123", "nonce-hash"));
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://dagh-server-fo64.onrender.com/auth/apple/callback",
    );
  });
});
