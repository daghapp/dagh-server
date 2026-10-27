import { prisma } from "../config/index.js";
import type { ApartmentType } from "../../generated/prisma/client.js";
import { haversineDistance } from "../helpers/haversine.js";
import { resolveTieredOptions } from "../helpers/tiered-recommendation.js";
import type { AccommodationOption } from "../validator/itinerary-validator.js";
import { fetchLodgingWithinRadius, isExternalPlacesConfigured } from "./places-external.service.js";

/**
 * Tiered accommodation engine (§1: Expanded Accommodation Engine).
 *
 * Tier 1 — PRIMARY: verified supply in the internal database, filtered by the
 *          radius around the tour site (default 5 km) and the traveller's
 *          property type (HOTEL / GUESTHOUSE / AIRBNB / APARTMENTS / MOTEL).
 *          Matching-category rows are ordered ahead of other types.
 * Tier 2 — FALLBACK: when tier 1 returns zero or fewer than
 *          `minResults` matches, the external geographic-bounds query runs
 *          around the same coordinates. Results are classified into property
 *          types and injected with the "Suggested Alternative Accommodation"
 *          tag so remote/developing corridors still surface options.
 *
 * Both tiers feed `resolveTieredOptions`, the same resolver the mobility
 * engine uses — one lookup strategy across the platform.
 */

/** Spec default: verified supply is searched within 5 km of the tour site. */
export const ACCOMMODATION_RADIUS_KM = 5;
/** Below this many verified matches for the chosen category, escalate. */
export const MIN_VERIFIED_ACCOMMODATIONS = 2;
export const SUGGESTED_ALTERNATIVE_TAG = "Suggested Alternative Accommodation";

export interface VerifiedAccommodation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  propertyType: ApartmentType | null;
  imageUrl?: string | null;
  images?: string[];
  description?: string | null;
  address?: string | null;
  basePricePerNight?: number | null;
  avgRating?: number;
  reviewCount?: number;
  googleMapsUrl?: string | null;
}

export type AccommodationAnchor = { id: string; latitude: number; longitude: number };

/** Verified hotel/apartment supply, distance-sorted per anchor on use. */
export async function loadVerifiedAccommodations(): Promise<VerifiedAccommodation[]> {
  const providers = await prisma.provider.findMany({
    where: { verification_status: true, hotel: { isNot: null } },
    include: { hotel: true },
  });

  return providers
    .filter((p) => !!p.hotel)
    .map((p) => ({
      id: p.provider_id,
      name: p.display_name,
      latitude: p.location_lat,
      longitude: p.location_lng,
      propertyType: p.hotel!.apartment_type,
      imageUrl: p.media_assets[0] ?? null,
      images: p.media_assets,
      description: p.bio_description ?? null,
      address: p.location_address ?? null,
      basePricePerNight: p.hotel!.base_price_per_night ?? null,
      avgRating: p.avg_rating ?? 0,
      reviewCount: p.review_count ?? 0,
      googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.display_name)}`,
    }));
}

/**
 * Category-first ordering: rows matching the wanted property type come first,
 * everything else follows — both groups keep their distance ordering. Mirrors
 * the platform's "preference-aware fallback" contract: never drop nearby
 * verified supply just because its category differs.
 */
export function orderTypePreferred<T extends { distanceKm: number; propertyType: string | null }>(
  items: T[],
  wantedType: string | null,
): T[] {
  if (!wantedType) return items;
  const exact = items.filter((i) => i.propertyType === wantedType);
  const rest = items.filter((i) => i.propertyType !== wantedType);
  return [...exact, ...rest];
}

function toVerifiedOption(
  item: VerifiedAccommodation & { distanceKm: number },
): AccommodationOption {
  return {
    id: item.id,
    name: item.name,
    latitude: item.latitude,
    longitude: item.longitude,
    distanceKm: item.distanceKm,
    propertyType: item.propertyType,
    source: "verified",
    imageUrl: item.imageUrl ?? null,
    images: item.images ?? (item.imageUrl ? [item.imageUrl] : []),
    description: item.description ?? null,
    address: item.address ?? null,
    basePricePerNight: item.basePricePerNight ?? null,
    avgRating: item.avgRating ?? 0,
    reviewCount: item.reviewCount ?? 0,
    googleMapsUrl:
      item.googleMapsUrl ??
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.name)}`,
  };
}


/**
 * Tiered per-site accommodation recommendations.
 *
 * @param sites anchors (itinerary tour sites) — one option list each
 * @param wantedType traveller's accommodation preference (null = any)
 * @param opts.radiusKm primary-tier radius (spec default 5 km)
 * @param opts.minResults verified matches considered "enough" before escalating
 * @param opts.verifiedProviders preloaded supply (the itinerary mapper already
 *        loads it once — pass it in to avoid a second identical query)
 */
export async function recommendAccommodationsForSites(
  sites: AccommodationAnchor[],
  wantedType: string | null,
  opts: {
    radiusKm?: number;
    minResults?: number;
    limit?: number;
    verifiedProviders?: VerifiedAccommodation[];
  } = {},
): Promise<Record<string, AccommodationOption[]>> {
  const radiusKm = opts.radiusKm ?? ACCOMMODATION_RADIUS_KM;
  const minResults = opts.minResults ?? MIN_VERIFIED_ACCOMMODATIONS;
  const limit = opts.limit ?? 3;
  const verified = opts.verifiedProviders ?? (await loadVerifiedAccommodations());

  const out: Record<string, AccommodationOption[]> = {};
  for (const site of sites) {
    const withinRadius = verified
      .map((p) => ({ ...p, distanceKm: haversineDistance(site, p) }))
      .filter((p) => p.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    const tiered = await resolveTieredOptions<AccommodationOption>({
      // Tier 1 — internal verified database: radius + category preference.
      queryPrimary: () =>
        orderTypePreferred(withinRadius, wantedType).slice(0, limit).map(toVerifiedOption),
      // Tier 2 — external geographic query around the same coordinates.
      queryFallback: async () => {
        if (!isExternalPlacesConfigured()) return [];
        const external = await fetchLodgingWithinRadius(site, radiusKm);
        return orderTypePreferred(external, wantedType)
          .slice(0, limit)
          .map((e) => ({
            id: e.id,
            name: e.name,
            latitude: e.latitude,
            longitude: e.longitude,
            distanceKm: e.distanceKm,
            propertyType: e.propertyType,
            source: "external" as const,
            tag: SUGGESTED_ALTERNATIVE_TAG,
            imageUrl: e.imageUrl ?? null,
            images: e.images ?? (e.imageUrl ? [e.imageUrl] : []),
            description: e.description ?? null,
            address: e.address ?? null,
            basePricePerNight: null,
            avgRating: e.avgRating ?? 0,
            reviewCount: e.reviewCount ?? 0,
            googleMapsUrl: e.googleMapsUrl ?? null,
          }));
      },

      minResults,
      limit,
    });

    out[site.id] = tiered.options;
  }
  return out;
}
