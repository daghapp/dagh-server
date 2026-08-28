import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isLiveKitConfigured, generateLiveKitRoomToken } from "../src/helpers/livekit.js";
import { getCallServiceUrl } from "../src/helpers/call-service.js";

const LIVEKIT_VARS = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"];

describe("isLiveKitConfigured", () => {
  beforeEach(() => {
    LIVEKIT_VARS.forEach((key) => vi.stubEnv(key, ""));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns false when LiveKit env vars are missing", () => {
    expect(isLiveKitConfigured()).toBe(false);
  });

  it("returns false when any LiveKit env var is missing", () => {
    vi.stubEnv("LIVEKIT_URL", "wss://media.example.com");
    vi.stubEnv("LIVEKIT_API_KEY", "key");
    expect(isLiveKitConfigured()).toBe(false);
  });

  it("returns true when all LiveKit env vars are set", () => {
    vi.stubEnv("LIVEKIT_URL", "wss://media.example.com");
    vi.stubEnv("LIVEKIT_API_KEY", "key");
    vi.stubEnv("LIVEKIT_API_SECRET", "secret");
    expect(isLiveKitConfigured()).toBe(true);
  });
});

describe("generateLiveKitRoomToken", () => {
  beforeEach(() => {
    LIVEKIT_VARS.forEach((key) => vi.stubEnv(key, ""));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when LiveKit is not configured", async () => {
    const token = await generateLiveKitRoomToken({
      roomId: "room-1",
      identity: "user-1",
    });
    expect(token).toBeNull();
  });
});

describe("getCallServiceUrl", () => {
  const SERVICE_VARS = ["LIVEKIT_URL", "CALL_SERVICE_URL", "API_URL"];
  beforeEach(() => {
    SERVICE_VARS.forEach((key) => vi.stubEnv(key, ""));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns empty string when no call service env vars are set", () => {
    expect(getCallServiceUrl()).toBe("");
  });

  it("prefers LIVEKIT_URL over CALL_SERVICE_URL and API_URL", () => {
    vi.stubEnv("LIVEKIT_URL", "wss://media.example.com");
    vi.stubEnv("CALL_SERVICE_URL", "https://calls.example.com");
    vi.stubEnv("API_URL", "https://api.example.com");
    expect(getCallServiceUrl()).toBe("wss://media.example.com");
  });

  it("falls back to CALL_SERVICE_URL when LIVEKIT_URL is unset", () => {
    vi.stubEnv("CALL_SERVICE_URL", "https://calls.example.com");
    vi.stubEnv("API_URL", "https://api.example.com");
    expect(getCallServiceUrl()).toBe("https://calls.example.com");
  });

  it("falls back to API_URL when only it is set", () => {
    vi.stubEnv("API_URL", "https://api.example.com");
    expect(getCallServiceUrl()).toBe("https://api.example.com");
  });

  it("trims surrounding whitespace from env values", () => {
    vi.stubEnv("LIVEKIT_URL", "  wss://media.example.com  ");
    expect(getCallServiceUrl()).toBe("wss://media.example.com");
  });
});
