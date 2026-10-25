import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/prisma.js";
import { createTourSite } from "../src/modules/tour-sites/tour-site.service.js";
import { AuthProvider, AccountType } from "../generated/prisma/client.js";
import type { CreateTourSiteInput } from "../src/validator/tour-site-validator.js";

/**
 * Admin-created tour sites.
 *
 * Covers direct catalogue creation (bypassing the pending queue), category
 * normalization, album-tag merging/deduplication, region-derived transit
 * profiles, and the case-insensitive duplicate-name guard. Runs against the
 * real seeded Postgres and removes every row it creates.
 */
describe("admin-created tour sites", () => {
  const stamp = Date.now();
  let adminId: string;
  const createdSiteIds: string[] = [];

  const input: CreateTourSiteInput = {
    name: `Admin Test Fort ${stamp}`,
    region: "Volta",
    latitude: 5.901,
    longitude: 0.987,
    description: "A coastal fort added directly by an administrator.",
    history: "Built in the nineteenth century and restored for visitors.",
    category: "Historical fort",
    categories: ["Coastal", "historical"],
    imageUrl: "https://example.com/fort.jpg",
    imageCredit: "Wikimedia Commons",
  };

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: {
        email: `admin-tour-site-${stamp}@example.com`,
        fullName: "Admin Tour Site Tester",
        accountType: AccountType.ADMIN,
        authProvider: AuthProvider.EMAIL,
      },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    if (createdSiteIds.length > 0) {
      await prisma.tourSite.deleteMany({ where: { id: { in: createdSiteIds } } });
    }
    await prisma.adminActivityLog.deleteMany({ where: { actorId: adminId } });
    await prisma.user.delete({ where: { id: adminId } });
  });

  it("creates a live tour site with a normalized category and derived profile", async () => {
    const site = await createTourSite(adminId, input);
    createdSiteIds.push(site.id);

    expect(site.name).toBe(input.name);
    expect(site.category).toBe("HISTORICAL");
    expect(site.categories).toEqual(["Historical fort", "Coastal", "historical"]);
    expect(site.transit_profile).toBe("RURAL");
    expect(site.history).toBe(input.history);
    expect(site.imageCredit).toBe("Wikimedia Commons");
  });

  it("rejects a duplicate name case-insensitively", async () => {
    await expect(
      createTourSite(adminId, { ...input, name: input.name.toLowerCase() }),
    ).rejects.toThrow("DUPLICATE_SITE_NAME");
  });

  it("defaults unknown/absent category to CULTURAL with no derived tag", async () => {
    const site = await createTourSite(adminId, {
      name: `Admin Test Site ${stamp}`,
      region: "Greater Accra",
      latitude: 5.56,
      longitude: -0.2,
      description: "A site with no category supplied by the administrator.",
    });
    createdSiteIds.push(site.id);

    expect(site.category).toBe("CULTURAL");
    expect(site.categories).toEqual([]);
    expect(site.transit_profile).toBe("URBAN_CENTER");
    expect(site.history).toBeNull();
  });
});
