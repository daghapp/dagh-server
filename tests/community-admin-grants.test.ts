import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";

/**
 * The grant listing's `status` filter is the one place where "all" is a real
 * value rather than a synonym for "no filter". It used to go through the shared
 * parseEnum helper, which maps "all" to undefined — so an operator asking for
 * every grant silently got the *narrower* default of active-only. A filter that
 * quietly returns less than requested is worse than one that errors, because it
 * looks like a correct answer.
 */

const EMPTY_SUMMARY = { active: 0, revoked: 0, unverifiable: 0, unencrypted: 0, due: 0 };

const listChannelGrants = vi.fn(
  async (_options: { status?: string; page?: number; limit?: number; search?: string }) => ({
    rows: [] as unknown[],
    total: 0,
    summary: EMPTY_SUMMARY,
  }),
);

vi.mock("../src/services/community.service.js", () => ({
  CHANNEL_GRANT_STATUSES: ["active", "revoked", "all"],
  listChannelGrants,
  listVideosForUser: vi.fn(),
  listUnlocksForUser: vi.fn(),
  getVideoRecord: vi.fn(),
  unlockVideo: vi.fn(),
  logInteraction: vi.fn(),
  getUnlockStatus: vi.fn(),
  getChannelAccess: vi.fn(),
  revokeChannelGrantManually: vi.fn(),
  reencryptLegacyRefreshTokens: vi.fn(),
  syncCommunityVideos: vi.fn(),
  createVideo: vi.fn(),
  updateVideo: vi.fn(),
  deleteVideo: vi.fn(),
  getVideoAnalytics: vi.fn(),
}));

vi.mock("../src/services/youtube.service.js", () => ({
  YouTubeApiError: class extends Error {},
  YouTubeNotConfiguredError: class extends Error {},
}));

vi.mock("../src/helpers/communityLogger.js", () => ({
  logCommunity: vi.fn(),
  logCommunityWarn: vi.fn(),
  logCommunityError: vi.fn(),
}));

const { CommunityController } = await import("../src/modules/community/community.controller.js");

const controller = new CommunityController();

function req(query: Record<string, string>, userId = "admin-1"): Request {
  return { query, user: { id: userId } } as unknown as Request;
}

function res(): Response {
  return { json: vi.fn(), status: vi.fn(() => ({ json: vi.fn() })) } as unknown as Response;
}

async function statusFor(query: Record<string, string>): Promise<string | undefined> {
  listChannelGrants.mockClear();
  await controller.adminListChannelGrants(req(query), res());
  const call = listChannelGrants.mock.calls[0] as [{ status: string }];
  return call[0].status;
}

beforeEach(() => {
  vi.clearAllMocks();
  listChannelGrants.mockResolvedValue({
    rows: [],
    total: 0,
    summary: { active: 0, revoked: 0, unverifiable: 0, unencrypted: 0, due: 0 },
  });
});

describe("adminListChannelGrants status filter", () => {
  it("defaults to active when no status is given", async () => {
    await expect(statusFor({})).resolves.toBe("active");
  });

  it("honours status=all instead of collapsing it to the active default", async () => {
    await expect(statusFor({ status: "all" })).resolves.toBe("all");
  });

  it("accepts status=active and status=revoked", async () => {
    await expect(statusFor({ status: "active" })).resolves.toBe("active");
    await expect(statusFor({ status: "revoked" })).resolves.toBe("revoked");
  });

  it("is case- and whitespace-insensitive", async () => {
    await expect(statusFor({ status: " ALL " })).resolves.toBe("all");
  });

  it("falls back to active on an unknown value rather than returning the whole table", async () => {
    // The dangerous direction here is over-returning: an unrecognised filter
    // should not silently widen the result set.
    await expect(statusFor({ status: "everything" })).resolves.toBe("active");
  });

  it("passes the search term and pagination through", async () => {
    listChannelGrants.mockClear();
    await controller.adminListChannelGrants(req({ q: "ada", page: "2", limit: "10" }), res());

    expect(listChannelGrants).toHaveBeenCalledWith(
      expect.objectContaining({ search: "ada", page: 2, limit: 10 }),
    );
  });
});
