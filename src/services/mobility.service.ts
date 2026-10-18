import { prisma } from "../config/index.js";
import type { PublicTransportService, TransitProfile } from "../../generated/prisma/client.js";
import { haversineDistance } from "../helpers/haversine.js";
import { resolveTieredOptions } from "../helpers/tiered-recommendation.js";
import {
  deriveTransitProfile,
  getMobilityHints,
  getTransportHints,
} from "../helpers/transit-profile.js";
import type {
  CarRentalOption,
  MobilityAnchor,
  PublicTransportOption,
  SiteMobility,
} from "../validator/itinerary-validator.js";

/**
 * Transit & mobility engine (§2: Integrated Transit & Mobility Suggestions).
 *
 * Applies the accommodation engine's tiered lookup logic (§1) to transport —
 * including public transport (STC, VIP buses, trotro corridors, air):
 *
 * Tier 1 — PRIMARY: verified car-rental supply and public-transport boarding
 *          points within the radius around the tour site.
 * Tier 2 — FALLBACK: when a tier is empty/insufficient, the nearest options
 *          from the national catalogue are returned with honest distances and
 *          the "Suggested Alternative Transport" tag.
 *
 * What is *offered* is then gated by the site's `transit_profile`
 * (URBAN_CENTER / PERI_URBAN / RURAL): ride-hailing hints only appear where
 * they operate, rural sites get station-based trotro guidance (primary
 * station of origin, boarding route, drop-off), everywhere gets intercity
 * coach and nearest-airport options.
 */

/** Boarding points within this radius count as "on the doorstep" (per mode). */
export const MOBILITY_RADIUS_KM = 25;
/** Airports are sparse — a much wider primary radius applies. */
export const MOBILITY_AIR_RADIUS_KM = 150;
export const SUGGESTED_ALTERNATIVE_TRANSPORT_TAG = "Suggested Alternative Transport";

const OPTIONS_PER_MODE = 3;

/** All active catalog rows — the table is small, load once per itinerary read. */
export async function loadActiveTransportServices(): Promise<PublicTransportService[]> {
  return prisma.publicTransportService.findMany({
    where: { active: true },
    orderBy: [{ mode: "asc" }, { operator: "asc" }],
  });
}

type CarRentalRow = NonNullable<MobilityOptions["carRentals"]>[number];

/**
 * Verified car-rental supply — used when the caller (e.g. the standalone
 * mobility endpoint) has no preloaded inventory to pass in.
 */
export async function loadVerifiedCarRentals(): Promise<CarRentalRow[]> {
  const providers = await prisma.provider.findMany({
    where: { verification_status: true, car_rental: { isNot: null } },
    include: { car_rental: true },
  });

  return providers
    .filter((p) => !!p.car_rental)
    .map((p) => ({
      id: p.provider_id,
      name: p.display_name,
      latitude: p.location_lat,
      longitude: p.location_lng,
      transportType: p.car_rental!.transport_type ?? null,
      locationAddress: p.location_address,
      avgRating: p.avg_rating,
      imageUrl: p.media_assets[0] ?? null,
      vehicleMake: p.car_rental!.vehicle_make,
      vehicleModel: p.car_rental!.vehicle_model,
      dailyRate: p.car_rental!.daily_rate,
      driverRequired: p.car_rental!.driver_required,
    }));
}

export interface MobilityOptions {
  wantedTransportType?: string | null;
  wantsNoTransport?: boolean;
  /** Preloaded verified car-rental supply (itinerary mapper passes its own). */
  carRentals?: Array<{
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    transportType: string | null;
    dailyRate: number;
    driverRequired: boolean;
    vehicleMake: string;
    vehicleModel: string;
    locationAddress: string;
    avgRating: number;
    imageUrl: string | null;
  }>;
  services?: PublicTransportService[];
  radiusKm?: number;
  airRadiusKm?: number;
  limit?: number;
}

type ServiceWithDistance = PublicTransportService & { distanceKm: number | null };

/**
 * Distance from an anchor to a service's boarding point. Services without
 * coordinates sort last (kept in fallback tier, distanceKm null).
 */
function boardingDistance(
  anchor: { latitude: number; longitude: number },
  service: PublicTransportService,
): number | null {
  if (service.originLat == null || service.originLng == null) return null;
  return haversineDistance(anchor, { latitude: service.originLat, longitude: service.originLng });
}

function toPublicTransportOption(
  service: ServiceWithDistance,
  source: "primary" | "fallback",
): PublicTransportOption {
  return {
    id: service.id,
    mode: service.mode,
    operator: service.operator,
    originCity: service.originCity,
    originStation: service.originStation,
    originLat: service.originLat,
    originLng: service.originLng,
    destinationCity: service.destinationCity,
    destinationRegion: service.destinationRegion,
    notes: service.notes,
    distanceKm: service.distanceKm,
    source,
    ...(source === "fallback" ? { tag: SUGGESTED_ALTERNATIVE_TRANSPORT_TAG } : {}),
  };
}

/**
 * Tiered public-transport selection for one mode around one anchor.
 * Primary = boarding points inside `radiusKm`; fallback = nearest national
 * options (tagged) so a remote site still gets explicit transit guidance.
 */
export async function selectPublicTransportForSite(
  anchor: { latitude: number; longitude: number },
  services: PublicTransportService[],
  mode: PublicTransportService["mode"],
  radiusKm: number,
  limit = OPTIONS_PER_MODE,
): Promise<PublicTransportOption[]> {
  const byMode = services.filter((s) => s.mode === mode);
  const withDistance = byMode.map((s) => ({ ...s, distanceKm: boardingDistance(anchor, s) }));
  const located = withDistance
    .filter((s): s is ServiceWithDistance & { distanceKm: number } => s.distanceKm !== null)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const tiered = await resolveTieredOptions<PublicTransportOption>({
    queryPrimary: () =>
      located
        .filter((s) => s.distanceKm <= radiusKm)
        .slice(0, limit)
        .map((s) => toPublicTransportOption(s, "primary")),
    queryFallback: () => located.slice(0, limit).map((s) => toPublicTransportOption(s, "fallback")),
    minResults: 1,
    limit,
  });

  return tiered.options;
}

/** Category-first ordering of car rentals (mirrors the accommodation engine). */
function orderTransportTypePreferred<
  T extends { distanceKm: number; transportType: string | null },
>(items: T[], wantedType: string | null): T[] {
  if (!wantedType) return items;
  const exact = items.filter((i) => i.transportType === wantedType);
  const rest = items.filter((i) => i.transportType !== wantedType);
  return [...exact, ...rest];
}

/**
 * Tiered car-rental selection around one anchor: verified supply within the
 * radius first (matching the requested transport type), escalating to the
 * nearest verified supply nationally — tagged as a suggested alternative.
 */
export async function selectCarRentalsForSite(
  anchor: { latitude: number; longitude: number },
  carRentals: NonNullable<MobilityOptions["carRentals"]>,
  wantedType: string | null,
  radiusKm: number,
  limit: number,
): Promise<CarRentalOption[]> {
  const withDistance = carRentals
    .map((r) => ({ ...r, distanceKm: haversineDistance(anchor, r) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const tiered = await resolveTieredOptions<CarRentalOption>({
    queryPrimary: () =>
      orderTransportTypePreferred(
        withDistance.filter((r) => r.distanceKm <= radiusKm),
        wantedType,
      )
        .slice(0, limit)
        .map((r) => ({ ...r, source: "verified" as const })),
    queryFallback: () =>
      orderTransportTypePreferred(withDistance, wantedType)
        .slice(0, limit)
        .map((r) => ({
          ...r,
          source: "verified" as const,
          tag: SUGGESTED_ALTERNATIVE_TRANSPORT_TAG,
        })),
    minResults: 1,
    limit,
  });

  return tiered.options;
}

/**
 * Full mobility profile for every itinerary site.
 *
 * @param sites itinerary anchors — `transitProfile` taken from the site row
 *        when present, otherwise derived from the region (§2).
 */
export async function resolveMobilityForSites(
  sites: MobilityAnchor[],
  opts: MobilityOptions = {},
): Promise<Record<string, SiteMobility>> {
  const radiusKm = opts.radiusKm ?? MOBILITY_RADIUS_KM;
  const airRadiusKm = opts.airRadiusKm ?? MOBILITY_AIR_RADIUS_KM;
  const limit = opts.limit ?? OPTIONS_PER_MODE;
  const wantsNoTransport = !!opts.wantsNoTransport;

  const services = opts.services ?? (await loadActiveTransportServices());
  const carRentals = opts.carRentals ?? (await loadVerifiedCarRentals());

  const out: Record<string, SiteMobility> = {};
  for (const site of sites) {
    const transitProfile: TransitProfile =
      site.transitProfile ?? deriveTransitProfile(site.region ?? "");
    const hints = getMobilityHints(transitProfile);

    const [intercityBus, trotro, air, rentals] = await Promise.all([
      selectPublicTransportForSite(site, services, "INTERCITY_BUS", radiusKm, limit),
      selectPublicTransportForSite(site, services, "TROTRO", radiusKm, limit),
      selectPublicTransportForSite(site, services, "DOMESTIC_AIR", airRadiusKm, limit),
      wantsNoTransport
        ? Promise.resolve([])
        : selectCarRentalsForSite(
            site,
            carRentals,
            opts.wantedTransportType ?? null,
            radiusKm,
            limit,
          ),
    ]);

    out[site.id] = {
      siteId: site.id,
      transitProfile,
      rideHailing: hints.rideHailing,
      localTransit: hints.localTransit,
      intercityBus,
      trotro,
      air,
      carRentals: rentals,
      hints: getTransportHints(transitProfile),
    };
  }
  return out;
}
