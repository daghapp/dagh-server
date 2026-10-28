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

export interface TravelNote {
  title: string;
  category: "local_transit" | "ride_hailing" | "intercity_bus" | "car_rental" | "domestic_air";
  description: string;
  tips: string[];
}

const TRAVEL_NOTE_DEFINITIONS: Record<string, TravelNote> = {
  "Trotro from main station (boarding route + drop-off junctions)": {
    title: "Trotro from main station (boarding route + drop-off junctions)",
    category: "local_transit",
    description:
      "Ghana's iconic and ubiquitous shared minibus transport. Departs from designated lorry stations along set corridors to major junctions and landmark drop-offs.",
    tips: [
      "Keep small Ghana Cedi (GHS) notes ready for the conductor (mate)",
      "Confirm your destination landmark with the conductor before boarding",
      "Ask for the front seat or window for better comfort",
    ],
  },
  "Trotro from main station": {
    title: "Trotro from main station",
    category: "local_transit",
    description:
      "Frequent station-based minibus shuttle connecting central transit hubs to peri-urban tourist and cultural sites.",
    tips: [
      "Board at the central regional station for the most direct route",
      "Minibuses fill up quickly; peak morning hours move fastest",
    ],
  },
  Trotro: {
    title: "Trotro",
    category: "local_transit",
    description:
      "Popular urban shared minibuses serving high-frequency routes across the city. The most authentic and affordable way to travel like a local.",
    tips: [
      "Flag down from designated bus stops or junctions",
      "Listen for the conductor calling out destination landmarks",
    ],
  },
  "Car Rental with Driver": {
    title: "Car Rental with Driver",
    category: "car_rental",
    description:
      "Private chauffeured vehicle for flexible and comfortable travel between sites, ideal for custom day trips and rural routes.",
    tips: [
      "Driver knows local terrain, shortcuts, and police checkpoints",
      "Recommended for rural or remote site hops where ride-hailing is unavailable",
      "Confirm daily itinerary and fuel arrangements with the provider in advance",
    ],
  },
  "Local Car Rental with Driver": {
    title: "Local Car Rental with Driver",
    category: "car_rental",
    description:
      "Dedicated local driver service stationed in the region, offering direct door-to-door convenience between itinerary stops.",
    tips: [
      "Allows stopping for roadside fruit markets, craft stalls, and photo ops",
      "Daily rate typically includes the driver service",
    ],
  },
  "Car Rental": {
    title: "Car Rental",
    category: "car_rental",
    description:
      "Private vehicle hire providing full autonomy for your itinerary across the region.",
    tips: [
      "Check vehicle condition, spare tire, and AC during handoff",
      "Ensure valid driver's license or International Driving Permit",
    ],
  },
  "Private Hire": {
    title: "Private Hire",
    category: "local_transit",
    description:
      "Direct private taxi or chartered vehicle hired from local stations or hotel ranks without intermediate stops or shared passengers.",
    tips: [
      "Agree on the fare or metered arrangement before departure",
      "Ideal for direct transfers between nearby towns or sites where ride-hailing isn't available",
    ],
  },
  STC: {
    title: "STC (State Transport Company)",
    category: "intercity_bus",
    description:
      "Ghana's state-owned intercity coach service with scheduled departures, air conditioning, and luggage compartments.",
    tips: [
      "Book tickets at least 24 hours ahead during weekends and holidays",
      "Arrive at the terminal 45 minutes before departure for luggage check-in",
    ],
  },
  "VIP Bus": {
    title: "VIP Bus",
    category: "intercity_bus",
    description:
      "Frequent executive intercity bus service operating major inter-regional arteries (e.g., Accra–Kumasi, Kumasi–Tamale).",
    tips: [
      "Buses depart on a load-and-go basis from major private terminals",
      "Pay at the station booking window; bring cash",
    ],
  },
  Uber: {
    title: "Uber",
    category: "ride_hailing",
    description:
      "On-demand app-based ride-hailing with upfront pricing and GPS vehicle tracking across urban corridors.",
    tips: [
      "Select in-app card or mobile money payments for frictionless trips",
      "Confirm vehicle plate number and driver identity before boarding",
    ],
  },
  Yango: {
    title: "Yango",
    category: "ride_hailing",
    description:
      "Widely available ride-hailing service in Greater Accra and Kumasi with competitive economy fares.",
    tips: [
      "Cash and mobile money are standard payment options",
      "Pin your exact pickup location carefully on the map",
    ],
  },
  "Domestic Air": {
    title: "Domestic Air",
    category: "domestic_air",
    description:
      "Scheduled commercial flights connecting Accra (Kotoka), Kumasi, Tamale, Takoradi, and Sunyani in 45–60 minutes.",
    tips: [
      "Significantly cuts 6–10 hour road journeys",
      "Valid national photo ID or passport is required for check-in",
    ],
  },
};

/**
 * Returns structured travel notes with descriptions and practical tips
 * to aid users in decision-making when tapping travel notes in the UI.
 */
export function getStructuredTravelNotes(profile: TransitProfileValue): TravelNote[] {
  const hints = getTransportHints(profile);
  return hints.map((hint) => {
    return (
      TRAVEL_NOTE_DEFINITIONS[hint] ?? {
        title: hint,
        category: "local_transit",
        description: `Travel option recommended for ${profile.toLowerCase().replace(/_/g, " ")} corridors.`,
        tips: ["Consult local station staff or your tour guide for current departure schedules."],
      }
    );
  });
}
