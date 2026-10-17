import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";
import { haversineDistance } from "../../helpers/haversine.js";

const toNumber = (value: unknown): number | null => {
  if (value === undefined || value === null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

export class ProviderNearbyRentalsController {
  /**
   * GET /providers/nearby-rentals?tourSiteId=...&radiusKm=...&transportType=...
   *
   * Mirrors /providers/nearby-hotels but for verified car rentals — the supply
   * the itinerary's per-day transport selection draws from. When `transportType`
   * is supplied, exact-type matches are preferred; if none exist the response
   * falls back to the closest rentals of any type and flags `matchedType: false`
   * so the client can explain the substitution.
   */
  async getNearbyRentals(req: Request, res: Response) {
    try {
      const tourSiteId = req.query.tourSiteId as string | undefined;
      const radiusKm = toNumber(req.query.radiusKm);
      const transportType = (req.query.transportType as string | undefined) ?? null;
      const limit = Math.min(100, Math.max(1, toNumber(req.query.limit) ?? 10));

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

      const center = { latitude: tourSite.latitude, longitude: tourSite.longitude };

      const providers = await prisma.provider.findMany({
        where: {
          verification_status: true,
          car_rental: { isNot: null },
        },
        include: {
          car_rental: true,
        },
      });

      const rentals = providers
        .filter((p) => !!p.car_rental)
        .map((p) => ({
          id: p.provider_id,
          name: p.display_name,
          latitude: p.location_lat,
          longitude: p.location_lng,
          locationAddress: p.location_address,
          avgRating: p.avg_rating,
          reviewCount: p.review_count,
          imageUrl: p.media_assets[0] ?? null,
          distanceKm: haversineDistance(center, {
            latitude: p.location_lat,
            longitude: p.location_lng,
          }),
          transportType: p.car_rental!.transport_type ?? null,
          vehicleMake: p.car_rental!.vehicle_make,
          vehicleModel: p.car_rental!.vehicle_model,
          vehicleYear: p.car_rental!.vehicle_year,
          transmission: p.car_rental!.transmission,
          fuelType: p.car_rental!.fuel_type,
          dailyRate: p.car_rental!.daily_rate,
          driverRequired: p.car_rental!.driver_required,
        }))
        .sort((a, b) => a.distanceKm - b.distanceKm);

      const withinRadius =
        radiusKm !== null ? rentals.filter((r) => r.distanceKm <= radiusKm) : rentals;

      const exact = transportType
        ? withinRadius.filter((r) => r.transportType === transportType)
        : withinRadius;

      // Prefer exact supply; fall back to the closest of any type only when the
      // requested type has none within radius (mirrors the itinerary engine).
      const matchedType = !transportType || exact.length > 0;
      const matches = transportType && exact.length > 0 ? exact : withinRadius;

      return ok(
        res,
        {
          matchedType,
          transportType,
          rentals: matches.slice(0, limit),
        },
        "Nearby rentals retrieved successfully",
      );
    } catch (e) {
      console.error("getNearbyRentals failed", e);
      return fail(res, 500, "Failed to get nearby rentals");
    }
  }
}
