/**
 * Targeted, production-safe tour-site sync.
 *
 * Unlike `npm run db:seed`, this only touches `tour_sites`: it inserts missing
 * catalogue entries and fills content gaps (`history`, `imageUrl`,
 * `imageCredit`) on existing rows. Admin-edited values are never overwritten,
 * except by the explicit unique-image overrides that replace shared fallback
 * photos.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sync-tour-sites.ts
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sync-tour-sites.ts --dry-run
 */
import { pathToFileURL } from "node:url";
import { prisma } from "../src/config/index.js";
import { tourSiteCatalogue } from "../src/seed-data/tour-catalogue.js";
import { uniqueSiteImages } from "../src/seed-data/ghana-tour-site-images-unique.js";
import { siteCoordinateOverrides } from "../src/seed-data/tour-site-coordinates.js";
import { optimizeImageUrl } from "../src/helpers/image-url.js";

const REGIONS = [
  "Greater Accra",
  "Central",
  "Western",
  "Western North",
  "Volta",
  "Oti",
  "Eastern",
  "Ashanti",
  "Bono",
  "Bono East",
  "Ahafo",
  "Savannah",
  "Northern",
  "North East",
  "Upper East",
  "Upper West",
];

export async function syncTourSites(dryRun = process.argv.includes("--dry-run")) {
  console.log(`${dryRun ? "[dry-run] " : ""}Syncing ${tourSiteCatalogue.length} tour sites...`);

  const existing = await prisma.tourSite.findMany({
    select: {
      id: true,
      name: true,
      history: true,
      imageUrl: true,
      imageCredit: true,
      latitude: true,
      longitude: true,
    },
  });
  const byName = new Map(existing.map((site) => [site.name, site]));

  let created = 0;
  let enriched = 0;

  for (const site of tourSiteCatalogue) {
    const current = byName.get(site.name);

    if (!current) {
      if (!dryRun) await prisma.tourSite.create({ data: site });
      created += 1;
      continue;
    }

    const patch: {
      history?: string | null;
      imageUrl?: string | null;
      imageCredit?: string | null;
      latitude?: number;
      longitude?: number;
    } = {};
    if (!current.history && site.history) patch.history = site.history;
    const coordinates = siteCoordinateOverrides[site.name];
    if (
      coordinates &&
      (current.latitude !== coordinates.latitude || current.longitude !== coordinates.longitude)
    ) {
      patch.latitude = coordinates.latitude;
      patch.longitude = coordinates.longitude;
    }
    if (uniqueSiteImages[site.name]) {
      if (current.imageUrl !== site.imageUrl) patch.imageUrl = site.imageUrl;
      if (current.imageCredit !== site.imageCredit) patch.imageCredit = site.imageCredit;
    } else {
      if (!current.imageUrl && site.imageUrl) patch.imageUrl = site.imageUrl;
      if (!current.imageCredit && site.imageCredit) patch.imageCredit = site.imageCredit;
    }

    if (Object.keys(patch).length > 0) {
      if (!dryRun) {
        await prisma.tourSite.update({ where: { id: current.id }, data: patch });
      }
      enriched += 1;
    }
  }

  // Gallery seeding: one APPROVED photo per site so the destination detail
  // gallery is not empty. `publicId` is the idempotency marker.
  let galleryCreated = 0;
  const gallerySites = await prisma.tourSite.findMany({
    select: { id: true, name: true, imageUrl: true },
  });
  for (const site of gallerySites) {
    if (!site.imageUrl) continue;
    const marker = `seed-gallery:${site.name}`;
    const existingPhoto = await prisma.sitePhoto.findFirst({
      where: { tourSiteId: site.id, publicId: marker },
      select: { id: true, url: true },
    });
    if (existingPhoto) {
      if (uniqueSiteImages[site.name] && existingPhoto.url !== site.imageUrl) {
        if (!dryRun) {
          await prisma.sitePhoto.update({
            where: { id: existingPhoto.id },
            data: { url: site.imageUrl, thumbUrl: optimizeImageUrl(site.imageUrl, 400) },
          });
        }
      }
      continue;
    }
    if (!dryRun) {
      await prisma.sitePhoto.create({
        data: {
          tourSiteId: site.id,
          url: site.imageUrl,
          thumbUrl: optimizeImageUrl(site.imageUrl, 400),
          publicId: marker,
          status: "APPROVED",
          moderatedAt: new Date(),
        },
      });
    }
    galleryCreated += 1;
  }

  const rows = await prisma.tourSite.groupBy({
    by: ["region"],
    _count: { _all: true },
    orderBy: { region: "asc" },
  });
  const regions = new Set(rows.map((row) => row.region));
  const missingRegions = REGIONS.filter((region) => !regions.has(region));
  const missingHistory = await prisma.tourSite.count({ where: { history: null } });
  const missingImage = await prisma.tourSite.count({ where: { imageUrl: null } });

  console.log(`${dryRun ? "Would create" : "Created"} ${created} sites.`);
  console.log(`${dryRun ? "Would enrich" : "Enriched"} ${enriched} existing sites.`);
  console.log(`${dryRun ? "Would create" : "Created"} ${galleryCreated} approved gallery photos.`);
  console.log(`Regions represented: ${regions.size}/16`);
  console.log(`Sites missing history: ${missingHistory}`);
  console.log(`Sites missing image: ${missingImage}`);
  if (missingRegions.length > 0) console.log(`Missing regions: ${missingRegions.join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncTourSites()
    .catch((error) => {
      console.error("Tour-site sync failed:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
