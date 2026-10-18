import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/prisma.js";
import { SiteCategory } from "../generated/prisma/client.js";
import {
  getCategoryAlbum,
  getRegionAlbum,
  listAlbums,
} from "../src/modules/tour-management/tour-album.service.js";

/**
 * Category & regional album structure (§5).
 *
 * Albums bundle tour_sites (spots) + tour_packages (bookable products) by
 * category tag or region. The checks run against the real seeded Postgres:
 * the primary category tag is picked dynamically from whatever the seed
 * actually contains, and the String[] array path is covered with one
 * purpose-built site (`categories: ["Test Tag X"]`) cleaned up afterwards.
 */
describe("tour albums (§5)", () => {
  const stamp = Date.now();
  let primaryTag = "CULTURAL"; // replaced in beforeAll with the largest seeded category
  let primaryTagCount = 0;
  let centralCount = 0;
  let testSiteId: string;

  beforeAll(async () => {
    // Pick the category with the most seeded sites so pagination assertions
    // have matches to work with, whatever the seed contains.
    const byCategory = await prisma.tourSite.groupBy({
      by: ["category"],
      _count: true,
    });
    expect(byCategory.length).toBeGreaterThan(0);
    const top = byCategory.reduce((a, b) => (b._count > a._count ? b : a));
    primaryTag = top.category;
    primaryTagCount = top._count;

    centralCount = await prisma.tourSite.count({
      where: { region: { equals: "Central", mode: "insensitive" } },
    });
    expect(centralCount).toBeGreaterThan(1);

    // Array-path fixture: supplements the enum path with a free-text tag.
    const site = await prisma.tourSite.create({
      data: {
        name: `Album Test Site ${stamp}`,
        region: "Greater Accra",
        latitude: 5.6037,
        longitude: -0.1869,
        description: "Fixture site for album category-array coverage",
        imageUrl: "https://example.com/album-test-site.jpg",
        category: SiteCategory.SCENIC,
        categories: ["Test Tag X"],
      },
    });
    testSiteId = site.id;
  });

  afterAll(async () => {
    if (testSiteId) await prisma.tourSite.delete({ where: { id: testSiteId } });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Category album
  // ───────────────────────────────────────────────────────────────────────────
  describe("getCategoryAlbum", () => {
    it("returns a matching album for a seeded category tag", async () => {
      const album = await getCategoryAlbum(primaryTag, 1, 100);

      expect(album.album.type).toBe("category");
      expect(album.album.siteCount).toBe(primaryTagCount);
      expect(album.pagination.total).toBe(primaryTagCount);
      expect(album.sites).toHaveLength(primaryTagCount);
      expect(Array.isArray(album.tours)).toBe(true);
      expect(album.album.packageCount >= 0).toBe(true);

      // Every returned spot matches the tag case-insensitively via enum or array.
      // The compact payload omits `categories`, so verify against the full rows.
      const rows = await prisma.tourSite.findMany({
        where: { id: { in: album.sites.map((s) => s.id) } },
      });
      const tagLower = primaryTag.toLowerCase();
      expect(rows).toHaveLength(album.sites.length);
      for (const row of rows) {
        const enumMatch = row.category.toLowerCase() === tagLower;
        const hasArrayMatch = row.categories.some((c) => c.toLowerCase() === tagLower);
        expect(enumMatch || hasArrayMatch).toBe(true);
      }
    });

    it("is case-insensitive for the request tag", async () => {
      const titleCased = await getCategoryAlbum(primaryTag, 1, 100);
      const lowerCased = await getCategoryAlbum(primaryTag.toLowerCase(), 1, 100);
      const upperCased = await getCategoryAlbum(primaryTag.toUpperCase(), 1, 100);

      expect(lowerCased.album.siteCount).toBe(titleCased.album.siteCount);
      expect(upperCased.album.siteCount).toBe(titleCased.album.siteCount);
      expect(lowerCased.album.title).toBe(titleCased.album.title);
    });

    it("paginates sites with total scoped to the full match set", async () => {
      const firstPage = await getCategoryAlbum(primaryTag, 1, 1);
      expect(firstPage.sites).toHaveLength(1);
      expect(firstPage.pagination).toEqual({
        total: primaryTagCount,
        page: 1,
        limit: 1,
        totalPages: Math.ceil(primaryTagCount / 1),
      });
      expect(firstPage.sites.length).toBeLessThanOrEqual(primaryTagCount);
    });

    it("finds sites tagged only via the categories array", async () => {
      const album = await getCategoryAlbum("Test Tag X", 1, 20);

      expect(album.album.siteCount).toBe(1);
      expect(album.album.title).toBe("Test Tag X");
      expect(album.sites.map((s) => s.id)).toContain(testSiteId);
      // Cover image prefers the site imageUrl over any package cover.
      expect(album.album.coverImage).toBe("https://example.com/album-test-site.jpg");
    });

    it("throws ALBUM_TAG_REQUIRED for an empty tag", async () => {
      await expect(getCategoryAlbum("   ", 1, 20)).rejects.toThrow("ALBUM_TAG_REQUIRED");
      await expect(getCategoryAlbum("", 1, 20)).rejects.toThrow("ALBUM_TAG_REQUIRED");
    });

    it("returns an empty-but-valid album for an unknown tag", async () => {
      const album = await getCategoryAlbum("No Such Tag Zzz", 1, 20);
      expect(album.album.siteCount).toBe(0);
      expect(album.album.packageCount).toBe(0);
      expect(album.sites).toEqual([]);
      expect(album.tours).toEqual([]);
      expect(album.pagination).toEqual({ total: 0, page: 1, limit: 20, totalPages: 0 });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Region album
  // ───────────────────────────────────────────────────────────────────────────
  describe("getRegionAlbum", () => {
    it("returns only sites within the requested region", async () => {
      const album = await getRegionAlbum("Central", 1, 100);

      expect(album.album.type).toBe("region");
      expect(album.album.key).toBe("region:Central");
      expect(album.album.title).toBe("Central");
      expect(album.album.siteCount).toBe(centralCount);
      expect(album.pagination.total).toBe(centralCount);
      for (const site of album.sites) {
        expect(site.region.toLowerCase()).toBe("central");
      }
    });

    it("matches the region case-insensitively", async () => {
      const album = await getRegionAlbum("central", 1, 100);
      expect(album.album.siteCount).toBe(centralCount);

      const expected = await prisma.tourSite.count({
        where: { region: { equals: "Central", mode: "insensitive" } },
      });
      expect(album.album.siteCount).toBe(expected);
    });

    it("paginates correctly", async () => {
      const page = await getRegionAlbum("Central", 1, 1);
      expect(page.sites).toHaveLength(1);
      expect(page.pagination).toEqual({
        total: centralCount,
        page: 1,
        limit: 1,
        totalPages: Math.ceil(centralCount / 1),
      });
    });

    it("throws ALBUM_REGION_REQUIRED for an empty region", async () => {
      await expect(getRegionAlbum("  ", 1, 20)).rejects.toThrow("ALBUM_REGION_REQUIRED");
    });

    it("returns an empty-but-valid album for an unknown region", async () => {
      const album = await getRegionAlbum("Atlantis", 1, 20);
      expect(album.album.siteCount).toBe(0);
      expect(album.sites).toEqual([]);
      expect(album.tours).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Album index
  // ───────────────────────────────────────────────────────────────────────────
  describe("listAlbums", () => {
    it("covers every SiteCategory value and seeded regions", async () => {
      const index = await listAlbums();

      for (const enumTag of Object.values(SiteCategory)) {
        const title = enumTag.toLowerCase().replace(/(^|\s)\w/g, (c) => c.toUpperCase());
        const entry = index.categories.find((c) => c.title === title);
        expect(entry, `missing category album for ${enumTag}`).toBeDefined();
        expect(entry!.siteCount).toBeGreaterThanOrEqual(0);
        expect(entry!.packageCount).toBeGreaterThanOrEqual(0);
      }

      const seededRegions = await prisma.tourSite.findMany({
        select: { region: true },
        distinct: ["region"],
      });
      for (const { region } of seededRegions) {
        const entry = index.regions.find((r) => r.title.toLowerCase() === region.toLowerCase());
        expect(entry, `missing region album for ${region}`).toBeDefined();
        expect(entry!.siteCount).toBeGreaterThan(0);
      }

      // The array-tag fixture surfaces as its own browsable category album.
      const testTag = index.categories.find((c) => c.title === "Test Tag X");
      expect(testTag).toBeDefined();
      expect(testTag!.siteCount).toBe(1);
    });

    it("sorts albums by siteCount desc then title asc", async () => {
      const index = await listAlbums();
      for (const list of [index.categories, index.regions]) {
        for (let i = 1; i < list.length; i++) {
          const prev = list[i - 1];
          const curr = list[i];
          expect(prev.siteCount).toBeGreaterThanOrEqual(curr.siteCount);
          if (prev.siteCount === curr.siteCount) {
            expect(prev.title.localeCompare(curr.title)).toBeLessThanOrEqual(0);
          }
        }
      }
    });
  });
});
