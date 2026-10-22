import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/prisma.js";
import {
  mapToSiteCategory,
  buildCategoryTags,
  submitPendingSite,
  approvePendingSite,
  rejectPendingSite,
  getMySubmissions,
  listPendingSites,
} from "../src/modules/pending-sites/pending-site.service.js";
import { AuthProvider, AccountType } from "../generated/prisma/client.js";
import type { SubmitPendingSiteInput } from "../src/validator/pending-site-validator.js";

/**
 * User-generated tour sites with admin approval (§3).
 *
 * Covers the free-text → SiteCategory normalization helpers, the submission
 * duplicate guard, the approval migration into production tour_sites (enum
 * mapping, album tag preservation, region-derived transit profile), the
 * rejection path, and the submitter's own history. Runs against the real
 * seeded Postgres; all rows created here are removed in afterAll so the suite
 * stays repeatable.
 */
describe("pending-site moderation workflow (§3)", () => {
  const stamp = Date.now();
  let userId: string;

  // Ids tracked for cleanup — approval creates production tour_sites rows.
  const createdTourSiteIds: string[] = [];
  const createdPendingSiteIds: string[] = [];

  // Set during the approval tests, reused by the admin queue tests below.
  let waterfallSiteId: string;

  const waterfallInput: SubmitPendingSiteInput = {
    name: `Test Waterfall ${stamp}`,
    region: "Volta",
    latitude: 7.0131,
    longitude: 0.5126,
    description: "A beautiful waterfall near Hohoe in the Volta region.",
    history: "Long used as a sacred site by the communities around Hohoe.",
    category: "Waterfall",
    imageUrl: "https://example.com/wli.jpg",
    imageCredit: "Wikimedia Commons",
  };

  const fortInput: SubmitPendingSiteInput = {
    name: `Test Fort ${stamp}`,
    region: "Greater Accra",
    latitude: 5.556,
    longitude: -0.1969,
    description: "A colonial fort overlooking the coastline near Accra.",
    category: "Historical",
  };

  const museumInput: SubmitPendingSiteInput = {
    name: `Test Museum ${stamp}`,
    region: "Ashanti",
    latitude: 6.6885,
    longitude: -1.6244,
    description: "A regional museum housing royal artefacts and history.",
    category: "Museum",
  };

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `pending-site-${stamp}@example.com`,
        fullName: "Pending Site Tester",
        accountType: AccountType.USER,
        authProvider: AuthProvider.EMAIL,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    // Production rows first (FK-free, but ordered for clarity), then staging
    // rows, then the throwaway user.
    if (createdTourSiteIds.length > 0) {
      await prisma.tourSite.deleteMany({ where: { id: { in: createdTourSiteIds } } });
    }
    await prisma.pendingSite.deleteMany({ where: { submittedBy: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  // ─────────────────────────────────────────
  // PURE MAPPERS
  // ─────────────────────────────────────────

  describe("mapToSiteCategory", () => {
    it("maps keyword categories to the SiteCategory enum", () => {
      expect(mapToSiteCategory("Heritage trail")).toBe("HERITAGE");
      expect(mapToSiteCategory("Cape Coast Castle tour")).toBe("HISTORICAL");
      expect(mapToSiteCategory("adventure hike")).toBe("ADVENTURE");
      expect(mapToSiteCategory("Labadi Beach")).toBe("BEACH");
      expect(mapToSiteCategory("wildlife safari reserve")).toBe("WILDLIFE");
      expect(mapToSiteCategory("botanical garden")).toBe("NATURE");
      expect(mapToSiteCategory("religious pilgrimage shrine")).toBe("RELIGIOUS");
      expect(mapToSiteCategory("scenic mountain viewpoint")).toBe("SCENIC");
      expect(mapToSiteCategory("urban nightlife market")).toBe("URBAN");
      expect(mapToSiteCategory("cultural festival art")).toBe("CULTURAL");
    });

    it("is case-insensitive and first-match-wins", () => {
      expect(mapToSiteCategory("HERITAGE")).toBe("HERITAGE");
      // heritage is checked before the HISTORICAL keywords
      expect(mapToSiteCategory("Heritage fort museum")).toBe("HERITAGE");
    });

    it("falls back to CULTURAL for unknown free-text", () => {
      expect(mapToSiteCategory("totally unknown thing")).toBe("CULTURAL");
      expect(mapToSiteCategory("")).toBe("CULTURAL");
    });
  });

  describe("buildCategoryTags", () => {
    it("returns no tag when the text is empty", () => {
      expect(buildCategoryTags("")).toEqual([]);
      expect(buildCategoryTags("   ")).toEqual([]);
    });

    it("drops text that already equals the mapped enum name", () => {
      expect(buildCategoryTags("Historical")).toEqual([]);
      expect(buildCategoryTags("historical")).toEqual([]);
      expect(buildCategoryTags(" BEACH ")).toEqual([]);
    });

    it("preserves the user's wording as a single tag otherwise", () => {
      expect(buildCategoryTags("Slave Route Tour")).toEqual(["Slave Route Tour"]);
      expect(buildCategoryTags("  Waterfall  ")).toEqual(["Waterfall"]);
    });
  });

  // ─────────────────────────────────────────
  // SUBMISSION
  // ─────────────────────────────────────────

  describe("submitPendingSite", () => {
    it("creates a pending row in the staging table", async () => {
      const row = await submitPendingSite(userId, waterfallInput);

      createdPendingSiteIds.push(row.id);
      expect(row.name).toBe(waterfallInput.name);
      expect(row.region).toBe("Volta");
      expect(row.status).toBe("pending");
      expect(row.submittedBy).toBe(userId);
      expect(row.category).toBe("Waterfall");
      expect(row.history).toBe(waterfallInput.history);
      expect(row.imageUrl).toBe(waterfallInput.imageUrl);
      expect(row.imageCredit).toBe(waterfallInput.imageCredit);
    });

    it("rejects a duplicate name (case-insensitive) against another pending row", async () => {
      await expect(
        submitPendingSite(userId, { ...waterfallInput, name: waterfallInput.name.toLowerCase() }),
      ).rejects.toThrow("DUPLICATE_SITE_NAME");
    });

    it("rejects a name that already exists in the production catalogue", async () => {
      const existing = await prisma.tourSite.findFirst({ select: { name: true } });
      expect(existing).toBeTruthy();

      await expect(
        submitPendingSite(userId, {
          ...fortInput,
          name: existing!.name,
        }),
      ).rejects.toThrow("DUPLICATE_SITE_NAME");
    });
  });

  // ─────────────────────────────────────────
  // APPROVAL
  // ─────────────────────────────────────────

  describe("approvePendingSite", () => {
    it("migrates a Volta submission with NATURE category, tag, and RURAL transit profile", async () => {
      const pending = await prisma.pendingSite.findFirst({
        where: { name: waterfallInput.name, submittedBy: userId },
      });
      expect(pending).toBeTruthy();
      waterfallSiteId = pending!.id;

      const result = await approvePendingSite(waterfallSiteId, userId);
      createdTourSiteIds.push(result.tourSiteId);

      expect(result.siteId).toBe(waterfallSiteId);

      const tourSite = await prisma.tourSite.findUnique({ where: { id: result.tourSiteId } });
      expect(tourSite).toBeTruthy();
      expect(tourSite!.name).toBe(waterfallInput.name);
      expect(tourSite!.region).toBe("Volta");
      expect(tourSite!.description).toBe(waterfallInput.description);
      // Detail-page fields carry through the approval migration.
      expect(tourSite!.history).toBe(waterfallInput.history);
      expect(tourSite!.imageUrl).toBe(waterfallInput.imageUrl);
      expect(tourSite!.imageCredit).toBe(waterfallInput.imageCredit);
      // "Waterfall" keyword-maps to NATURE and is NOT redundant with the enum
      // name, so the user's wording is preserved as an album tag (§5).
      expect(tourSite!.category).toBe("NATURE");
      expect(tourSite!.categories).toEqual(["Waterfall"]);
      // Volta is a rural region per the transit-profile helper (§2).
      expect(tourSite!.transit_profile).toBe("RURAL");

      const updated = await prisma.pendingSite.findUnique({ where: { id: waterfallSiteId } });
      expect(updated!.status).toBe("approved");
    });

    it("throws SITE_NOT_PENDING when approving an already-approved row", async () => {
      await expect(approvePendingSite(waterfallSiteId, userId)).rejects.toThrow("SITE_NOT_PENDING");
    });

    it("throws SITE_NOT_FOUND for an unknown id", async () => {
      await expect(
        approvePendingSite("00000000-0000-4000-8000-000000000000", userId),
      ).rejects.toThrow("SITE_NOT_FOUND");
    });

    it("derives URBAN_CENTER for a Greater Accra submission and drops redundant tags", async () => {
      const submitted = await submitPendingSite(userId, fortInput);
      createdPendingSiteIds.push(submitted.id);

      const result = await approvePendingSite(submitted.id, userId);
      createdTourSiteIds.push(result.tourSiteId);

      const tourSite = await prisma.tourSite.findUnique({ where: { id: result.tourSiteId } });
      expect(tourSite!.category).toBe("HISTORICAL");
      // "Historical" case-insensitively equals the enum name → no duplicate tag.
      expect(tourSite!.categories).toEqual([]);
      expect(tourSite!.transit_profile).toBe("URBAN_CENTER");
    });
  });

  // ─────────────────────────────────────────
  // REJECTION
  // ─────────────────────────────────────────

  describe("rejectPendingSite", () => {
    let museumSiteId: string;

    it("throws INVALID_REJECT_REASON when the reason is too short", async () => {
      const submitted = await submitPendingSite(userId, museumInput);
      createdPendingSiteIds.push(submitted.id);
      museumSiteId = submitted.id;

      await expect(rejectPendingSite(museumSiteId, userId, "  no  ")).rejects.toThrow(
        "INVALID_REJECT_REASON",
      );
    });

    it("sets status and the trimmed reason on the pending row", async () => {
      const reason = "Coordinates do not match the described location — please verify.";
      const result = await rejectPendingSite(museumSiteId, userId, `  ${reason}  `);

      expect(result.siteId).toBe(museumSiteId);
      expect(result.rejectReason).toBe(reason);

      const row = await prisma.pendingSite.findUnique({ where: { id: museumSiteId } });
      expect(row!.status).toBe("rejected");
      expect(row!.rejectReason).toBe(reason);
    });
  });

  // ─────────────────────────────────────────
  // SUBMITTER VIEW + ADMIN QUEUE
  // ─────────────────────────────────────────

  describe("getMySubmissions", () => {
    it("returns the user's rows newest first with moderation status", async () => {
      const rows = await getMySubmissions(userId);

      expect(rows.length).toBeGreaterThanOrEqual(3);
      const names = rows.map((r) => r.name);
      expect(names).toContain(waterfallInput.name);
      expect(names).toContain(fortInput.name);
      expect(names).toContain(museumInput.name);

      const waterfallRow = rows.find((r) => r.name === waterfallInput.name)!;
      expect(waterfallRow.status).toBe("approved");
      expect(waterfallRow.category).toBe("Waterfall");
      expect(waterfallRow.rejectReason).toBeNull();

      const museumRow = rows.find((r) => r.name === museumInput.name)!;
      expect(museumRow.status).toBe("rejected");
      expect(museumRow.rejectReason).toBeTruthy();

      // Newest first: the museum (rejected last) precedes the waterfall.
      expect(rows.findIndex((r) => r.name === museumInput.name)).toBeLessThan(
        rows.findIndex((r) => r.name === waterfallInput.name),
      );
    });
  });

  describe("listPendingSites", () => {
    it("filters by status and paginates", async () => {
      const approved = await listPendingSites({ status: "approved", page: 1, limit: 50 });
      expect(approved.sites.every((s) => s.status === "approved")).toBe(true);
      expect(approved.sites.some((s) => s.id === waterfallSiteId)).toBe(true);

      const rejected = await listPendingSites({ status: "rejected", page: 1, limit: 50 });
      expect(rejected.sites.every((s) => s.status === "rejected")).toBe(true);
    });

    it("throws INVALID_STATUS for an unknown status filter", async () => {
      await expect(listPendingSites({ status: "bogus" })).rejects.toThrow("INVALID_STATUS");
    });
  });
});
