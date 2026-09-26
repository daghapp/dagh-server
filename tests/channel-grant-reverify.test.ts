import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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

const { reverifyChannelGrants, revokeChannelAccess, getChannelAccess, listVideosForUser } =
  await import("../src/services/community.service.js");

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
    expect(prismaMock.channelUnlock.update).toHaveBeenCalledWith({
      where: { id: "grant-1" },
      data: { lastVerifiedAt: NOW, refreshToken: "refresh-1" },
    });
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

    expect(prismaMock.channelUnlock.update).toHaveBeenCalledWith({
      where: { id: "grant-1" },
      data: { lastVerifiedAt: NOW, refreshToken: "refresh-2" },
    });
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

    expect(summary).toEqual({
      checked: 0,
      stillSubscribed: 0,
      revoked: 0,
      superseded: 0,
      unverifiable: 0,
      failed: 0,
    });
    expect(prismaMock.channelUnlock.findMany).not.toHaveBeenCalled();
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
