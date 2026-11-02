import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAppleSignInConfig, isAppleSignInConfigured } from "../src/config/apple.js";

const BASE = {
  APPLE_CLIENT_ID: "com.example.service.signin",
  APPLE_TEAM_ID: "TEAMID1234",
  APPLE_KEY_ID: "KEYID12345",
  APPLE_CALLBACK_URL: "https://example.test/auth/apple/callback",
};

function setBaseEnv() {
  for (const [key, value] of Object.entries(BASE)) vi.stubEnv(key, value);
}

describe("Apple Sign In configuration", () => {
  beforeEach(() => {
    vi.stubEnv("APPLE_PRIVATE_KEY", "");
    vi.stubEnv("APPLE_PRIVATE_KEY_PATH", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is unconfigured without a private key", () => {
    setBaseEnv();
    expect(getAppleSignInConfig()).toBeNull();
    expect(isAppleSignInConfigured()).toBe(false);
  });

  it("accepts an inline private key with escaped newlines", () => {
    setBaseEnv();
    vi.stubEnv(
      "APPLE_PRIVATE_KEY",
      "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
    );

    const config = getAppleSignInConfig();
    expect(config).toEqual(
      expect.objectContaining({
        clientID: BASE.APPLE_CLIENT_ID,
        teamID: BASE.APPLE_TEAM_ID,
        keyID: BASE.APPLE_KEY_ID,
        callbackURL: BASE.APPLE_CALLBACK_URL,
        privateKeyString: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      }),
    );
    expect(config?.privateKeyLocation).toBeUndefined();
    expect(isAppleSignInConfigured()).toBe(true);
  });

  it("prefers an inline key over a path", () => {
    setBaseEnv();
    vi.stubEnv("APPLE_PRIVATE_KEY_PATH", join(process.cwd(), "package.json"));
    vi.stubEnv("APPLE_PRIVATE_KEY", "inline-key");

    const config = getAppleSignInConfig();
    expect(config?.privateKeyString).toBe("inline-key");
    expect(config?.privateKeyLocation).toBeUndefined();
  });

  it("accepts an existing key path", () => {
    setBaseEnv();
    vi.stubEnv("APPLE_PRIVATE_KEY_PATH", join(process.cwd(), "package.json"));

    const config = getAppleSignInConfig();
    expect(config?.privateKeyLocation).toBe(join(process.cwd(), "package.json"));
    expect(config?.privateKeyString).toBeUndefined();
  });

  it("treats a missing key path as unconfigured", () => {
    setBaseEnv();
    vi.stubEnv("APPLE_PRIVATE_KEY_PATH", join(process.cwd(), "does-not-exist.p8"));
    expect(getAppleSignInConfig()).toBeNull();
  });
});
