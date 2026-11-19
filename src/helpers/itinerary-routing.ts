import { SiteCategory } from "../../generated/prisma/client.js";
import { haversineDistance, type Coordinate } from "./haversine.js";

/**
 * Dynamic loop-based routing primitives.
 *
 * The itinerary engine used to sort every selected site by its distance from a
 * single hardcoded Accra origin and pack them into days greedily. That produces
 * cross-regional ping-ponging (Accra → Central → Accra) and multi-night Accra
 * stays because the origin sits in the middle of the list. These helpers instead
 * treat each administrative region as a contiguous node, order the nodes into a
 * crossing-free loop anchored at the user's hub, and keep Greater Accra to the
 * arrival/departure gateway unless the traveller explicitly opts in.
 *
 * Everything here is pure (no I/O) so it can be unit-tested directly.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Region catalogue
// ─────────────────────────────────────────────────────────────────────────────

export const GHANA_REGIONS = [
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
] as const;

export type GhanaRegion = (typeof GHANA_REGIONS)[number];

/** Cape Coast / Central Region is the default hub when none is supplied. */
export const DEFAULT_START_REGION = "Central";

export const ACCRA_REGION = "Greater Accra";

/** More than this many Greater Accra nights trips the cost limiter. */
export const MAX_ACCRA_NIGHTS = 2;

/**
 * Approximate administrative-capital coordinates, used to anchor a region whose
 * sites are not part of the selection (e.g. the hub itself) and as a fallback
 * when a region's own centroid cannot be computed.
 */
const REGION_FALLBACK_CENTROIDS: Record<string, Coordinate> = {
  "Greater Accra": { latitude: 5.6037, longitude: -0.187 },
  Central: { latitude: 5.1054, longitude: -1.2466 },
  Western: { latitude: 4.9016, longitude: -1.7831 },
  "Western North": { latitude: 6.2, longitude: -2.5 },
  Volta: { latitude: 6.6008, longitude: 0.4713 },
  Oti: { latitude: 7.8, longitude: 0.35 },
  Eastern: { latitude: 6.09, longitude: -0.2591 },
  Ashanti: { latitude: 6.6885, longitude: -1.6244 },
  Bono: { latitude: 7.3349, longitude: -2.3268 },
  "Bono East": { latitude: 7.5833, longitude: -1.6667 },
  Ahafo: { latitude: 7.0833, longitude: -2.4833 },
  Savannah: { latitude: 9.0667, longitude: -1.8167 },
  Northern: { latitude: 9.4008, longitude: -0.8393 },
  "North East": { latitude: 10.35, longitude: -0.5 },
  "Upper East": { latitude: 10.7856, longitude: -0.8514 },
  "Upper West": { latitude: 10.0601, longitude: -2.5099 },
};

export interface RoutableSite {
  id: string;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  category: SiteCategory;
}

/** A touring day: one contiguous region plus the sites explored that day. */
export interface RegionDayGroup {
  region: string;
  sites: RoutableSite[];
}

export function regionLabel(region: string): string {
  return /\bRegion\b/.test(region) ? region : `${region} Region`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Centroids
// ─────────────────────────────────────────────────────────────────────────────

export function regionCentroid(region: string, sites: RoutableSite[]): Coordinate {
  const inRegion = sites.filter((s) => s.region === region);
  if (inRegion.length > 0) {
    return {
      latitude: inRegion.reduce((sum, s) => sum + s.latitude, 0) / inRegion.length,
      longitude: inRegion.reduce((sum, s) => sum + s.longitude, 0) / inRegion.length,
    };
  }
  return REGION_FALLBACK_CENTROIDS[region] ?? { latitude: 5.6037, longitude: -0.187 };
}

/**
 * Resolve the loop hub. An explicit region always wins; otherwise infer the hub
 * from the selected sites so a request that omits `startRegion` is never silently
 * anchored to Central even when every selected site lies elsewhere. The most
 * frequently selected region wins; ties are broken by whichever regional centroid
 * sits closest to the selection's overall centroid.
 */
export function deriveStartRegion(sites: RoutableSite[], requested?: string | null): string {
  if (requested) return requested;
  if (sites.length === 0) return DEFAULT_START_REGION;

  const counts = new Map<string, number>();
  for (const site of sites) {
    counts.set(site.region, (counts.get(site.region) ?? 0) + 1);
  }

  const overall = {
    latitude: sites.reduce((sum, s) => sum + s.latitude, 0) / sites.length,
    longitude: sites.reduce((sum, s) => sum + s.longitude, 0) / sites.length,
  };

  const ranked = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    const distanceTo = (region: string) =>
      haversineDistance(overall, regionCentroid(region, sites));
    const byDistance = distanceTo(a[0]) - distanceTo(b[0]);
    return byDistance !== 0 ? byDistance : a[0].localeCompare(b[0]);
  });

  return ranked[0][0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Loop ordering — convex-hull (angular) sort anchored at the hub
// ─────────────────────────────────────────────────────────────────────────────

function orderAroundCentroid(
  hub: string,
  regions: string[],
  centroids: Record<string, Coordinate>,
): string[] {
  const overall = regions.reduce(
    (acc, r) => {
      acc.latitude += centroids[r].latitude;
      acc.longitude += centroids[r].longitude;
      return acc;
    },
    { latitude: 0, longitude: 0 },
  );
  overall.latitude /= regions.length;
  overall.longitude /= regions.length;

  const angle = (r: string) =>
    Math.atan2(
      centroids[r].latitude - overall.latitude,
      centroids[r].longitude - overall.longitude,
    );

  const sorted = [...regions].sort((a, b) => angle(a) - angle(b));
  const hubIndex = sorted.indexOf(hub);
  const forward = [...sorted.slice(hubIndex), ...sorted.slice(0, hubIndex)];

  // Traverse the circle clockwise from the hub. Reversing the tail is the
  // counter-clockwise circuit — pick whichever closes the loop with less travel.
  const backward = [forward[0], ...forward.slice(1).reverse()];

  const forwardScore = loopLength(forward, centroids);
  const backwardScore = loopLength(backward, centroids);
  return forwardScore <= backwardScore ? forward : backward;
}

/**
 * Total directional travel for a region circuit, including the closing leg back
 * to the hub. Used to choose between the two traversal directions.
 */
export function loopLength(order: string[], centroids: Record<string, Coordinate>): number {
  if (order.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < order.length; i++) {
    const a = centroids[order[i]];
    const b = centroids[order[(i + 1) % order.length]];
    total += haversineDistance(a, b);
  }
  return total;
}

/**
 * Build a crossing-free region cascade starting at `hub` and visiting every
 * distinct region exactly once. The hub is always first (arrival/orientation),
 * and all regions are grouped as contiguous blocks so the route never leaves and
 * re-enters a region mid-trip.
 */
export function orderRegionsByLoop(
  hub: string,
  sites: RoutableSite[],
  opts: { extraRegions?: string[] } = {},
): string[] {
  const present = new Set<string>([
    hub,
    ...(opts.extraRegions ?? []),
    ...sites.map((s) => s.region),
  ]);
  const regions = Array.from(present).filter(Boolean);

  if (regions.length <= 1) return regions;

  const centroids: Record<string, Coordinate> = {};
  for (const r of regions) centroids[r] = regionCentroid(r, sites);

  return orderAroundCentroid(hub, regions, centroids);
}

/**
 * Force Greater Accra onto a gateway when the traveller did not opt into urban
 * overnight stays. When Accra is not the hub it is moved to the end of the
 * cascade, i.e. the departure gateway; when it is the hub it already opens the
 * trip and is left untouched.
 */
export function applyAccraGatewayConstraint(
  orderedRegions: string[],
  hub: string,
  allowAccraOvernight: boolean,
): string[] {
  if (allowAccraOvernight) return orderedRegions;
  if (hub === ACCRA_REGION) return orderedRegions;

  const index = orderedRegions.indexOf(ACCRA_REGION);
  if (index === -1) return orderedRegions;
  if (index === orderedRegions.length - 1) return orderedRegions;

  const without = orderedRegions.filter((r) => r !== ACCRA_REGION);
  return [...without, ACCRA_REGION];
}

/**
 * Zero-backtracking guard: a region may appear as a single contiguous run, and
 * never again later in the cascade. Returns the offending regions (empty = ok).
 */
export function findRegionReentries(regionSequence: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const reentered = new Set<string>();
  let previous: string | null = null;

  for (const raw of regionSequence) {
    if (!raw) continue;
    if (raw !== previous) {
      if (seen.has(raw)) reentered.add(raw);
      seen.add(raw);
    }
    previous = raw;
  }

  return Array.from(reentered);
}

// ─────────────────────────────────────────────────────────────────────────────
// Within-region sequencing + day packing
// ─────────────────────────────────────────────────────────────────────────────

/** Nearest-neighbour ordering so the region is explored in one sweep. */
export function orderSitesWithinRegion(sites: RoutableSite[], entry: Coordinate): RoutableSite[] {
  const remaining = [...sites];
  const ordered: RoutableSite[] = [];
  let cursor = entry;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    remaining.forEach((site, i) => {
      const d = haversineDistance(cursor, site);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    const [next] = remaining.splice(bestIdx, 1);
    ordered.push(next);
    cursor = next;
  }

  return ordered;
}

/**
 * Pack an ordered region run into daily sessions, capping each at `maxPerDay`
 * sites and keeping every site within `maxKm` of the others that day.
 */
export function clusterSitesIntoSessions(
  orderedSites: RoutableSite[],
  maxPerDay: number,
  maxKm: number,
): RoutableSite[][] {
  const sessions: RoutableSite[][] = [];
  let current: RoutableSite[] = [];

  for (const site of orderedSites) {
    if (current.length === 0) {
      current.push(site);
      continue;
    }
    const exceedsDistance = current.some(
      (existing) =>
        haversineDistance(
          { latitude: existing.latitude, longitude: existing.longitude },
          { latitude: site.latitude, longitude: site.longitude },
        ) > maxKm,
    );

    if (exceedsDistance || current.length >= maxPerDay) {
      sessions.push(current);
      current = [site];
    } else {
      current.push(site);
    }
  }

  if (current.length > 0) sessions.push(current);
  return sessions;
}

/**
 * Turn the ordered region cascade into contiguous touring-day groups. Every day
 * belongs to exactly one region, and the regions appear in cascade order.
 */
export function buildRegionDayGroups(
  orderedRegions: string[],
  sites: RoutableSite[],
  opts: { maxPerDay: number; maxKm: number },
): RegionDayGroup[] {
  const groups: RegionDayGroup[] = [];
  let entry: Coordinate | null = null;

  for (const region of orderedRegions) {
    const regionSites = sites.filter((s) => s.region === region);
    if (regionSites.length === 0) {
      entry = regionCentroid(region, sites);
      continue;
    }

    const ordered = orderSitesWithinRegion(regionSites, entry ?? regionCentroid(region, sites));
    const sessions = clusterSitesIntoSessions(ordered, opts.maxPerDay, opts.maxKm);
    for (const session of sessions) groups.push({ region, sites: session });

    const lastSite = ordered[ordered.length - 1];
    entry = { latitude: lastSite.latitude, longitude: lastSite.longitude };
  }

  return groups;
}

// ─────────────────────────────────────────────────────────────────────────────
// Descriptive day naming
// ─────────────────────────────────────────────────────────────────────────────

/** Special-case labels for landmark POIs; otherwise fall back to the category. */
function themeForSite(site: RoutableSite): string {
  const name = site.name.toLowerCase();
  if (name.includes("kakum")) return "Canopy Walk";
  if (name.includes("wli")) return "Waterfall Trek";
  if (name.includes("mole")) return "Safari & Wildlife Drive";
  if (name.includes("cape coast castle") || name.includes("elmina")) return "Coastal Heritage";
  if (name.includes("castle") || name.includes("museum")) return "Heritage Exploration";
  if (name.includes("falls")) return "Waterfall Adventure";
  if (name.includes("mausoleum")) return "Independence Heritage";
  if (name.includes("beach")) return "Coastal Leisure";
  if (name.includes("market")) return "Cultural Market Immersion";
  return themeForCategory(site.category);
}

function themeForCategory(category: SiteCategory): string {
  switch (category) {
    case SiteCategory.NATURE:
      return "Nature Exploration";
    case SiteCategory.CULTURAL:
      return "Cultural Immersion";
    case SiteCategory.HISTORICAL:
      return "Heritage Exploration";
    case SiteCategory.BEACH:
      return "Coastal Leisure";
    case SiteCategory.WILDLIFE:
      return "Wildlife Discovery";
    case SiteCategory.RELIGIOUS:
      return "Faith & Heritage";
    case SiteCategory.SCENIC:
      return "Scenic Adventure";
    default:
      return "Guided Exploration";
  }
}

export interface DayTitleInput {
  dayType: "PREPARATION" | "TOURING" | "DEPARTURE";
  region?: string | null;
  sites?: RoutableSite[];
}

/**
 * Formula: `Day [X]: [Primary Action / Theme] ([Target Region / Hub])`.
 * The day number prefix is added by the caller; this returns the descriptive
 * half so stored titles stay region/theme focused.
 */
export function deriveDayTheme(input: DayTitleInput): string {
  const regionSuffix = input.region ? ` (${regionLabel(input.region)})` : "";

  if (input.dayType === "PREPARATION") return `Arrival & Orientation${regionSuffix}`;
  if (input.dayType === "DEPARTURE") return `Departure & Farewell${regionSuffix}`;

  const sites = input.sites ?? [];
  if (sites.length === 0) {
    return `Leisure & Free Exploration${regionSuffix}`;
  }

  const themes: string[] = [];
  for (const site of sites) {
    const theme = themeForSite(site);
    if (!themes.includes(theme)) themes.push(theme);
  }

  const label = themes.length >= 2 ? `${themes[0]} & ${themes[1]}` : themes[0];
  return `${label}${regionSuffix}`;
}

export function formatDayTitle(dayNumber: number, theme: string): string {
  return `Day ${dayNumber}: ${theme}`;
}
