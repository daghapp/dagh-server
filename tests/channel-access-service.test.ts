import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { decryptSecret, isEncryptedPayload, encryptSecret } from "../src/helpers/encryption.js";

/**
 * Tests for the channel access service — the only place allowed to answer
 * "can this user watch this channel".
 *
 * YouTube is mocked, so a case can say what the API returned (an empty items
 * array, a 401, a timeout) and assert what we concluded, with no quota spent and
 * no network. The properties worth pinning are the ones that are invisible in a
 * happy-path test and expensive to get wrong:
 *
 *   - a lease bounds how long a confirmed positive is trusted;
 *   - a failed check never extends a lease and a confirmed negative always
 *     clears one;
 *   - a slow check cannot overwrite a fresher verdict;
 *   - no verdict is ever produced from the shape of a response rather than its
 *     content.
 */

const prismaMock = {
  channelAccess: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  videoUnlock: { deleteMany: vi.fn() },
};

const oauthMock = {
  YOUTUBE_READONLY_SCOPE: "https://www.googleapis.com/auth/youtube.readonly",
  isYouTubeVerificationAvailable: vi.fn(),
  refreshAccessToken: vi.fn(),
  checkChannelSubscription: vi.fn(),
  hasYouTubeReadonlyScope: vi.fn((granted: string | null | undefined) =>
    Boolean(granted?.split(/\s+/).includes(oauthMock.YOUTUBE_READONLY_SCOPE)),
  ),
  YouTubeAuthorizationError: class YouTubeAuthorizationError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "YouTubeAuthorizationError";
      this.status = status;
    }
  },
  getAccessLeaseMs: vi.fn(() => 60_000),
};

const redisMock = {
  client: null as null | {
    set: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  },
};

const eventsMock = { publishAccessChanged: vi.fn() };

vi.mock("../src/config/index.js", () => ({ prisma: prismaMock }));
vi.mock("../src/config/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../src/config/redis.js", () => ({
  getRedisClient: () => redisMock.client,
  redisEnabled: () => redisMock.client !== null,
}));
vi.mock("../src/services/youtube-oauth.service.js", () => oauthMock);
vi.mock("../src/services/youtube.service.js", () => ({
  resolveChannelId: vi.fn(async () => "UC123"),
}));
vi.mock("../src/helpers/community-events.js", () => eventsMock);
vi.mock("../src/helpers/communityLogger.js", () => ({
  logCommunity: vi.fn(),
  logCommunityWarn: vi.fn(),
  logCommunityError: vi.fn(),
}));

const {
  checkChannelAccess,
  classifyCheckOutcome,
  snapshotFromRow,
  noRecordSnapshot,
  reverifyLapsedAccess,
  getActiveRecheckBatchSize,
} = await import("../src/services/channel-access.service.js");

const NOW = new Date("2026-02-01T12:00:00.000Z");
const SCOPES = "openid email https://www.googleapis.com/auth/youtube.readonly";

function accessRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "access-1",
    userId: "user-1",
    channelId: "UC123",
    status: "SUBSCRIBED",
    accessVersion: 4,
    verifiedAt: new Date("2026-02-01T11:59:00.000Z"),
    accessExpiresAt: new Date("2026-02-01T12:01:00.000Z"),
    revokedAt: null,
    revokedReason: null,
    grantedScopes: SCOPES,
    refreshToken: encryptSecret("refresh-abc", "youtube:refreshToken"),
    unlockedAt: new Date("2026-01-15T00:00:00.000Z"),
    ...overrides,
  };
}

/** A row with no stored credential: nothing to re-check with. */
function linklessRow(overrides: Record<string, unknown> = {}) {
  return accessRow({
    status: "NOT_CONNECTED",
    accessVersion: 1,
    refreshToken: null,
    verifiedAt: null,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  redisMock.client = null;
  oauthMock.isYouTubeVerificationAvailable.mockReturnValue(true);
  oauthMock.hasYouTubeReadonlyScope.mockImplementation((granted: string | null | undefined) =>
    Boolean(granted?.split(/\s+/).includes(oauthMock.YOUTUBE_READONLY_SCOPE)),
  );
  oauthMock.getAccessLeaseMs.mockReturnValue(60_000);
  oauthMock.refreshAccessToken.mockResolvedValue({
    accessToken: "access-xyz",
    refreshToken: "refresh-rotated",
    scope: SCOPES,
  });
  oauthMock.checkChannelSubscription.mockResolvedValue(true);
  // Default: the CAS wins and the row comes back as it was written.
  prismaMock.channelAccess.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.channelAccess.findUnique.mockResolvedValue(accessRow());
  eventsMock.publishAccessChanged.mockResolvedValue(undefined);
  prismaMock.videoUnlock.deleteMany.mockResolvedValue({ count: 0 });
});

afterEach(() => {
  redisMock.client = null;
});

describe("classifyCheckOutcome", () => {
  it("counts a positive answer as evidence, with a usable credential", () => {
    expect(
      classifyCheckOutcome({ subscribed: true, hasCredential: true, grantedScopes: SCOPES }),
    ).toEqual({ kind: "subscribed" });
  });

  it("counts an empty items array as a confirmed negative, not a failure", () => {
    expect(
      classifyCheckOutcome({ subscribed: false, hasCredential: true, grantedScopes: SCOPES }),
    ).toEqual({ kind: "notSubscribed" });
  });

  it("treats a network or API error as inability, not as an unsubscribe", () => {
    const verdict = classifyCheckOutcome({
      subscribed: false,
      hasCredential: true,
      grantedScopes: SCOPES,
      error: new Error("socket hang up"),
    });

    expect(verdict).toEqual({ kind: "checkFailed", detail: "socket hang up" });
  });

  it("treats a rejected token as a dead credential, not as a network blip", () => {
    // These two demand opposite responses: a blip must leave access alone, a dead
    // credential means unsubscribes can no longer be detected at all.
    const verdict = classifyCheckOutcome({
      subscribed: false,
      hasCredential: true,
      grantedScopes: SCOPES,
      error: new oauthMock.YouTubeAuthorizationError("invalid_grant", 400),
    });

    expect(verdict).toMatchObject({ kind: "reauthRequired" });
  });

  it("refuses to trust an answer from a credential missing the readonly scope", () => {
    const verdict = classifyCheckOutcome({
      subscribed: true,
      hasCredential: true,
      grantedScopes: "openid email",
    });

    expect(verdict).toMatchObject({ kind: "reauthRequired" });
  });
});

describe("snapshotFromRow", () => {
  it("grants access only while a SUBSCRIBED lease is live", () => {
    const snapshot = snapshotFromRow(accessRow() as never, "UC123", NOW);

    expect(snapshot.hasChannelAccess).toBe(true);
    expect(snapshot.reason).toBeNull();
    expect(snapshot.accessVersion).toBe(4);
  });

  it("closes access on a lapsed lease without claiming an unsubscribe", () => {
    // The distinction the whole lease design exists to preserve: nobody has
    // checked since, so the verdict is stale, not negative.
    const snapshot = snapshotFromRow(
      accessRow({ accessExpiresAt: new Date("2026-02-01T11:59:59.000Z") }) as never,
      "UC123",
      NOW,
    );

    expect(snapshot.hasChannelAccess).toBe(false);
    expect(snapshot.status).toBe("SUBSCRIBED");
    expect(snapshot.reason).toBe("LEASE_EXPIRED");
  });

  it("never reports a failed check as an unsubscribe", () => {
    const snapshot = snapshotFromRow(
      accessRow({ status: "CHECK_FAILED", accessExpiresAt: null }) as never,
      "UC123",
      NOW,
    );

    expect(snapshot.status).toBe("CHECK_FAILED");
    expect(snapshot.reason).toBe("VERIFICATION_UNAVAILABLE");
    expect(snapshot.requiresGoogleConnection).toBe(false);
  });

  it("asks for a reconnect when the stored status needs one", () => {
    const snapshot = snapshotFromRow(
      accessRow({ status: "REAUTH_REQUIRED", accessExpiresAt: null }) as never,
      "UC123",
      NOW,
    );

    expect(snapshot.requiresGoogleConnection).toBe(true);
    expect(snapshot.reason).toBe("REAUTHORIZATION_REQUIRED");
  });

  it("treats a missing row as a missing link rather than a denial", () => {
    const snapshot = snapshotFromRow(null, "UC123", NOW);

    expect(snapshot).toEqual(noRecordSnapshot("UC123"));
    expect(snapshot.requiresGoogleConnection).toBe(true);
  });
});

describe("checkChannelAccess — nothing to check", () => {
  it("answers NOT_LINKED for a user who never connected Google", async () => {
    prismaMock.channelAccess.findUnique.mockResolvedValue(null);

    const result = await checkChannelAccess("user-1", "UC123", { reason: "READ", now: NOW });

    expect(result.verdict).toBe("NOT_LINKED");
    expect(result.checked).toBe(false);
    expect(result.committed).toBe(false);
    expect(result.access.hasChannelAccess).toBe(false);
    // NOT_LINKED is not CHECK_FAILED: one says "connect Google", the other says
    // "try again later", and telling a real user the wrong one is a support call.
    expect(result.access.reason).toBe("GOOGLE_NOT_CONNECTED");
    expect(oauthMock.refreshAccessToken).not.toHaveBeenCalled();
    expect(prismaMock.channelAccess.create).not.toHaveBeenCalled();
  });
});

describe("checkChannelAccess — the lease", () => {
  it("reuses a live lease for an ordinary read and spends no quota", async () => {
    const result = await checkChannelAccess("user-1", "UC123", { reason: "READ", now: NOW });

    expect(result.verdict).toBe("REUSED");
    expect(result.checked).toBe(false);
    expect(result.access.hasChannelAccess).toBe(true);
    expect(oauthMock.refreshAccessToken).not.toHaveBeenCalled();
    expect(prismaMock.channelAccess.updateMany).not.toHaveBeenCalled();
  });

  it("re-checks at login even though the lease is still live", async () => {
    // A user who unsubscribed at 11:59 and signs in at 12:00 must not be shown an
    // unlocked feed on yesterday's evidence. A session boundary is exactly where
    // yesterday's answer stops being an answer about today.
    const result = await checkChannelAccess("user-1", "UC123", { reason: "LOGIN", now: NOW });

    expect(result.checked).toBe(true);
    expect(result.verdict).toBe("subscribed");
    expect(oauthMock.checkChannelSubscription).toHaveBeenCalledWith("access-xyz", "UC123");
  });

  it("re-checks once the lease has lapsed, on any reason", async () => {
    prismaMock.channelAccess.findUnique.mockResolvedValue(
      accessRow({ accessExpiresAt: new Date("2026-02-01T11:58:00.000Z") }),
    );

    const result = await checkChannelAccess("user-1", "UC123", { reason: "READ", now: NOW });

    expect(result.checked).toBe(true);
    expect(oauthMock.checkChannelSubscription).toHaveBeenCalledOnce();
  });

  it("sets the new lease from the moment of the verdict", async () => {
    await checkChannelAccess("user-1", "UC123", { reason: "LOGIN", now: NOW });

    const data = prismaMock.channelAccess.updateMany.mock.calls[0][0].data;
    expect(data.accessExpiresAt).toEqual(new Date("2026-02-01T12:01:00.000Z"));
    expect(data.accessVersion).toEqual({ increment: 1 });
    expect(data.revokedAt).toBeNull();
    expect(data.revokedReason).toBeNull();
  });
});

describe("checkChannelAccess — unusable credentials", () => {
  it("closes a link with no stored credential, without asking Google", async () => {
    prismaMock.channelAccess.findUnique.mockResolvedValue(linklessRow());
    prismaMock.channelAccess.findUnique
      .mockResolvedValueOnce(linklessRow())
      .mockResolvedValueOnce(linklessRow({ status: "REAUTH_REQUIRED", accessExpiresAt: null }));

    const result = await checkChannelAccess("user-1", "UC123", { reason: "LOGIN", now: NOW });

    expect(result.verdict).toBe("reauthRequired");
    expect(result.checked).toBe(false);
    // A grant nobody can re-verify is a grant nobody can revoke.
    expect(result.access.requiresGoogleConnection).toBe(true);
    expect(oauthMock.refreshAccessToken).not.toHaveBeenCalled();

    const data = prismaMock.channelAccess.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe("REAUTH_REQUIRED");
    expect(data.accessExpiresAt).toBeNull();
  });

  it("does not spend a quota unit on a credential that cannot answer the question", async () => {
    prismaMock.channelAccess.findUnique
      .mockResolvedValueOnce(accessRow({ grantedScopes: "openid email" }))
      .mockResolvedValueOnce(
        accessRow({
          grantedScopes: "openid email",
          status: "REAUTH_REQUIRED",
          accessExpiresAt: null,
        }),
      );

    const result = await checkChannelAccess("user-1", "UC123", { reason: "LOGIN", now: NOW });

    expect(result.verdict).toBe("reauthRequired");
    expect(oauthMock.checkChannelSubscription).not.toHaveBeenCalled();
  });

  it("keeps the last successful check visible when a reconnect is needed", async () => {
    const verified = new Date("2026-02-01T11:00:00.000Z");
    prismaMock.channelAccess.findUnique
      .mockResolvedValueOnce(accessRow({ verifiedAt: verified, refreshToken: null }))
      .mockResolvedValueOnce(
        accessRow({
          verifiedAt: verified,
          refreshToken: null,
          status: "REAUTH_REQUIRED",
          accessExpiresAt: null,
        }),
      );

    await checkChannelAccess("user-1", "UC123", { reason: "LOGIN", now: NOW });

    // Overwriting verifiedAt would erase the evidence that access was once
    // justified, which is what an operator needs when the user asks why.
    const data = prismaMock.channelAccess.updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("verifiedAt");
  });

  it("fails closed, and leaves the lease to lapse, when the server cannot check at all", async () => {
    oauthMock.isYouTubeVerificationAvailable.mockReturnValue(false);
    prismaMock.channelAccess.findUnique.mockResolvedValue(accessRow());
    prismaMock.channelAccess.findUnique
      .mockResolvedValueOnce(accessRow())
      .mockResolvedValueOnce(accessRow({ status: "CHECK_FAILED" }));

    const result = await checkChannelAccess("user-1", "UC123", { reason: "LOGIN", now: NOW });

    expect(result.access.hasChannelAccess).toBe(false);
    expect(result.verdict).toBe("checkFailed");

    // The single most important line in this test: a deployment missing its OAuth
    // env vars must not hand out standing access, and must not truncate a real
    // subscriber's lease either. The lease is left exactly as it was — neither
    // extended nor cleared, only left to lapse on its own schedule.
    const data = prismaMock.channelAccess.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe("CHECK_FAILED");
    expect(data).not.toHaveProperty("accessExpiresAt");
    expect(data).not.toHaveProperty("verifiedAt");
    expect(data).not.toHaveProperty("revokedAt");
    expect(oauthMock.checkChannelSubscription).not.toHaveBeenCalled();
  });
});

describe("checkChannelAccess — verdicts", () => {
  it("confirms a subscription and seals the rotated refresh token", async () => {
    prismaMock.channelAccess.findUnique
      .mockResolvedValueOnce(accessRow())
      .mockResolvedValueOnce(
        accessRow({ accessVersion: 5, accessExpiresAt: new Date("2026-02-01T12:01:00.000Z") }),
      );

    const result = await checkChannelAccess("user-1", "UC123", { reason: "LOGIN", now: NOW });

    expect(result.verdict).toBe("subscribed");
    expect(result.committed).toBe(true);
    expect(result.access.hasChannelAccess).toBe(true);

    const data = prismaMock.channelAccess.updateMany.mock.calls[0][0].data;
    const sealed = data.refreshToken as string;
    // A refresh token is a live credential: a database dump must not hand over a
    // replayable grant for every subscriber.
    expect(isEncryptedPayload(sealed)).toBe(true);
    expect(sealed).not.toContain("refresh-rotated");
    expect(decryptSecret(sealed, "youtube:refreshToken")).toBe("refresh-rotated");
  });

  it("keeps the previous refresh token when the refresh does not rotate one", async () => {
    // Google's response omits refresh_token when nothing changed, and an omitted
    // value must never be read as "the credential is gone".
    oauthMock.refreshAccessToken.mockResolvedValue({
      accessToken: "access-xyz",
      refreshToken: null,
      scope: SCOPES,
    });

    await checkChannelAccess("user-1", "UC123", { reason: "LOGIN", now: NOW });

    const data = prismaMock.channelAccess.updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("refreshToken");
  });

  it("revokes access and clears the per-video rows on a confirmed negative", async () => {
    oauthMock.checkChannelSubscription.mockResolvedValue(false);
    prismaMock.channelAccess.findUnique.mockResolvedValueOnce(accessRow()).mockResolvedValueOnce(
      accessRow({
        status: "NOT_SUBSCRIBED",
        accessExpiresAt: null,
        revokedAt: NOW,
        revokedReason: "UNSUBSCRIBED",
        accessVersion: 5,
      }),
    );

    const result = await checkChannelAccess("user-1", "UC123", { reason: "LOGIN", now: NOW });

    expect(result.verdict).toBe("notSubscribed");
    expect(result.access.hasChannelAccess).toBe(false);
    expect(result.access.reason).toBe("NOT_SUBSCRIBED");

    const data = prismaMock.channelAccess.updateMany.mock.calls[0][0].data;
    // A confirmed negative is not a positive that ran out: the lease is cleared,
    // not left to expire, so nothing can read it as a live grant.
    expect(data.status).toBe("NOT_SUBSCRIBED");
    expect(data.accessExpiresAt).toBeNull();
    expect(data.revokedAt).toEqual(NOW);

    // The per-video rows are the same reward restated per card. Deleting them is
    // what makes it impossible for a stale card read to reopen anything.
    expect(prismaMock.videoUnlock.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });

  it("tells clients about the change, with the version they can compare against", async () => {
    prismaMock.channelAccess.findUnique
      .mockResolvedValueOnce(accessRow())
      .mockResolvedValueOnce(
        accessRow({ status: "NOT_SUBSCRIBED", accessExpiresAt: null, accessVersion: 5 }),
      );
    oauthMock.checkChannelSubscription.mockResolvedValue(false);

    await checkChannelAccess("user-1", "UC123", { reason: "LOGIN", now: NOW });

    // The whole snapshot, not a hand-picked subset. `reason` is what lets the
    // locked feed say "resubscribe" rather than a bare lock, and it is the piece
    // most easily lost by a caller that assembles its own payload.
    expect(eventsMock.publishAccessChanged).toHaveBeenCalledWith("user-1", {
      channelId: "UC123",
      hasChannelAccess: false,
      status: "NOT_SUBSCRIBED",
      accessVersion: 5,
      verifiedAt: "2026-02-01T11:59:00.000Z",
      accessExpiresAt: null,
      requiresGoogleConnection: false,
      reason: "NOT_SUBSCRIBED",
    });
  });

  it("clears the per-video rows before announcing the revocation", async () => {
    // A client that reacts to the event and immediately re-reads must not be able
    // to observe a window where the channel says NOT_SUBSCRIBED while the old
    // per-video unlocks are still readable.
    const order: string[] = [];
    prismaMock.videoUnlock.deleteMany.mockImplementation(async () => {
      order.push("deleteUnlocks");
      return { count: 3 };
    });
    eventsMock.publishAccessChanged.mockImplementation(async () => {
      order.push("publish");
    });
    prismaMock.channelAccess.findUnique
      .mockResolvedValueOnce(accessRow())
      .mockResolvedValueOnce(
        accessRow({ status: "NOT_SUBSCRIBED", accessExpiresAt: null, accessVersion: 5 }),
      );
    oauthMock.checkChannelSubscription.mockResolvedValue(false);

    await checkChannelAccess("user-1", "UC123", { reason: "LOGIN", now: NOW });

    expect(order).toEqual(["deleteUnlocks", "publish"]);
  });

  it("stays quiet when a re-check confirms the state the client already has", async () => {
    // A poll every 30 seconds that published every time would reset every
    // client's "what have I applied" bookkeeping for no reason.
    prismaMock.channelAccess.findUnique.mockResolvedValue(accessRow({ accessVersion: 9 }));

    await checkChannelAccess("user-1", "UC123", { reason: "LOGIN", now: NOW });

    expect(eventsMock.publishAccessChanged).not.toHaveBeenCalled();
  });

  it("records a failed check without touching the lease or the analytics rows", async () => {
    oauthMock.checkChannelSubscription.mockRejectedValue(new Error("gateway timeout"));
    prismaMock.channelAccess.findUnique
      .mockResolvedValueOnce(accessRow())
      .mockResolvedValueOnce(accessRow({ status: "CHECK_FAILED", accessVersion: 5 }));

    const result = await checkChannelAccess("user-1", "UC123", { reason: "LOGIN", now: NOW });

    expect(result.verdict).toBe("checkFailed");
    expect(result.access.hasChannelAccess).toBe(false);
    expect(result.access.reason).toBe("VERIFICATION_UNAVAILABLE");
    const data = prismaMock.channelAccess.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe("CHECK_FAILED");
    expect(data).not.toHaveProperty("accessExpiresAt");
    expect(data).not.toHaveProperty("revokedAt");
    // A check that could not be performed is not an unsubscribe.
    expect(prismaMock.videoUnlock.deleteMany).not.toHaveBeenCalled();
  });
});

describe("checkChannelAccess — races", () => {
  it("refuses to overwrite a verdict that landed first", async () => {
    prismaMock.channelAccess.updateMany.mockResolvedValue({ count: 0 });
    const winner = accessRow({
      accessVersion: 12,
      status: "NOT_SUBSCRIBED",
      accessExpiresAt: null,
    });
    prismaMock.channelAccess.findUnique
      .mockResolvedValueOnce(accessRow({ accessVersion: 4 }))
      .mockResolvedValueOnce(winner);

    const result = await checkChannelAccess("user-1", "UC123", { reason: "LOGIN", now: NOW });

    // Reports the winner's answer rather than its own stale one.
    expect(result.committed).toBe(false);
    expect(result.access.accessVersion).toBe(12);
    expect(result.access.hasChannelAccess).toBe(false);
  });

  it("matches the version it read, so a concurrent commit makes the write miss", async () => {
    await checkChannelAccess("user-1", "UC123", { reason: "LOGIN", now: NOW });

    const where = prismaMock.channelAccess.updateMany.mock.calls[0][0].where;
    expect(where.accessVersion).toBe(4);
    expect(where.verifiedAt).toEqual({ lte: expect.any(Date) });
  });

  it("collapses concurrent checks into one quota unit", async () => {
    prismaMock.channelAccess.findUnique.mockResolvedValue(
      accessRow({ accessExpiresAt: new Date("2026-02-01T11:00:00.000Z") }),
    );

    const [a, b] = await Promise.all([
      checkChannelAccess("user-1", "UC123", { reason: "PLAYBACK", now: NOW }),
      checkChannelAccess("user-1", "UC123", { reason: "PLAYBACK", now: NOW }),
    ]);

    expect(a).toBe(b);
    expect(oauthMock.checkChannelSubscription).toHaveBeenCalledOnce();
  });

  it("does not let force join a check already in flight", async () => {
    prismaMock.channelAccess.findUnique.mockResolvedValue(
      accessRow({ accessExpiresAt: new Date("2026-02-01T11:00:00.000Z") }),
    );

    const [pinned, forced] = await Promise.all([
      checkChannelAccess("user-1", "UC123", { reason: "OAUTH_CALLBACK", now: NOW }),
      // The callback holds a token minted seconds ago; deferring to an older
      // verdict would throw away better evidence.
      checkChannelAccess("user-1", "UC123", { reason: "OAUTH_CALLBACK", now: NOW, force: true }),
    ]);

    expect(forced).not.toBe(pinned);
    expect(forced.checked).toBe(true);
  });
});

describe("checkChannelAccess — multiple instances", () => {
  it("defers to another instance that is already asking, and reads its answer", async () => {
    redisMock.client = {
      set: vi.fn(async () => null),
      get: vi.fn(),
      del: vi.fn(async () => 1),
    };
    const winner = accessRow({
      accessVersion: 8,
      accessExpiresAt: new Date("2026-02-01T11:00:00.000Z"),
    });
    prismaMock.channelAccess.findUnique
      .mockResolvedValueOnce(
        accessRow({ accessVersion: 4, accessExpiresAt: new Date("2026-02-01T11:00:00.000Z") }),
      )
      .mockResolvedValueOnce(winner);

    const result = await checkChannelAccess("user-1", "UC123", { reason: "PLAYBACK", now: NOW });

    // Losing the claim is not an error, and it must not spend a second unit.
    expect(result.verdict).toBe("REUSED");
    expect(result.access.accessVersion).toBe(8);
    expect(oauthMock.checkChannelSubscription).not.toHaveBeenCalled();
  });

  it("releases the claim afterwards so the next check is not blocked", async () => {
    const del = vi.fn(async () => 1);
    redisMock.client = { set: vi.fn(async () => "OK"), get: vi.fn(), del };

    await checkChannelAccess("user-1", "UC123", { reason: "LOGIN", now: NOW });

    expect(del).toHaveBeenCalledWith("yt:access:lock:user-1:UC123");
  });
});

describe("reverifyLapsedAccess", () => {
  it("counts what it decided, and treats a failure as neither", async () => {
    const rows = [
      { userId: "a", channelId: "UC123" },
      { userId: "b", channelId: "UC123" },
      { userId: "c", channelId: "UC123" },
    ];
    prismaMock.channelAccess.findMany.mockResolvedValueOnce(rows).mockResolvedValue([]);

    // Three different outcomes, one per row: a is checkable, b has nothing to
    // check with, and c fails the same way a does.
    prismaMock.channelAccess.findUnique.mockImplementation((args: unknown) => {
      const { where } = args as { where: { id?: string; userId_channelId?: { userId: string } } };
      const userId = where.userId_channelId?.userId ?? "c";
      if (userId === "b") {
        return Promise.resolve(
          accessRow({
            userId: "b",
            accessExpiresAt: new Date("2026-02-01T11:00:00.000Z"),
            refreshToken: null,
          }),
        );
      }
      return Promise.resolve(
        accessRow({ userId, accessExpiresAt: new Date("2026-02-01T11:00:00.000Z") }),
      );
    });
    oauthMock.checkChannelSubscription.mockImplementation(async () => {
      throw new Error("upstream 503");
    });

    const summary = await reverifyLapsedAccess({ budgetMs: 60_000, batchSize: 10 });

    // Nobody is locked out by our outage: a and c lose the lease and the next
    // successful pass hands it straight back. b cannot be checked at all, ever.
    expect(summary).toMatchObject({ checked: 3, unverifiable: 1, failed: 2, revoked: 0 });
  });

  it("revokes a confirmed unsubscribe, and records it as a revocation", async () => {
    prismaMock.channelAccess.findMany
      .mockResolvedValueOnce([{ userId: "a", channelId: "UC123" }])
      .mockResolvedValue([]);
    prismaMock.channelAccess.findUnique
      .mockResolvedValueOnce(accessRow({ accessExpiresAt: new Date("2026-02-01T11:00:00.000Z") }))
      .mockResolvedValue(
        accessRow({
          accessVersion: 5,
          status: "NOT_SUBSCRIBED",
          accessExpiresAt: null,
          revokedAt: NOW,
        }),
      );
    oauthMock.checkChannelSubscription.mockResolvedValue(false);

    const summary = await reverifyLapsedAccess({ budgetMs: 60_000, batchSize: 10 });

    expect(summary).toMatchObject({ checked: 1, revoked: 1, failed: 0, budgetExhausted: false });
  });

  it("stops at the budget rather than exceeding the lock, and says it did", async () => {
    // The budget is wall-clock, so the pass has to take time to reach it: the
    // claim hook stands in for a slow Google round-trip.
    prismaMock.channelAccess.findMany.mockResolvedValue([
      { userId: "a", channelId: "UC123" },
      { userId: "b", channelId: "UC123" },
    ]);
    prismaMock.channelAccess.findUnique.mockResolvedValue(
      accessRow({ accessExpiresAt: new Date("2026-02-01T11:00:00.000Z") }),
    );

    const summary = await reverifyLapsedAccess({
      budgetMs: 40,
      batchSize: 10,
      now: () => NOW,
      shouldProcess: async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return true;
      },
    });

    expect(summary.budgetExhausted).toBe(true);
    expect(summary.checked).toBeLessThan(2);
  });

  it("yields to the per-row claim so replicas do not double-spend", async () => {
    prismaMock.channelAccess.findMany.mockResolvedValue([]);

    await reverifyLapsedAccess({
      budgetMs: 60_000,
      batchSize: 10,
      shouldProcess: () => false,
    });

    expect(oauthMock.checkChannelSubscription).not.toHaveBeenCalled();
  });

  it("does not spin on the same rows once nothing new is due", async () => {
    // A row whose check failed stays lapsed, so the predicate keeps returning it.
    // Re-querying forever would burn the whole budget re-checking one user.
    const stuck = [{ userId: "a", channelId: "UC123" }];
    prismaMock.channelAccess.findMany.mockResolvedValue(stuck);
    prismaMock.channelAccess.findUnique.mockResolvedValue(
      accessRow({ accessExpiresAt: new Date("2026-02-01T11:00:00.000Z") }),
    );
    oauthMock.checkChannelSubscription.mockRejectedValue(new Error("upstream 503"));

    const summary = await reverifyLapsedAccess({ budgetMs: 60_000, batchSize: 10, now: () => NOW });

    expect(summary.checked).toBe(1);
    expect(oauthMock.checkChannelSubscription).toHaveBeenCalledOnce();
  });
});

describe("getActiveRecheckBatchSize", () => {
  it("reads its ceiling from the environment", async () => {
    vi.stubEnv("COMMUNITY_ACTIVE_RECHECK_BATCH", "500");
    expect(getActiveRecheckBatchSize()).toBe(500);
    vi.unstubAllEnvs();
  });

  it("falls back to a bounded default when unset", () => {
    expect(getActiveRecheckBatchSize()).toBe(200);
  });
});
