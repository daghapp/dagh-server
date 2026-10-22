// ─────────────────────────────────────────────────────────────────────────────
// Category & regional album structure (§5).
//
// Every tour document is keyed by `region` and category tags. Album endpoints
// bundle matches from BOTH data sources into one browsable payload:
//   - tour_sites    → the physical "tour spots" (enum `category` + `categories[]`)
//   - tour_packages → bookable products (string `category` + `categories[]`)
// Selecting an album returns the matching sites (paginated) plus up to 20
// matching packages.
//
// Case-sensitivity notes (why the variant juggling below exists):
//   - Postgres enums are exact-match only; Prisma offers no `mode: insensitive`
//     on enum filters, so the tag is upper-cased to hit SiteCategory values.
//   - String[] `has` is also case-sensitive in Prisma, so array matching ORs the
//     raw tag with its Title-Cased and lower-cased variants.
//   - Plain String columns (region, tour_packages.category) DO support
//     `mode: "insensitive"` and use it directly.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../../config/index.js";
import { SiteCategory, TransitProfile } from "../../../generated/prisma/client.js";
import type { Prisma } from "../../../generated/prisma/client.js";

const MAX_ALBUM_TOURS = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────────
export interface AlbumSite {
  id: string;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  category: SiteCategory;
  history: string | null;
  imageUrl: string | null;
  imageCredit: string | null;
  transitProfile: TransitProfile | null;
}

export interface AlbumTour {
  id: string;
  title: string | null;
  slug: string | null;
  coverImage: string | null;
  region: string | null;
  category: string | null;
  categories: string[];
  basePrice: unknown;
  durationDays: number | null;
  status: string | null;
}

export interface AlbumMeta {
  key: string;
  type: "category" | "region";
  title: string;
  coverImage: string | null;
  siteCount: number;
  packageCount: number;
}

export interface AlbumPayload {
  album: AlbumMeta;
  sites: AlbumSite[];
  tours: AlbumTour[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

export interface CategoryAlbumIndexEntry {
  key: string;
  title: string;
  coverImage: string | null;
  siteCount: number;
  packageCount: number;
}

export interface RegionAlbumIndexEntry {
  key: string;
  title: string;
  coverImage: string | null;
  siteCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function titleCase(tag: string): string {
  return tag
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// Case variants used for String[] `has` matching (see header note).
function tagVariants(tag: string): string[] {
  return Array.from(new Set([tag, titleCase(tag), tag.toLowerCase(), tag.toUpperCase()]));
}

function isValidSiteCategory(value: string): value is SiteCategory {
  return Object.values(SiteCategory).includes(value as SiteCategory);
}

function normalizePageLimit(page: number, limit: number): { page: number; limit: number } {
  const pageNum = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const limitNum = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : 20;
  return { page: pageNum, limit: limitNum };
}

// Where clause matching one category tag against tour_sites.
function siteCategoryWhere(tag: string): Prisma.TourSiteWhereInput {
  const variants = tagVariants(tag);
  const upper = tag.toUpperCase();
  return {
    OR: [
      // Enum equality is exact; upper-casing maps "adventure" → ADVENTURE.
      ...(isValidSiteCategory(upper) ? [{ category: upper as SiteCategory }] : []),
      ...variants.map((v) => ({ categories: { has: v } })),
    ],
  };
}

// Where clause matching one category tag against tour_packages.
function packageCategoryWhere(tag: string): Prisma.tour_packagesWhereInput {
  const variants = tagVariants(tag);
  return {
    OR: [
      // tour_packages.category is a free-text String → real case-insensitive match.
      { category: { equals: tag, mode: "insensitive" } },
      ...variants.map((v) => ({ categories: { has: v } })),
    ],
  };
}

function siteRegionWhere(region: string): Prisma.TourSiteWhereInput {
  return { region: { equals: region, mode: "insensitive" } };
}

function packageRegionWhere(region: string): Prisma.tour_packagesWhereInput {
  return { region: { equals: region, mode: "insensitive" } };
}

function toAlbumSite(row: {
  id: string;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  category: SiteCategory;
  history: string | null;
  imageUrl: string | null;
  imageCredit: string | null;
  transit_profile: TransitProfile | null;
}): AlbumSite {
  return {
    id: row.id,
    name: row.name,
    region: row.region,
    latitude: row.latitude,
    longitude: row.longitude,
    category: row.category,
    history: row.history,
    imageUrl: row.imageUrl,
    imageCredit: row.imageCredit,
    transitProfile: row.transit_profile,
  };
}

const ALBUM_TOUR_SELECT = {
  id: true,
  title: true,
  slug: true,
  coverImage: true,
  region: true,
  category: true,
  categories: true,
  basePrice: true,
  durationDays: true,
  status: true,
} satisfies Prisma.tour_packagesSelect;

// Shared assembly for both album dimensions — the payload shape is identical,
// only the where clauses and album metadata differ (§5).
async function buildAlbum(params: {
  siteWhere: Prisma.TourSiteWhereInput;
  packageWhere: Prisma.tour_packagesWhereInput;
  meta: { key: string; type: "category" | "region"; title: string };
  page: number;
  limit: number;
}): Promise<AlbumPayload> {
  const { page, limit } = normalizePageLimit(params.page, params.limit);
  const skip = (page - 1) * limit;
  const orderBy: Prisma.TourSiteOrderByWithRelationInput[] = [{ region: "asc" }, { name: "asc" }];

  const [sites, siteCount, tours, packageCount, firstSite, firstPackage] = await Promise.all([
    prisma.tourSite.findMany({
      where: params.siteWhere,
      skip,
      take: limit,
      orderBy,
    }),
    prisma.tourSite.count({ where: params.siteWhere }),
    prisma.tour_packages.findMany({
      where: params.packageWhere,
      take: MAX_ALBUM_TOURS,
      orderBy: { createdAt: "desc" },
      select: ALBUM_TOUR_SELECT,
    }),
    prisma.tour_packages.count({ where: params.packageWhere }),
    prisma.tourSite.findFirst({
      where: params.siteWhere,
      orderBy,
      select: { imageUrl: true },
    }),
    prisma.tour_packages.findFirst({
      where: params.packageWhere,
      orderBy: { createdAt: "desc" },
      select: { coverImage: true },
    }),
  ]);

  return {
    album: {
      ...params.meta,
      coverImage: firstSite?.imageUrl ?? firstPackage?.coverImage ?? null,
      siteCount,
      packageCount,
    },
    sites: sites.map(toAlbumSite),
    tours: tours as AlbumTour[],
    pagination: { total: siteCount, page, limit, totalPages: Math.ceil(siteCount / limit) },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: category album  —  GET /tours/albums/category/:tag
// ─────────────────────────────────────────────────────────────────────────────
export async function getCategoryAlbum(
  tag: string,
  page: number,
  limit: number,
): Promise<AlbumPayload> {
  const trimmed = (tag ?? "").trim();
  if (!trimmed) throw new Error("ALBUM_TAG_REQUIRED");

  const title = titleCase(trimmed);
  return buildAlbum({
    siteWhere: siteCategoryWhere(trimmed),
    packageWhere: packageCategoryWhere(trimmed),
    meta: { key: `category:${title}`, type: "category", title },
    page,
    limit,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: region album  —  GET /tours/albums/region/:region
// ─────────────────────────────────────────────────────────────────────────────
export async function getRegionAlbum(
  region: string,
  page: number,
  limit: number,
): Promise<AlbumPayload> {
  const trimmed = (region ?? "").trim();
  if (!trimmed) throw new Error("ALBUM_REGION_REQUIRED");

  return buildAlbum({
    siteWhere: siteRegionWhere(trimmed),
    packageWhere: packageRegionWhere(trimmed),
    meta: { key: `region:${trimmed}`, type: "region", title: trimmed },
    page,
    limit,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: album index  —  GET /tours/albums
//
// One pass over each table (select-only) then aggregate in JS: avoids N+1
// count queries while this dataset is small, and keeps matching parity with
// the per-album endpoints by reusing the same variant logic.
// ─────────────────────────────────────────────────────────────────────────────
export async function listAlbums(): Promise<{
  categories: CategoryAlbumIndexEntry[];
  regions: RegionAlbumIndexEntry[];
}> {
  const [sites, packages] = await Promise.all([
    prisma.tourSite.findMany({
      select: { category: true, categories: true, imageUrl: true, region: true },
      orderBy: [{ region: "asc" }, { name: "asc" }],
    }),
    prisma.tour_packages.findMany({
      select: { category: true, categories: true, coverImage: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // ── category albums ──────────────────────────────────────────────────────
  interface CategoryAcc {
    title: string;
    siteCount: number;
    packageCount: number;
    coverImage: string | null;
  }
  const categories = new Map<string, CategoryAcc>();

  const ensureCategory = (rawTag: string): CategoryAcc => {
    const key = rawTag.toLowerCase();
    let entry = categories.get(key);
    if (!entry) {
      entry = {
        title: titleCase(rawTag),
        siteCount: 0,
        packageCount: 0,
        coverImage: null,
      };
      categories.set(key, entry);
    }
    return entry;
  };

  // Seed the index with every SiteCategory enum value so empty albums still
  // appear in the browse grid (albums are browseable, not error-prone).
  for (const enumTag of Object.values(SiteCategory)) ensureCategory(enumTag);

  // A row matches a tag when the enum/string column equals it case-insensitively
  // OR the categories array holds one of its case variants — same rule the
  // album endpoints apply (see header note).
  const siteMatches = (
    site: { category: SiteCategory; categories: string[] },
    tag: string,
  ): boolean => {
    const variants = tagVariants(tag);
    const upper = tag.toUpperCase();
    return (
      (isValidSiteCategory(upper) && site.category === upper) ||
      site.categories.some((c) => variants.includes(c))
    );
  };
  const packageMatches = (
    pkg: { category: string | null; categories: string[] },
    tag: string,
  ): boolean => {
    const variants = tagVariants(tag);
    return (
      (pkg.category?.toLowerCase() ?? "") === tag.toLowerCase() ||
      pkg.categories.some((c) => variants.includes(c))
    );
  };

  // Register tags discovered only in the data (supplementary array tags).
  for (const site of sites) for (const t of site.categories) ensureCategory(t);
  for (const pkg of packages) for (const t of pkg.categories) ensureCategory(t);
  for (const pkg of packages) if (pkg.category) ensureCategory(pkg.category);

  for (const [mapKey, entry] of categories) {
    for (const site of sites) {
      if (!siteMatches(site, mapKey)) continue;
      entry.siteCount += 1;
      if (!entry.coverImage && site.imageUrl) entry.coverImage = site.imageUrl;
    }
    for (const pkg of packages) {
      if (!packageMatches(pkg, mapKey)) continue;
      entry.packageCount += 1;
      if (!entry.coverImage && pkg.coverImage) entry.coverImage = pkg.coverImage;
    }
  }

  // ── region albums ────────────────────────────────────────────────────────
  interface RegionAcc {
    title: string;
    siteCount: number;
    coverImage: string | null;
  }
  const regions = new Map<string, RegionAcc>();
  for (const site of sites) {
    const key = site.region.toLowerCase();
    let entry = regions.get(key);
    if (!entry) {
      entry = { title: site.region, siteCount: 0, coverImage: null };
      regions.set(key, entry);
    }
    entry.siteCount += 1;
    if (!entry.coverImage && site.imageUrl) entry.coverImage = site.imageUrl;
  }

  const byCountThenTitle = <T extends { title: string; siteCount: number }>(a: T, b: T): number =>
    b.siteCount - a.siteCount || a.title.localeCompare(b.title);

  return {
    categories: Array.from(categories, ([, entry]) => ({
      key: `category:${entry.title}`,
      title: entry.title,
      coverImage: entry.coverImage,
      siteCount: entry.siteCount,
      packageCount: entry.packageCount,
    })).sort(byCountThenTitle),
    regions: Array.from(regions, ([, entry]) => ({
      key: `region:${entry.title}`,
      title: entry.title,
      coverImage: entry.coverImage,
      siteCount: entry.siteCount,
    })).sort(byCountThenTitle),
  };
}
