import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";
import { haversineDistance } from "../../helpers/haversine.js";
import { resolveTieredOptions } from "../../helpers/tiered-recommendation.js";
import {
  ACCOMMODATION_RADIUS_KM,
  MIN_VERIFIED_ACCOMMODATIONS,
  SUGGESTED_ALTERNATIVE_TAG,
  orderTypePreferred,
} from "../../services/accommodation-recommendation.service.js";
import {
  fetchLodgingWithinRadius,
  isExternalPlacesConfigured,
} from "../../services/places-external.service.js";
import type { AccommodationOption } from "../../validator/itinerary-validator.js";

const APARTMENT_TYPES = ["HOTEL", "GUESTHOUSE", "AIRBNB", "APARTMENTS", "MOTEL"] as const;

const toNumber = (value: unknown): number | null => {
  if (value === undefined || value === null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

export class ProviderNearbyHotelsController {
  /**
   * GET /providers/nearby-hotels?tourSiteId=...&radiusKm=...&propertyType=...&limit=...
   *
   * Tiered accommodation lookup (§1) around the tour site coordinates:
   * Tier 1 — verified internal supply (category-preferred when propertyType is
   *          given), optionally radius-filtered.
   * Tier 2 — external geographic fallback injected (tagged
   *          "Suggested Alternative Accommodation") when the verified tier is
   *          below MIN_VERIFIED_ACCOMMODATIONS.
   *
   * radiusKm remains optional: when omitted the primary tier is the whole
   * verified catalogue sorted by distance (pre-existing behaviour). The
   * external fallback applies to the spec radius (5 km) in that case.
   */
  async getNearbyHotels(req: Request, res: Response) {
    try {
      const tourSiteId = req.query.tourSiteId as string | undefined;
      const radiusKm = toNumber(req.query.radiusKm);
      const limit = Math.min(100, Math.max(1, toNumber(req.query.limit) ?? 10));

      const propertyTypeRaw = req.query.propertyType;
      const propertyType =
        typeof propertyTypeRaw === "string" &&
        (APARTMENT_TYPES as readonly string[]).includes(propertyTypeRaw)
          ? propertyTypeRaw
          : null;

      if (!tourSiteId) {
        return fail(res, 400, "tourSiteId is required");
      }

      const tourSite = await prisma.tourSite.findUnique({
        where: { id: tourSiteId },
        select: { id: true, latitude: true, longitude: true },
      });

      if (!tourSite) {
        return fail(res, 404, "Tour site not found");
      }

      const hotels = await prisma.provider.findMany({
        where: {
          verification_status: true,
          hotel: { isNot: null },
        },
        include: {
          hotel: true,
        },
      });

      const withDistance = hotels.map((p) => ({
        ...p,
        id: p.provider_id,
        hotel: p.hotel,
        distanceKm: haversineDistance(tourSite, {
          latitude: p.location_lat,
          longitude: p.location_lng,
        }),
        propertyType: p.hotel?.apartment_type ?? null,
        source: "verified" as const,
      }));

      const withinRadius =
        radiusKm !== null ? withDistance.filter((h) => h.distanceKm <= radiusKm) : withDistance;

      const anchor = {
        id: tourSite.id,
        latitude: tourSite.latitude,
        longitude: tourSite.longitude,
      };
      const fallbackRadiusKm = radiusKm ?? ACCOMMODATION_RADIUS_KM;

      const tiered = await resolveTieredOptions<AccommodationOption>({
        queryPrimary: () =>
          orderTypePreferred(withinRadius, propertyType)
            .slice(0, limit)
            .map((p) => ({
              id: p.id,
              name: p.display_name,
              latitude: p.location_lat,
              longitude: p.location_lng,
              distanceKm: p.distanceKm,
              propertyType: p.propertyType,
              source: "verified" as const,
              imageUrl: p.media_assets[0] ?? null,
              images: p.media_assets,
              description: p.bio_description ?? null,
              address: p.location_address ?? null,
              basePricePerNight: p.hotel?.base_price_per_night ?? null,
              avgRating: p.avg_rating ?? 0,
              reviewCount: p.review_count ?? 0,
              googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.display_name)}`,
            })),
        queryFallback: async () => {
          const external = isExternalPlacesConfigured()
            ? await fetchLodgingWithinRadius(anchor, fallbackRadiusKm)
            : [];
          return orderTypePreferred(external, propertyType)
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

        minResults: MIN_VERIFIED_ACCOMMODATIONS,
        limit,
      });

      return ok(
        res,
        tiered.options,
        tiered.tier === "fallback"
          ? "Nearby hotels retrieved successfully (suggested alternatives)"
          : "Nearby hotels retrieved successfully",
      );
    } catch (e) {
      console.error("getNearbyHotels failed", e);
      return fail(res, 500, "Failed to get nearby hotels");
    }
  }
}
