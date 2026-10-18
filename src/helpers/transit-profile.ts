import type { TransitProfile } from "../../generated/prisma/client.js";

/**
 * Transit/mobility profile derivation and hint building (§2).
 *
 * Every tour site stores a `transit_profile` accessibility tier. This module is
 * the single source of truth for:
 *   1. Deriving a profile from a region when a row predates the column or a
 *      user-submitted site has not been moderated yet (seed + approval paths).
 *   2. Turning a profile into structured transport suggestions — ride-hailing
 *      and car rentals in urban corridors, trotro/station-based transit and
 *      intercity buses (STC, VIP) as you move outward, air transport where it
 *      exists. The mobility service resolves the concrete services; these hints
 *      are the cheap, always-available advisory layer.
 */

export type TransitProfileValue = TransitProfile;

// Regions whose population centres carry reliable ride-hailing coverage.
const URBAN_REGIONS = new Set(["Greater Accra", "Ashanti", "Central", "Western"]);

// Regions that are predominantly rural: local transit is station-based.
const RURAL_REGIONS = new Set([
  "Volta",
  "Oti",
  "Northern",
  "North East",
  "Upper East",
  "Upper West",
  "Savannah",
]);

/**
 * Region → accessibility tier. Mirrors the seeded knowledge of Ghana's
 * geography: the Greater Accra/Ashanti/Central/Western corridor is urbanised,
 * the northern and Volta belts are predominantly rural, everything else is
 * peri-urban. Exported for seeding and the pending-site approval pipeline.
 */
export function deriveTransitProfile(region: string): TransitProfileValue {
  const normalized = region.trim();
  if (URBAN_REGIONS.has(normalized)) return "URBAN_CENTER";
  if (RURAL_REGIONS.has(normalized)) return "RURAL";
  return "PERI_URBAN";
}

export interface MobilityHintSet {
  /** Ride-hailing apps available (urban corridors only). */
  rideHailing: string[];
  /** On-the-ground local transit around the site. */
  localTransit: string[];
  /** Intercity coach operators serving the corridor. */
  intercityBus: string[];
  /** Air transport availability. */
  air: string[];
}

/**
 * Structured hints per profile. Rural sites are explicit about station-based
 * boarding (primary station + route + drop-off) because ride-hailing does not
 * reach them reliably.
 */
export function getMobilityHints(profile: TransitProfileValue): MobilityHintSet {
  switch (profile) {
    case "URBAN_CENTER":
      return {
        rideHailing: ["Uber", "Yango"],
        localTransit: ["Trotro", "Car Rental"],
        intercityBus: ["STC", "VIP Bus"],
        air: ["Domestic Air"],
      };
    case "PERI_URBAN":
      return {
        rideHailing: [],
        localTransit: ["Trotro from main station", "Local Car Rental with Driver"],
        intercityBus: ["STC", "VIP Bus"],
        air: [],
      };
    case "RURAL":
      return {
        rideHailing: [],
        localTransit: [
          "Trotro from main station (boarding route + drop-off junctions)",
          "Car Rental with Driver",
          "Private Hire",
        ],
        intercityBus: ["STC", "VIP Bus"],
        air: [],
      };
  }
}

/**
 * Flat hint list kept for the itinerary `transportHints` response field.
 * Combines every hint bucket in a stable order.
 */
export function getTransportHints(profile: TransitProfileValue): string[] {
  const hints = getMobilityHints(profile);
  return [...hints.rideHailing, ...hints.localTransit, ...hints.intercityBus, ...hints.air];
}
