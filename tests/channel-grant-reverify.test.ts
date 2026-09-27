import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import { decryptSecret, isEncryptedPayload, _resetEncryptionKeyCache } from "../src/helpers/encryption.js";

/**
 * A YouTube subscription is mutable from outside our system, so a grant written
 * once cannot stay authoritative forever. These tests pin the re-verification
 * sweep: it must revoke a cancelled subscription, and — just as importantly — it
 * must NOT revoke for any other reason. Failing closed here would lock out
 * paying subscribers, so every ambiguous case (API error, expired token, missing
 * credential) has to leave access intact.
 */

const prismaMock = {
  channelUnlock: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  videoUnlock: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  communityVideo: { findMany: vi.fn(), count: vi.fn() },
  $transaction: vi.fn(),
};

const oauthMock = {
  isYouTubeOAuthConfigured: vi.fn(() => true),
  refreshAccessToken: vi.fn(),
  checkChannelSubscription: vi.fn(),
  getCachedVerification: vi.fn(),
  getChannelReverifyIntervalMs: vi.fn(() => 24 * 60 * 60 * 1000),
};

vi.mock("../src/config/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../src/config/index.js", () => ({ prisma: prismaMock }));
vi.mock("../src/services/youtube-oauth.service.js", () => oauthMock);

const {
  reverifyChannelGrants,
  revokeChannelAccess,
  getChannelAccess,
  listVideosForUser,
  listChannelGrants,
  reencryptLegacyRefreshTokens,
} = await import("../src/services/community.service.js");

/**
 * A payload that looks sealed but was sealed under a different key — what a
 * rotated `PAYMENT_GATEWAY_ENCRYPTION_KEY` leaves behind in the table. Built by
 * hand rather than via the service, because the service cannot produce one: its
 * own sealer always uses the live key.
 */
function sealUnderForeignKey(value = "refresh-1"): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", randomBytes(32), iv);
  cipher.setAAD(Buffer.from("youtube:refreshToken", "utf8"));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    body.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(":");
}

/**
 * Produces a genuinely sealed token by having the service seal one and
 * capturing what it wrote, so the admin read-back exercises the real crypto
 * rather than a re-implementation that could drift from it.
 */
async function sealViaService(value = "refresh-1"): Promise<string> {
  prismaMock.channelUnlock.findMany.mockResolvedValue([
    { id: "g", userId: "user-1", channelId: "UC123", refreshToken: value },
  ]);
  prismaMock.channelUnlock.update.mockResolvedValue({});
  await reencryptLegacyRefreshTokens();
  return prismaMock.channelUnlock.update.mock.calls[0][0].data.refreshToken as string;
}

/** An active, re-verifiable grant: a stored refresh token and a stale verdict. */
const GRANT = {
  id: "grant-1",
  userId: "user-1",
  channelId: "UC123",
  refreshToken: "refresh-1",
};

const NOW = new Date("2026-03-01T03:17:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.channelUnlock.findMany.mockResolvedValue([GRANT]);
  prismaMock.channelUnlock.count.mockResolvedValue(0);
  prismaMock.channelUnlock.update.mockResolvedValue({});
  prismaMock.channelUnlock.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.videoUnlock.deleteMany.mockResolvedValue({ count: 2 });
  prismaMock.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
  oauthMock.isYouTubeOAuthConfigured.mockReturnValue(true);
  oauthMock.getChannelReverifyIntervalMs.mockReturnValue(24 * 60 * 60 * 1000);
  oauthMock.refreshAccessToken.mockResolvedValue({
    accessToken: "access-1",
    refreshToken: "refresh-1",
  });
  oauthMock.checkChannelSubscription.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("reverifyChannelGrants", () => {
  it("revokes a grant whose subscription was cancelled", async () => {
    // The reported bug: unsubscribing on YouTube left the feed open because
    // nothing ever re-checked. An empty items list from the subscriptions API is
    // a definite negative verdict, so this is the one path that revokes.
    oauthMock.checkChannelSubscription.mockResolvedValue(false);

    const summary = await reverifyChannelGrants({ now: NOW });

    expect(summary.revoked).toBe(1);
    expect(prismaMock.channelUnlock.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        channelId: "UC123",
        revokedAt: null,
        lastVerifiedAt: { lte: NOW },
      },
      data: { revokedAt: expect.any(Date), revokedReason: "UNSUBSCRIBED" },
    });
  });

  it("skips a negative verdict on a grant re-confirmed after the pass began", async () => {
    // lastVerifiedAt is part of the revocation predicate, so a grant
    // re-confirmed by a concurrent OAuth callback is never closed on the older
    // negative verdict this pass is holding.
    oauthMock.checkChannelSubscription.mockResolvedValue(false);
    prismaMock.channelUnlock.updateMany.mockResolvedValue({ count: 0 });

    const summary = await reverifyChannelGrants({ now: NOW });

    expect(summary.revoked).toBe(0);
    expect(summary.superseded).toBe(1);
    expect(prismaMock.videoUnlock.deleteMany).not.toHaveBeenCalled();
  });

  it("revokes the per-video unlocks too, so the cancelled subscriber loses the videos", async () => {
    // A per-video VideoUnlock row is the same subscription restated per card.
    // Revoking only the channel grant would leave every already-unlocked video
    // watchable, because getUnlockStatus falls back to the per-video row.
    oauthMock.checkChannelSubscription.mockResolvedValue(false);

    await reverifyChannelGrants({ now: NOW });

    expect(prismaMock.videoUnlock.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });

  it("re-confirms a still-subscribed grant instead of revoking it", async () => {
    const summary = await reverifyChannelGrants({ now: NOW });

    expect(summary.stillSubscribed).toBe(1);
    expect(summary.revoked).toBe(0);
    expect(prismaMock.channelUnlock.updateMany).not.toHaveBeenCalled();
    // The staleness marker is what stops the next run re-checking this grant.
    const args = prismaMock.channelUnlock.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: "grant-1" });
    expect(args.data.lastVerifiedAt).toBe(NOW);
    // Re-sealed on the way back in, so a row is migrated off plaintext storage
    // the first time the sweep successfully re-checks it.
    expect(isEncryptedPayload(args.data.refreshToken)).toBe(true);
    expect(args.data.refreshToken).not.toContain("refresh-1");
    expect(decryptSecret(args.data.refreshToken, "youtube:refreshToken")).toBe("refresh-1");
  });

  it("keeps access when the check errors — a Google outage is not an unsubscribe", async () => {
    // The single most important property here. Revoking on an indeterminate
    // result would mass-lock every subscriber during an outage.
    oauthMock.checkChannelSubscription.mockRejectedValue(new Error("quota exceeded"));

    const summary = await reverifyChannelGrants({ now: NOW });

    expect(summary.failed).toBe(1);
    expect(summary.revoked).toBe(0);
    expect(prismaMock.channelUnlock.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.videoUnlock.deleteMany).not.toHaveBeenCalled();
  });

  it("keeps access when the refresh token is spent", async () => {
    oauthMock.refreshAccessToken.mockRejectedValue(new Error("invalid_grant"));

    const summary = await reverifyChannelGrants({ now: NOW });

    expect(summary.failed).toBe(1);
    expect(summary.revoked).toBe(0);
  });

  it("never touches a grant that holds no refresh token", async () => {
    // Rows from before token persistence cannot be re-checked. Revoking them
    // would close access on a still-valid subscription purely because we failed
    // to save a credential — our bug, not the user's.
    prismaMock.channelUnlock.findMany.mockResolvedValue([]);
    prismaMock.channelUnlock.count.mockResolvedValue(7);

    const summary = await reverifyChannelGrants({ now: NOW });

    expect(summary.unverifiable).toBe(7);
    expect(summary.checked).toBe(0);
    expect(oauthMock.refreshAccessToken).not.toHaveBeenCalled();
    expect(prismaMock.channelUnlock.updateMany).not.toHaveBeenCalled();
  });

  it("only selects grants that are due, and reports how many are unverifiable", async () => {
    prismaMock.channelUnlock.findMany.mockResolvedValue([]);
    prismaMock.channelUnlock.count.mockResolvedValue(3);

    await reverifyChannelGrants({ now: NOW });

    expect(prismaMock.channelUnlock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          revokedAt: null,
          refreshToken: { not: null },
          // Default 24h interval, so anything confirmed after this is not due.
          OR: [
            { lastVerifiedAt: null },
            { lastVerifiedAt: { lte: new Date(NOW.getTime() - 24 * 60 * 60 * 1000) } },
          ],
        }),
      }),
    );
  });

  it("honours an existing rotated refresh token from the refresh response", async () => {
    oauthMock.refreshAccessToken.mockResolvedValue({
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });

    await reverifyChannelGrants({ now: NOW });

    const args = prismaMock.channelUnlock.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: "grant-1" });
    // Google rotates the refresh token on some refreshes, so the newest one is
    // what gets stored — otherwise the next pass would spend a spent credential.
    expect(decryptSecret(args.data.refreshToken, "youtube:refreshToken")).toBe("refresh-2");
  });

  it("skips a grant the caller declines to process, without spending quota", async () => {
    const summary = await reverifyChannelGrants({
      now: NOW,
      shouldProcess: async () => false,
    });

    expect(summary.checked).toBe(0);
    expect(oauthMock.refreshAccessToken).not.toHaveBeenCalled();
  });

  it("does nothing when OAuth is not configured", async () => {
    oauthMock.isYouTubeOAuthConfigured.mockReturnValue(false);

    const summary = await reverifyChannelGrants({ now: NOW });

    // `configured: false` is what lets the job tell "cannot run at all" apart
    // from "queue was empty" — otherwise a misconfigured deploy reports a
    // healthy no-op sweep forever and no grant is ever revoked.
    expect(summary).toEqual({
      configured: false,
      checked: 0,
      stillSubscribed: 0,
      revoked: 0,
      superseded: 0,
      unverifiable: 0,
      undecryptable: 0,
      failed: 0,
      budgetExhausted: false,
    });
    expect(prismaMock.channelUnlock.findMany).not.toHaveBeenCalled();
  });

  it("leaves a grant alone when its stored token cannot be decrypted", async () => {
    // A rotated or missing encryption key must read as "no usable credential",
    // not as a negative verdict. Revoking here would close access on a
    // still-valid subscription because of our own key problem.
    prismaMock.channelUnlock.findMany.mockResolvedValue([
      { ...GRANT, refreshToken: "v1:aaaa:bbbb:cccc" },
    ]);

    const summary = await reverifyChannelGrants({ now: NOW });

    expect(summary.undecryptable).toBe(1);
    expect(summary.checked).toBe(1);
    expect(summary.revoked).toBe(0);
    expect(oauthMock.refreshAccessToken).not.toHaveBeenCalled();
    expect(prismaMock.channelUnlock.updateMany).not.toHaveBeenCalled();
  });

  it("drains every due grant, not just the first batch", async () => {
    // The pass used to stop at a flat 200 grants, which made 200/day a hard
    // ceiling: past that the revocation window silently grew past the configured
    // interval. It now keeps pulling batches until the queue is empty.
    const batch = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `${prefix}-${i}`,
        userId: `user-${prefix}-${i}`,
        channelId: "UC123",
        refreshToken: `refresh-${prefix}-${i}`,
      }));

    prismaMock.channelUnlock.findMany
      .mockResolvedValueOnce(batch("a", 200))
      .mockResolvedValueOnce(batch("b", 200))
      .mockResolvedValueOnce(batch("c", 5))
      .mockResolvedValueOnce([]);

    const summary = await reverifyChannelGrants({ now: NOW });

    expect(summary.checked).toBe(405);
    expect(summary.stillSubscribed).toBe(405);
    expect(summary.budgetExhausted).toBe(false);
    // The already-seen ids are excluded from later rounds, otherwise a grant
    // whose check failed — and so keeps its old lastVerifiedAt — would come back
    // on every iteration and the pass would spin until the budget expired.
    expect(prismaMock.channelUnlock.findMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({ id: { notIn: expect.any(Array) } }),
      }),
    );
  });

  it("stops on the time budget and says so", async () => {
    // budgetMs: 0 is already expired, so the pass must not check anything and
    // must report that grants are still due — that is the signal that revocation
    // latency has outgrown one pass.
    const summary = await reverifyChannelGrants({ now: NOW, budgetMs: 0 });

    expect(summary.budgetExhausted).toBe(true);
    expect(summary.checked).toBe(0);
    expect(prismaMock.channelUnlock.findMany).not.toHaveBeenCalled();
  });

  it("never re-checks a grant it already handled this pass", async () => {
    // The mock ignores the `notIn` filter and keeps returning the same row, so
    // the drain check is what stops the loop from spinning.
    const summary = await reverifyChannelGrants({ now: NOW });

    expect(summary.stillSubscribed).toBe(1);
    expect(oauthMock.checkChannelSubscription).toHaveBeenCalledTimes(1);
  });
});

describe("revokeChannelAccess", () => {
  it("reports false and keeps per-video rows when the grant is already inactive", async () => {
    prismaMock.channelUnlock.updateMany.mockResolvedValue({ count: 0 });

    await expect(revokeChannelAccess("user-1", "UC123")).resolves.toBe(false);
    expect(prismaMock.videoUnlock.deleteMany).not.toHaveBeenCalled();
  });

  it("distinguishes a manual revocation from an unsubscribe", async () => {
    await revokeChannelAccess("user-1", "UC123", "MANUAL");

    expect(prismaMock.channelUnlock.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revokedReason: "MANUAL" }) }),
    );
  });
});

describe("revoked grants are invisible to readers", () => {
  it("excludes a revoked grant when resolving channel access", async () => {
    await getChannelAccess("user-1");

    expect(prismaMock.channelUnlock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1", revokedAt: null } }),
    );
  });

  it("excludes a revoked grant from the feed gate", async () => {
    prismaMock.communityVideo.findMany.mockResolvedValue([]);
    prismaMock.communityVideo.count.mockResolvedValue(0);
    prismaMock.videoUnlock.findMany.mockResolvedValue([]);

    await listVideosForUser("user-1", 1, 20);

    // The feed inlines its own channel lookup rather than calling
    // getChannelAccess, so it needs its own revoked filter.
    expect(prismaMock.channelUnlock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1", revokedAt: null } }),
    );
  });
});

/**
 * The grant table has no other admin-readable surface, so this listing is how an
 * operator answers "does this account still have feed access, and can we still
 * prove it?". The one property that must never regress is that a refresh token
 * — the credential that can read and re-subscribe a user's whole YouTube
 * account — is never in the response.
 */
describe("listChannelGrants", () => {
  const ROW = {
    id: "grant-1",
    userId: "user-1",
    user: { id: "user-1", email: "a@b.c", fullName: "A B" },
    channelId: "UC123",
    unlockedAt: new Date("2026-02-01T00:00:00Z"),
    verifiedAt: new Date("2026-02-01T00:00:00Z"),
    // Recent, so the row is not due — the "is it due" cases below move this
    // explicitly rather than depending on how old the fixture is.
    lastVerifiedAt: new Date(),
    revokedAt: null,
    revokedReason: null,
    refreshToken: "refresh-1",
  };

  /** Emulates the 7-way $transaction the service issues, per-call. */
  function stubTransaction({ rows = [ROW], tokens = [{ refreshToken: "refresh-1" }] } = {}) {
    prismaMock.$transaction.mockImplementation((ops: Array<() => Promise<unknown>>) =>
      Promise.all(
        ops.map((op, index) => {
          if (index === 0) return Promise.resolve(rows);
          if (index === 1) return Promise.resolve(rows.length);
          if (index === 2) return Promise.resolve(rows.filter((r) => !r.revokedAt).length);
          if (index === 3) return Promise.resolve(rows.filter((r) => r.revokedAt).length);
          if (index === 4) return Promise.resolve(0);
          if (index === 5) return Promise.resolve(tokens);
          return Promise.resolve(0);
        }),
      ),
    );
  }

  beforeEach(() => {
    prismaMock.channelUnlock.update.mockResolvedValue({});
    stubTransaction();
  });

  it("never returns a refresh token, sealed or not", async () => {
    const { rows } = await listChannelGrants();

    expect(JSON.stringify(rows)).not.toContain("refresh-1");
    // The operator still learns what they need: is there one, and is it sealed?
    expect(rows[0].hasRefreshToken).toBe(true);
    expect(rows[0].tokenEncrypted).toBe(false);
  });

  it("reports a sealed token as encrypted and re-verifiable", async () => {
    const sealed = await sealViaService();
    stubTransaction({
      rows: [{ ...ROW, refreshToken: sealed }],
      tokens: [{ refreshToken: sealed }],
    });

    const { rows, summary } = await listChannelGrants();

    expect(rows[0].tokenEncrypted).toBe(true);
    expect(rows[0].unverifiable).toBe(false);
    expect(summary.unencrypted).toBe(0);
  });

  it("counts a sealed-but-unreadable token as unverifiable, not as healthy", async () => {
    // What a rotated encryption key looks like from the admin's side: the payload
    // is well-formed, so only actually decrypting it reveals the problem.
    const foreign = sealUnderForeignKey();
    stubTransaction({
      rows: [{ ...ROW, refreshToken: foreign }],
      tokens: [{ refreshToken: foreign }],
    });

    const { rows, summary } = await listChannelGrants();

    expect(rows[0].tokenEncrypted).toBe(false);
    expect(rows[0].unverifiable).toBe(true);
    expect(summary.unverifiable).toBe(1);
  });

  it("counts plaintext active tokens so the backfill is discoverable", async () => {
    const { summary } = await listChannelGrants();

    expect(summary.unencrypted).toBe(1);
  });

  it("marks a grant with no stored credential as unverifiable but still accessible", async () => {
    stubTransaction({ rows: [{ ...ROW, refreshToken: null as unknown as string }], tokens: [] });

    const { rows } = await listChannelGrants();

    expect(rows[0].hasRefreshToken).toBe(false);
    expect(rows[0].tokenEncrypted).toBeNull();
    expect(rows[0].unverifiable).toBe(true);
  });

  it("defaults to active grants and can widen to all", async () => {
    await listChannelGrants();
    // `toHaveBeenCalledWith`, not `…LastCalledWith`: the same findMany mock also
    // serves the table-wide token scan, which is issued after the page query.
    expect(prismaMock.channelUnlock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { revokedAt: null } }),
    );

    await listChannelGrants({ status: "all" });
    expect(prismaMock.channelUnlock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, take: 25, skip: 0 }),
    );
  });

  it("filters revoked rows when asked", async () => {
    await listChannelGrants({ status: "revoked" });
    expect(prismaMock.channelUnlock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { revokedAt: { not: null } } }),
    );
  });

  it("searches case-insensitively across email and name", async () => {
    await listChannelGrants({ search: " ADA " });
    expect(prismaMock.channelUnlock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user: {
            OR: [
              { email: { contains: "ADA", mode: "insensitive" } },
              { fullName: { contains: "ADA", mode: "insensitive" } },
            ],
          },
        }),
      }),
    );
  });

  it("clamps the page size and passes the offset through", async () => {
    await listChannelGrants({ page: 3, limit: 5000 });

    expect(prismaMock.channelUnlock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100, skip: 200 }),
    );
  });

  it("marks a grant re-verified within the interval as not due", async () => {
    const { rows } = await listChannelGrants();

    expect(rows[0].dueForReverify).toBe(false);
  });

  it("marks a grant older than the interval as due", async () => {
    const stale = { ...ROW, lastVerifiedAt: new Date(Date.now() - 48 * 60 * 60 * 1000) };
    stubTransaction({ rows: [stale], tokens: [{ refreshToken: "refresh-1" }] });

    const { rows } = await listChannelGrants();

    expect(rows[0].dueForReverify).toBe(true);
  });
});

describe("reencryptLegacyRefreshTokens", () => {
  it("re-seals a plaintext token and reports the work done", async () => {
    prismaMock.channelUnlock.findMany.mockResolvedValue([GRANT]);
    prismaMock.channelUnlock.update.mockResolvedValue({});

    await expect(reencryptLegacyRefreshTokens()).resolves.toEqual({ scanned: 1, sealed: 1 });

    expect(prismaMock.channelUnlock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "grant-1" },
        data: { refreshToken: expect.stringMatching(/^v1:/) },
      }),
    );
  });

  it("leaves an already-sealed token untouched, so the call is idempotent", async () => {
    const sealed = await sealViaService();
    // sealViaService deliberately performs one write; clear it so the assertion
    // below is about the second pass, not about the helper.
    prismaMock.channelUnlock.update.mockClear();
    prismaMock.channelUnlock.findMany.mockResolvedValue([{ ...GRANT, refreshToken: sealed }]);

    await expect(reencryptLegacyRefreshTokens()).resolves.toEqual({ scanned: 1, sealed: 0 });
    expect(prismaMock.channelUnlock.update).not.toHaveBeenCalled();
  });

  it("does not count a row as sealed when it could only be rewritten in the clear", async () => {
    // With no encryption key the service deliberately stores plaintext so the
    // grant stays re-verifiable. Reporting that as `sealed: 1` would tell an
    // operator the migration is done while the rows are still readable in a dump.
    // encryption.ts memoises the key and only throws on a missing key outside
    // NODE_ENV=test, so the fallback needs the cache dropped and the env faked.
    vi.spyOn(console, "error").mockImplementation(() => {});
    _resetEncryptionKeyCache();
    vi.stubEnv("PAYMENT_GATEWAY_ENCRYPTION_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    prismaMock.channelUnlock.findMany.mockResolvedValue([GRANT]);

    try {
      await expect(reencryptLegacyRefreshTokens()).resolves.toEqual({ scanned: 1, sealed: 0 });
      expect(prismaMock.channelUnlock.update).not.toHaveBeenCalled();
    } finally {
      // Leave the memoized key alone for the rest of the suite.
      vi.stubEnv("NODE_ENV", "test");
      _resetEncryptionKeyCache();
    }
  });
});
