import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import { isEncryptedPayload, _resetEncryptionKeyCache } from "../src/helpers/encryption.js";

/**
 * Admin-facing tests for the access table.
 *
 * The access decision itself — the lease, the verdicts, the revocation rules, the
 * sweep — belongs to channel-access.service.ts and is tested there. What is
 * tested here is the community-side surface: the listing an operator reads when
 * answering "does this account still have access, and can we still prove it?",
 * plus the delegation of the sweep and the credential backfill.
 *
 * The property that must never regress is that a refresh token — the credential
 * that can read and re-subscribe a user's entire YouTube account — never appears
 * in a response, sealed or not. A sealed token is still a token.
 */

const prismaMock = {
  channelAccess: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  },
  videoUnlock: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  communityVideo: { findMany: vi.fn(), count: vi.fn() },
  $transaction: vi.fn(),
};

const oauthMock = {
  YOUTUBE_READONLY_SCOPE: "https://www.googleapis.com/auth/youtube.readonly",
  isYouTubeVerificationAvailable: vi.fn(() => true),
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

vi.mock("../src/config/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../src/config/index.js", () => ({ prisma: prismaMock }));
vi.mock("../src/services/youtube-oauth.service.js", () => oauthMock);
vi.mock("../src/services/youtube.service.js", () => ({
  resolveChannelId: vi.fn(async () => "UC123"),
  buildWatchLinks: vi.fn(() => ({ appUrl: "app", webUrl: "web" })),
  buildFullWatchUrl: vi.fn(() => "full"),
  getChannelLinks: vi.fn(() => ({ channelId: "UC123" })),
}));

const { listChannelGrants, reencryptLegacyRefreshTokens } =
  await import("../src/services/community.service.js");

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
  prismaMock.channelAccess.findMany.mockResolvedValue([
    { id: "access-1", userId: "user-1", channelId: "UC123", refreshToken: value },
  ]);
  prismaMock.channelAccess.update.mockResolvedValue({});
  await reencryptLegacyRefreshTokens();
  return prismaMock.channelAccess.update.mock.calls[0][0].data.refreshToken as string;
}

const ROW = {
  id: "access-1",
  userId: "user-1",
  user: { id: "user-1", email: "a@b.c", fullName: "A B" },
  channelId: "UC123",
  unlockedAt: new Date("2026-02-01T00:00:00Z"),
  // A live lease, so the row is not due. Relative to now rather than a fixed
  // date, because a fixture that quietly expires turns the "not due" cases into
  // "due" ones that still pass for the wrong reason.
  verifiedAt: new Date("2026-02-01T00:00:00Z"),
  accessExpiresAt: new Date(Date.now() + 60_000),
  accessVersion: 4,
  status: "SUBSCRIBED",
  revokedAt: null,
  revokedReason: null,
  googleSubject: "google-1",
  googleEmail: "a@b.c",
  grantedScopes: "openid email https://www.googleapis.com/auth/youtube.readonly",
  refreshToken: "refresh-1",
};

describe("listChannelGrants", () => {
  /** Emulates the 8-way $transaction the service issues, per-call, by index. */
  function stubTransaction({
    rows = [ROW],
    tokens = [{ refreshToken: "refresh-1" }],
    counts = {
      total: rows.length,
      active: rows.length,
      revoked: 0,
      noToken: 0,
      due: 0,
      checkFailed: 0,
    },
  }: {
    rows?: unknown[];
    tokens?: unknown[];
    counts?: Record<string, number>;
  } = {}) {
    prismaMock.$transaction.mockImplementation((ops: unknown[]) =>
      Promise.all(
        ops.map((op, index) => {
          if (index === 0) return Promise.resolve(rows);
          if (index === 1) return Promise.resolve(counts.total);
          if (index === 2) return Promise.resolve(counts.active);
          if (index === 3) return Promise.resolve(counts.revoked);
          if (index === 4) return Promise.resolve(counts.noToken);
          if (index === 5) return Promise.resolve(tokens);
          if (index === 6) return Promise.resolve(counts.due);
          return Promise.resolve(counts.checkFailed);
        }),
      ),
    );
  }

  beforeEach(() => {
    prismaMock.channelAccess.update.mockResolvedValue({});
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

    expect(isEncryptedPayload(sealed)).toBe(true);
    expect(rows[0].tokenEncrypted).toBe(true);
    expect(rows[0].unverifiable).toBe(false);
    expect(summary.unencrypted).toBe(0);
  });

  it("counts a sealed-but-unreadable token as unverifiable, not as healthy", async () => {
    // What a rotated encryption key looks like from the admin's side: the payload
    // is well-formed, so only actually decrypting it reveals the problem. Treating
    // it as healthy would leave an operator believing these links can still be
    // revoked when they cannot.
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

  it("counts plaintext tokens so the backfill is discoverable", async () => {
    const { summary } = await listChannelGrants();

    expect(summary.unencrypted).toBe(1);
  });

  it("marks a row with no stored credential as unverifiable but still accessible", async () => {
    stubTransaction({ rows: [{ ...ROW, refreshToken: null as unknown as string }], tokens: [] });

    const { rows } = await listChannelGrants();

    expect(rows[0].hasRefreshToken).toBe(false);
    expect(rows[0].tokenEncrypted).toBeNull();
    expect(rows[0].unverifiable).toBe(true);
  });

  it("returns the version and lease so a stale client can be recognised", async () => {
    const { rows } = await listChannelGrants();

    // An operator comparing a row against what an app is displaying needs these;
    // they were absent from the pre-lease listing.
    expect(rows[0].accessVersion).toBe(4);
    expect(rows[0].accessExpiresAt).toBeInstanceOf(Date);
  });

  it("defaults to live access and can widen to all", async () => {
    await listChannelGrants();
    // `toHaveBeenCalledWith`, not `…LastCalledWith`: the same findMany mock also
    // serves the table-wide token scan, which is issued after the page query.
    // "Active" is now computed — SUBSCRIBED with an unexpired lease — not a flag.
    expect(prismaMock.channelAccess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "SUBSCRIBED", revokedAt: null, accessExpiresAt: { gt: expect.any(Date) } },
      }),
    );

    await listChannelGrants({ status: "all" });
    expect(prismaMock.channelAccess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, take: 25, skip: 0 }),
    );
  });

  it("filters revoked rows when asked", async () => {
    await listChannelGrants({ status: "revoked" });
    expect(prismaMock.channelAccess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { revokedAt: { not: null } } }),
    );
  });

  it("searches case-insensitively across email and name", async () => {
    await listChannelGrants({ search: " ADA " });
    expect(prismaMock.channelAccess.findMany).toHaveBeenCalledWith(
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

    expect(prismaMock.channelAccess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100, skip: 200 }),
    );
  });

  it("marks a row whose lease has not lapsed as not due", async () => {
    const { rows } = await listChannelGrants();

    expect(rows[0].dueForRecheck).toBe(false);
  });

  it("marks a lapsed lease as due for the next sweep", async () => {
    // Due is decided by the lease, not by the age of the last check. A verdict
    // confirmed a minute ago but whose 60s lease has run out is still due.
    stubTransaction({
      rows: [{ ...ROW, accessExpiresAt: new Date(Date.now() - 1000) }],
      tokens: [{ refreshToken: "refresh-1" }],
    });

    const { rows } = await listChannelGrants();

    expect(rows[0].dueForRecheck).toBe(true);
  });

  it("never reports a revoked row as due", async () => {
    stubTransaction({
      rows: [
        {
          ...ROW,
          status: "REAUTH_REQUIRED",
          revokedAt: new Date("2026-02-02T00:00:00Z"),
          revokedReason: "UNSUBSCRIBED",
          accessExpiresAt: null,
        },
      ],
      tokens: [{ refreshToken: "refresh-1" }],
    });

    const { rows } = await listChannelGrants();

    // Already closed; re-deciding it would be work with nothing to gain.
    expect(rows[0].dueForRecheck).toBe(false);
    expect(rows[0].revokedReason).toBe("UNSUBSCRIBED");
  });
});

describe("reencryptLegacyRefreshTokens", () => {
  it("re-seals a plaintext token and reports the work done", async () => {
    prismaMock.channelAccess.findMany.mockResolvedValue([
      { id: "access-1", userId: "user-1", channelId: "UC123", refreshToken: "refresh-1" },
    ]);
    prismaMock.channelAccess.update.mockResolvedValue({});

    await expect(reencryptLegacyRefreshTokens()).resolves.toEqual({
      scanned: 1,
      sealed: 1,
      unsealable: 0,
    });

    expect(prismaMock.channelAccess.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "access-1" },
        data: { refreshToken: expect.stringMatching(/^v1:/) },
      }),
    );
  });

  it("leaves an already-sealed token untouched, so the call is idempotent", async () => {
    const sealed = await sealViaService();
    // sealViaService deliberately performs one write; clear it so the assertion
    // below is about the second pass, not about the helper.
    prismaMock.channelAccess.update.mockClear();
    prismaMock.channelAccess.findMany.mockResolvedValue([
      { id: "access-1", userId: "user-1", channelId: "UC123", refreshToken: sealed },
    ]);

    await expect(reencryptLegacyRefreshTokens()).resolves.toEqual({
      scanned: 1,
      sealed: 0,
      unsealable: 0,
    });
    expect(prismaMock.channelAccess.update).not.toHaveBeenCalled();
  });

  it("reports a token it cannot open as unsealable instead of rewriting it in the clear", async () => {
    prismaMock.channelAccess.findMany.mockResolvedValue([
      { id: "access-1", userId: "user-1", channelId: "UC123", refreshToken: sealUnderForeignKey() },
    ]);
    prismaMock.channelAccess.update.mockResolvedValue({});

    await expect(reencryptLegacyRefreshTokens()).resolves.toEqual({
      scanned: 1,
      sealed: 0,
      unsealable: 1,
    });
    // Rewriting it under the live key would fabricate a credential whose plaintext
    // nobody has, and report a working link where there is none.
    expect(prismaMock.channelAccess.update).not.toHaveBeenCalled();
  });

  it("does not count a row as sealed when there is no encryption key to seal it with", async () => {
    // encryption.ts memoises the key and only throws on a missing key outside
    // NODE_ENV=test, so the fallback needs the cache dropped and the env faked.
    // Reporting that as `sealed: 1` would tell an operator the migration is done
    // while the rows are still readable in a dump.
    vi.spyOn(console, "error").mockImplementation(() => {});
    _resetEncryptionKeyCache();
    vi.stubEnv("PAYMENT_GATEWAY_ENCRYPTION_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    prismaMock.channelAccess.findMany.mockResolvedValue([
      { id: "access-1", userId: "user-1", channelId: "UC123", refreshToken: "refresh-1" },
    ]);

    try {
      const result = await reencryptLegacyRefreshTokens();
      expect(result.sealed).toBe(0);
      expect(prismaMock.channelAccess.update).not.toHaveBeenCalled();
    } finally {
      // Leave the memoized key alone for the rest of the suite.
      vi.stubEnv("NODE_ENV", "test");
      _resetEncryptionKeyCache();
    }
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});
