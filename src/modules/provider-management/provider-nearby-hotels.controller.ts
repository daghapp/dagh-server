import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";

const toNumber = (value: unknown): number | null => {
  if (value === undefined || value === null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

export class ProviderNearbyHotelsController {
  /**
   * GET /providers/nearby-hotels?tourSiteId=...&radiusKm=...
   * Uses TourSite latitude/longitude as the center.
   */
  async getNearbyHotels(req: Request, res: Response) {
    try {
      const tourSiteId = req.query.tourSiteId as string | undefined;
      const radiusKmRaw = req.query.radiusKm;
      const radiusKm = toNumber(radiusKmRaw);

      const limitRaw = req.query.limit;
      const limit = Math.min(100, Math.max(1, toNumber(limitRaw) ?? 10));

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

      // If radiusKm is not provided, we still sort by distance and return top `limit`.
      const centerLat = tourSite.latitude;
      const centerLng = tourSite.longitude;

      // Haversine approximation in km.
      // We compute distance in application layer because Prisma doesn't do geospatial here.
      const hotels = await prisma.provider.findMany({
        where: {
          verification_status: true,
          hotel: { isNot: null },
        },
        include: {
          hotel: true,
        },
      });

      const toRad = (deg: number) => (deg * Math.PI) / 180;
      const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
      };

      const withDistance = hotels
        .map((p) => {
          const distanceKm = haversineKm(centerLat, centerLng, p.location_lat, p.location_lng);
          return {
            ...p,
            hotel: p.hotel,
            distanceKm,
          };
        })
        .sort((a, b) => a.distanceKm - b.distanceKm);

      const filtered =
        radiusKm !== null ? withDistance.filter((h) => h.distanceKm <= radiusKm) : withDistance;

      return ok(res, filtered.slice(0, limit), "Nearby hotels retrieved successfully");
    } catch (e) {
      console.error("getNearbyHotels failed", e);
      return fail(res, 500, "Failed to get nearby hotels");
    }
  }
}
