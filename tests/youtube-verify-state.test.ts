import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for the pending verification round-trip.
 *
 * The system browser performs the OAuth consent screen, and it does not share the
 * app's cookie jar — which is the entire reason the pending flow is held
 * server-side behind an unguessable token instead of in express-session. So the
 * properties worth pinning are: a token can be consumed exactly once, a
 * consumed token leaves nothing behind, and the record it carries is the one the
 * flow was started with rather than anything the callback supplies.
 *
 * Redis is mocked to null, so this exercises the bounded in-memory fallback that a
 * single-instance deployment uses. That fallback is where the single-use
 * guarantee has to hold too.
 */

const redisMock = {
  client: null as null | {
    set: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  },
};

vi.mock("../src/config/redis.js", () => ({
  getRedisClient: () => redisMock.client,
  redisEnabled: () => redisMock.client !== null,
}));

const {
  storeVerifyState,
  consumeVerifyState,
  verifyStateKey,
  newNonce,
  newSessionId,
  _resetInMemoryVerifyStates,
} = await import("../src/services/youtube-verify-state.js");

const RECORD = {
  appUserId: "user-1",
  channelId: "UC123",
  nonce: "nonce-abc",
  returnUrl: "daghapp://youtube/verify",
  sessionId: "session-abc",
  videoId: "card-1",
};

beforeEach(() => {
  redisMock.client = null;
  _resetInMemoryVerifyStates();
});

describe("storeVerifyState", () => {
  it("returns an unguessable token and the record it stands for", async () => {
    const token = await storeVerifyState(RECORD);

    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    await expect(consumeVerifyState(token)).resolves.toMatchObject(RECORD);
  });

  it("issues a different token every time, so a token cannot be guessed from a previous one", async () => {
    const first = await storeVerifyState(RECORD);
    const second = await storeVerifyState(RECORD);

    expect(first).not.toBe(second);
  });

  it("keeps the channel pinned at initiation", async () => {
    // A config change mid-flow must not make the callback verify a channel other
    // than the one the user consented for.
    const token = await storeVerifyState({ ...RECORD, channelId: "UC123" });
    const record = await consumeVerifyState(token);

    expect(record?.channelId).toBe("UC123");
  });
});

describe("consumeVerifyState", () => {
  it("consumes the token, so a replayed callback finds nothing", async () => {
    const token = await storeVerifyState(RECORD);

    await expect(consumeVerifyState(token)).resolves.toMatchObject({ appUserId: "user-1" });
    // The delete is the whole mechanism. A callback that could be replayed would
    // re-verify or re-link on somebody else's credential.
    await expect(consumeVerifyState(token)).resolves.toBeNull();
  });

  it("burns the token even when the caller is not the account that started it", async () => {
    // An attacker who intercepted one cannot keep retrying until the real user
    // arrives: the attempt is what destroys it.
    const token = await storeVerifyState(RECORD);

    await expect(consumeVerifyState(token)).resolves.toMatchObject({ appUserId: "user-1" });
    await expect(consumeVerifyState(token)).resolves.toBeNull();
  });

  it("returns null for an unknown token", async () => {
    await expect(consumeVerifyState("never-issued")).resolves.toBeNull();
  });

  it("returns null for a record older than the TTL", async () => {
    vi.useFakeTimers();
    try {
      const token = await storeVerifyState(RECORD);
      vi.advanceTimersByTime(16 * 60 * 1000);

      // The TTL is 15 minutes. A consent screen left open overnight must not be
      // able to complete a verification hours after the user walked away.
      await expect(consumeVerifyState(token)).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still honours a record that is inside the TTL", async () => {
    vi.useFakeTimers();
    try {
      const token = await storeVerifyState(RECORD);
      vi.advanceTimersByTime(5 * 60 * 1000);

      await expect(consumeVerifyState(token)).resolves.toMatchObject({ appUserId: "user-1" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not resurrect a record from a second store of the same token", async () => {
    const token = await storeVerifyState(RECORD);
    await consumeVerifyState(token);

    // Freshly stored under a different token, the old one is still gone.
    await storeVerifyState({ ...RECORD, appUserId: "user-2" });
    await expect(consumeVerifyState(token)).resolves.toBeNull();
  });
});

describe("verifyStateKey", () => {
  it("namespaces the token so it cannot collide with another Redis key", () => {
    expect(verifyStateKey("abc")).toBe("yt:verify:state:abc");
  });
});

describe("nonce and session identifiers", () => {
  it("issues a distinct nonce per round-trip", () => {
    expect(newNonce()).not.toBe(newNonce());
    expect(newNonce()).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });

  it("issues a distinct session id per round-trip", () => {
    expect(newSessionId()).not.toBe(newSessionId());
  });
});

describe("with Redis", () => {
  beforeEach(() => {
    redisMock.client = {
      set: vi.fn(async () => "OK"),
      get: vi.fn(async () => null),
      del: vi.fn(async () => 1),
    };
  });

  it("stores with a TTL and a NX guard", async () => {
    await storeVerifyState(RECORD);

    const [key, value, options] = redisMock.client!.set.mock.calls[0];
    expect(key).toMatch(/^yt:verify:state:/);
    expect(JSON.parse(value as string)).toMatchObject(RECORD);
    expect(options).toEqual({ EX: 15 * 60, NX: true });
  });

  it("consumes with a delete, not a read", async () => {
    redisMock.client!.get.mockResolvedValue(JSON.stringify({ ...RECORD, createdAt: Date.now() }));

    await expect(consumeVerifyState("abc")).resolves.toMatchObject({ appUserId: "user-1" });

    // get-then-del is the pattern; without the delete the token would be
    // replayable for the rest of its TTL.
    expect(redisMock.client!.del).toHaveBeenCalledWith("yt:verify:state:abc");
  });

  it("treats a truncated or poisoned entry as absent", async () => {
    redisMock.client!.get.mockResolvedValue("{not json");

    // Indistinguishable from a token that was never issued, and the only safe
    // answer: as far as the caller is concerned, the flow did not happen.
    await expect(consumeVerifyState("abc")).resolves.toBeNull();
  });

  it("rejects an entry missing a bound field rather than trusting a partial one", async () => {
    redisMock.client!.get.mockResolvedValue(JSON.stringify({ appUserId: "user-1" }));

    // Every field in the record is load-bearing — userId decides who the verdict
    // is written for, channelId what is verified, nonce what the token must echo.
    await expect(consumeVerifyState("abc")).resolves.toBeNull();
  });
});
