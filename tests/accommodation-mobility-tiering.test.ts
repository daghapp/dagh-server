import { describe, expect, it, vi } from "vitest";
import { dedupeById, resolveTieredOptions } from "../src/helpers/tiered-recommendation.js";
import {
  orderTypePreferred,
  recommendAccommodationsForSites,
  SUGGESTED_ALTERNATIVE_TAG,
  type VerifiedAccommodation,
} from "../src/services/accommodation-recommendation.service.js";
import {
  selectCarRentalsForSite,
  selectPublicTransportForSite,
  recommendPublicTransportForSites,
  resolveMobilityForSites,
  SUGGESTED_ALTERNATIVE_TRANSPORT_TAG,
} from "../src/services/mobility.service.js";
import { createTourRequestSchema } from "../src/validator/itinerary-validator.js";
import {
  deriveTransitProfile,
  getMobilityHints,
  getTransportHints,
} from "../src/helpers/transit-profile.js";
import {
  classifyPropertyType,
  clearExternalPlacesCache,
} from "../src/services/places-external.service.js";
import type { PublicTransportService } from "../generated/prisma/client.js";

/**
 * Tiered accommodation (§1) and transit/mobility (§2) engines.
 *
 * The engines share resolveTieredOptions; these tests exercise the shared
 * resolver plus each engine's real query closures with in-memory supply, so
 * no network call and no DB is needed. External (Google Places) fallback is
 * unconfigured in the test env, which is itself asserted: the accommodation
 * fallback tier degrades to [] rather than throwing.
 */

const ACCRA = { id: "site-accra", latitude: 5.6037, longitude: -0.187 };
const TAMALE = { id: "site-tamale", latitude: 9.4034, longitude: -0.8424 };

// ─────────────────────────────────────────
// Shared resolver
// ─────────────────────────────────────────
describe("resolveTieredOptions", () => {
  it("returns primary options without consulting the fallback when enough", async () => {
    let fallbackCalled = false;
    const res = await resolveTieredOptions({
      queryPrimary: () => [{ id: "a" }, { id: "b" }],
      queryFallback: () => {
        fallbackCalled = true;
        return [{ id: "x" }];
      },
      minResults: 2,
      limit: 3,
    });

    expect(res.tier).toBe("primary");
    expect(res.options.map((o) => o.id)).toEqual(["a", "b"]);
    expect(fallbackCalled).toBe(false);
  });

  it("merges primary ahead of fallback on escalation, deduped by id", async () => {
    const res = await resolveTieredOptions({
      queryPrimary: () => [{ id: "a" }],
      queryFallback: () => [{ id: "a" }, { id: "x" }, { id: "y" }],
      minResults: 2,
      limit: 3,
    });

    expect(res.tier).toBe("fallback");
    expect(res.options.map((o) => o.id)).toEqual(["a", "x", "y"]);
  });

  it("reports exhausted when both tiers are empty", async () => {
    const res = await resolveTieredOptions({
      queryPrimary: () => [],
      queryFallback: () => [],
      minResults: 1,
    });

    expect(res.exhausted).toBe(true);
    expect(res.options).toEqual([]);
  });

  it("supports async query closures", async () => {
    const res = await resolveTieredOptions({
      queryPrimary: async () => [],
      queryFallback: async () => [{ id: "late" }],
      minResults: 1,
    });
    expect(res.options.map((o) => o.id)).toEqual(["late"]);
  });
});

describe("dedupeById", () => {
  it("keeps first occurrence in order", () => {
    const out = dedupeById([{ id: "1" }, { id: "2" }, { id: "1" }]);
    expect(out.map((o) => o.id)).toEqual(["1", "2"]);
  });
});

// ─────────────────────────────────────────
// §1 Accommodation engine
// ─────────────────────────────────────────
describe("orderTypePreferred", () => {
  const items = [
    { distanceKm: 1, propertyType: "GUESTHOUSE" },
    { distanceKm: 2, propertyType: "HOTEL" },
    { distanceKm: 3, propertyType: "HOTEL" },
    { distanceKm: 4, propertyType: "AIRBNB" },
  ];

  it("puts matching category first, preserving distance order within groups", () => {
    const out = orderTypePreferred(items, "HOTEL");
    expect(out.map((i) => i.propertyType)).toEqual(["HOTEL", "HOTEL", "GUESTHOUSE", "AIRBNB"]);
  });

  it("is a no-op when no type is wanted", () => {
    expect(orderTypePreferred(items, null)).toEqual(items);
  });
});

describe("recommendAccommodationsForSites (§1)", () => {
  const verified: VerifiedAccommodation[] = [
    { id: "h1", name: "Accra Lodge", latitude: 5.605, longitude: -0.19, propertyType: "HOTEL" },
    {
      id: "h2",
      name: "Osu Guesthouse",
      latitude: 5.59,
      longitude: -0.185,
      propertyType: "GUESTHOUSE",
    },
    // ~130 km away — outside the 5 km primary radius of the Accra site.
    {
      id: "h3",
      name: "Cape Coast Resort",
      latitude: 5.1054,
      longitude: -1.2466,
      propertyType: "HOTEL",
    },
  ];

  it("returns verified supply within 5 km, category-preferred", async () => {
    const out = await recommendAccommodationsForSites([ACCRA], "GUESTHOUSE", {
      verifiedProviders: verified,
      // minResults high enough that the (unconfigured) external fallback runs
      // but returns [] — options stay verified-only.
      minResults: 99,
    });

    const options = out[ACCRA.id];
    // h1 + h2 within 5 km; h3 is far away and must not appear.
    expect(options.map((o) => o.id).sort()).toEqual(["h1", "h2"]);
    expect(options.every((o) => o.source === "verified")).toBe(true);
    // GUESTHOUSE preferred over the nearer HOTEL.
    expect(options[0].id).toBe("h2");
  });

  it("excludes everything when the site has no supply in radius (external tier unconfigured)", async () => {
    const out = await recommendAccommodationsForSites([TAMALE], null, {
      verifiedProviders: verified,
    });
    expect(out[TAMALE.id]).toEqual([]);
  });

  it("tags external fallback rows when the external tier fires", async () => {
    // Stub the Places API so the fallback tier returns a "lodging" result,
    // then assert the engine injects it with the alternative tag.
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    clearExternalPlacesCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            place_id: "p1",
            name: "Coastal Hotel Bakken",
            geometry: { location: { lat: 5.6037, lng: -0.187 } },
            types: ["lodging", "hotel"],
            vicinity: "Osu, Accra",
          },
        ],
      }),
    } as Response);

    try {
      const out = await recommendAccommodationsForSites([TAMALE], null, {
        verifiedProviders: [], // nothing internal — external tier must fire.
        radiusKm: 500, // widen the radius so the stubbed Accra point lands inside.
      });

      const options = out[TAMALE.id];
      expect(options).toHaveLength(1);
      expect(options[0].id).toBe("ext:p1");
      expect(options[0].source).toBe("external");
      expect(options[0].tag).toBe(SUGGESTED_ALTERNATIVE_TAG);
      expect(options[0].propertyType).toBe("HOTEL");
    } finally {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      clearExternalPlacesCache();
    }
  });
});

describe("classifyPropertyType", () => {
  it("classifies hotels and apartments from free text", () => {
    expect(classifyPropertyType("Hotel Santingo, Accra")).toBe("HOTEL");
    expect(classifyPropertyType("Serviced Apartments East Legon")).toBe("APARTMENTS");
    expect(classifyPropertyType("Cozy guest house near the fort")).toBe("GUESTHOUSE");
    expect(classifyPropertyType(undefined, null, "Airbnb Host Place")).toBe("AIRBNB");
  });

  it("returns null when nothing matches", () => {
    expect(classifyPropertyType("Some random lodging")).toBeNull();
  });
});

// ─────────────────────────────────────────
// §2 Mobility engine
// ─────────────────────────────────────────
const service = (
  over: Partial<PublicTransportService> & Pick<PublicTransportService, "id" | "mode">,
): PublicTransportService =>
  ({
    operator: "STC",
    originCity: "Accra",
    originStation: null,
    originLat: null,
    originLng: null,
    destinationCity: null,
    destinationRegion: null,
    destinationLat: null,
    destinationLng: null,
    notes: null,
    active: true,
    createdAt: new Date(),
    ...over,
  }) as PublicTransportService;

const catalogue: PublicTransportService[] = [
  // STC Accra Circle — near the Accra site (< 25 km), far from Tamale.
  service({
    id: "bus-accra",
    mode: "INTERCITY_BUS",
    operator: "STC",
    originCity: "Accra",
    originStation: "Circle (Accra)",
    originLat: 5.5556,
    originLng: -0.2166,
    destinationCity: "Tamale",
  }),
  // VIP Kumasi — far from Accra.
  service({
    id: "bus-kumasi",
    mode: "INTERCITY_BUS",
    operator: "VIP",
    originCity: "Kumasi",
    originStation: "Asafo",
    originLat: 6.6885,
    originLng: -1.6244,
  }),
  // Trotro corridor near Cape Coast.
  service({
    id: "trotro-cc",
    mode: "TROTRO",
    operator: "Mankessim Trotro",
    originCity: "Cape Coast",
    originStation: "Kotokuraba Station",
    originLat: 5.1054,
    originLng: -1.2466,
  }),
  // Airport — only within the wider 150 km air radius.
  service({
    id: "air-kotoka",
    mode: "DOMESTIC_AIR",
    operator: "Ghana Airports",
    originCity: "Accra",
    originStation: "Kotoka International",
    originLat: 5.6052,
    originLng: -0.1668,
  }),
];

describe("selectPublicTransportForSite (§2)", () => {
  it("returns boarding points within the radius as primary", async () => {
    const out = await selectPublicTransportForSite(ACCRA, catalogue, "INTERCITY_BUS", 25);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("bus-accra");
    expect(out[0].source).toBe("primary");
    expect(out[0].tag).toBeUndefined();
    expect(out[0].distanceKm).toBeLessThanOrEqual(25);
  });

  it("escalates to the nearest national options, tagged, when the radius is empty", async () => {
    const out = await selectPublicTransportForSite(TAMALE, catalogue, "INTERCITY_BUS", 25);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].tag).toBe(SUGGESTED_ALTERNATIVE_TRANSPORT_TAG);
    expect(out[0].source).toBe("fallback");
    // Nearest first — Kumasi (~300 km) beats Accra (~430 km) from Tamale.
    expect(out[0].id).toBe("bus-kumasi");
  });

  it("serves wider air radius", async () => {
    const out = await selectPublicTransportForSite(ACCRA, catalogue, "DOMESTIC_AIR", 150);
    expect(out.map((o) => o.id)).toEqual(["air-kotoka"]);
  });
});

describe("selectCarRentalsForSite (§2)", () => {
  const rentals = [
    {
      id: "r1",
      name: "Accra Wheels",
      latitude: 5.6037,
      longitude: -0.187,
      transportType: "UBER",
      dailyRate: 300,
      driverRequired: true,
      vehicleMake: "Toyota",
      vehicleModel: "Corolla",
      locationAddress: "Osu",
      avgRating: 4.5,
      imageUrl: null,
    },
    {
      id: "r2",
      name: "Coast Drive",
      latitude: 5.1054,
      longitude: -1.2466,
      transportType: "RENTED_VEHICLE",
      dailyRate: 400,
      driverRequired: true,
      vehicleMake: "Hyundai",
      vehicleModel: "Tucson",
      locationAddress: "Cape Coast",
      avgRating: 4.2,
      imageUrl: null,
    },
  ];

  it("prefers the requested transport type within the radius", async () => {
    const out = await selectCarRentalsForSite(ACCRA, rentals, "UBER", 25, 3);
    expect(out[0].id).toBe("r1");
    expect(out[0].source).toBe("verified");
  });

  it("falls back to national supply with the alternative tag", async () => {
    const out = await selectCarRentalsForSite(TAMALE, rentals, null, 25, 3);
    expect(out.length).toBe(2);
    expect(out.every((o) => o.tag === SUGGESTED_ALTERNATIVE_TRANSPORT_TAG)).toBe(true);
    // Distance order: Accra first.
    expect(out[0].id).toBe("r1");
  });
});

describe("resolveMobilityForSites (§2)", () => {
  it("gates ride-hailing by transit profile and includes STC/trotro/air buckets", async () => {
    const mobility = await resolveMobilityForSites(
      [
        { ...ACCRA, region: "Greater Accra", transitProfile: "URBAN_CENTER" },
        { ...TAMALE, region: "Northern", transitProfile: "RURAL" },
      ],
      { services: catalogue, carRentals: [], wantsNoTransport: false },
    );

    // Urban: ride-hailing offered.
    expect(mobility[ACCRA.id].rideHailing).toContain("Uber");
    expect(mobility[ACCRA.id].intercityBus.map((o) => o.id)).toContain("bus-accra");
    expect(mobility[ACCRA.id].air.map((o) => o.id)).toContain("air-kotoka");

    // Rural: no ride-hailing; station-based trotro guidance instead.
    expect(mobility[TAMALE.id].rideHailing).toEqual([]);
    expect(mobility[TAMALE.id].localTransit.join(" ")).toMatch(/station/i);
  });

  it("derives the profile from region when the row predates the column", async () => {
    const mobility = await resolveMobilityForSites(
      [{ ...TAMALE, region: "Northern", transitProfile: null }],
      { services: catalogue, carRentals: [] },
    );
    expect(mobility[TAMALE.id].transitProfile).toBe("RURAL");
  });

  it("omits car rentals on transport opt-out but keeps public transit guidance", async () => {
    const mobility = await resolveMobilityForSites([{ ...ACCRA, transitProfile: "URBAN_CENTER" }], {
      services: catalogue,
      carRentals: [
        {
          id: "r1",
          name: "Accra Wheels",
          latitude: 5.6037,
          longitude: -0.187,
          transportType: "UBER",
          dailyRate: 300,
          driverRequired: true,
          vehicleMake: "Toyota",
          vehicleModel: "Corolla",
          locationAddress: "Osu",
          avgRating: 4.5,
          imageUrl: null,
        },
      ],
      wantsNoTransport: true,
    });

    const m = mobility[ACCRA.id];
    expect(m.carRentals).toEqual([]);
    // Public transit guidance still surfaces.
    expect(m.intercityBus.length).toBeGreaterThan(0);
    expect(m.hints.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────
// Region → profile derivation (shared by seed, moderation, engines)
// ─────────────────────────────────────────
describe("deriveTransitProfile", () => {
  it("maps urbanised regions to URBAN_CENTER", () => {
    expect(deriveTransitProfile("Greater Accra")).toBe("URBAN_CENTER");
    expect(deriveTransitProfile("Ashanti")).toBe("URBAN_CENTER");
    expect(deriveTransitProfile("Central")).toBe("URBAN_CENTER");
    expect(deriveTransitProfile("Western")).toBe("URBAN_CENTER");
  });

  it("maps the northern/Volta belt to RURAL", () => {
    expect(deriveTransitProfile("Northern")).toBe("RURAL");
    expect(deriveTransitProfile("Upper East")).toBe("RURAL");
    expect(deriveTransitProfile("Volta")).toBe("RURAL");
    expect(deriveTransitProfile("Oti")).toBe("RURAL");
  });

  it("defaults everything else to PERI_URBAN", () => {
    expect(deriveTransitProfile("Eastern")).toBe("PERI_URBAN");
    expect(deriveTransitProfile("Bono")).toBe("PERI_URBAN");
    expect(deriveTransitProfile("")).toBe("PERI_URBAN");
  });
});

describe("recommendPublicTransportForSites (§2 — accommodation-shaped)", () => {
  it("merges STC/VIP, air and trotro into one tiered list per site", async () => {
    const out = await recommendPublicTransportForSites([ACCRA], {
      services: catalogue,
      limit: 5,
    });
    const options = out[ACCRA.id];

    const ids = options.map((o) => o.id);
    expect(ids).toContain("bus-accra");
    expect(ids).toContain("air-kotoka");
    // Cape Coast trotro is outside Accra's 25 km trotro radius → national fallback.
    expect(ids).toContain("trotro-cc");

    const bus = options.find((o) => o.id === "bus-accra")!;
    expect(bus.source).toBe("primary");
    expect(bus.tag).toBeUndefined();

    const trotro = options.find((o) => o.id === "trotro-cc")!;
    expect(trotro.source).toBe("fallback");
    expect(trotro.tag).toBe(SUGGESTED_ALTERNATIVE_TRANSPORT_TAG);

    // Primary (in-radius) boarding points lead the merged list.
    expect(options[0].source).toBe("primary");
    // Every row carries the union discriminant used by available_transports.
    expect(options.every((o) => o.kind === "public_transport")).toBe(true);
  });

  it("tags every option as a suggested alternative for a remote site", async () => {
    const out = await recommendPublicTransportForSites([TAMALE], { services: catalogue, limit: 5 });
    const options = out[TAMALE.id];

    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => o.tag === SUGGESTED_ALTERNATIVE_TRANSPORT_TAG)).toBe(true);
    expect(options.every((o) => o.source === "fallback")).toBe(true);
  });
});

describe("createTourRequestSchema apartmentType (§1)", () => {
  const base = {
    tourSiteIds: ["00000000-0000-4000-8000-000000000000"],
    tourType: "SINGLE" as const,
    durationDays: 3,
  };

  it("accepts MOTEL alongside the other lodging types", () => {
    for (const apartmentType of ["HOTEL", "GUESTHOUSE", "AIRBNB", "APARTMENTS", "MOTEL"] as const) {
      const parsed = createTourRequestSchema.safeParse({ ...base, apartmentType });
      expect(parsed.success).toBe(true);
    }
  });

  it("rejects an unknown lodging type", () => {
    const parsed = createTourRequestSchema.safeParse({ ...base, apartmentType: "HOSTEL" });
    expect(parsed.success).toBe(false);
  });
});

describe("mobility/transport hints", () => {
  it("urban hints include ride-hailing", () => {
    const hints = getMobilityHints("URBAN_CENTER");
    expect(hints.rideHailing).toContain("Uber");
    expect(getTransportHints("URBAN_CENTER")).toContain("Uber");
  });

  it("rural hints are station-based and carry intercity coaches", () => {
    const hints = getMobilityHints("RURAL");
    expect(hints.rideHailing).toEqual([]);
    expect(hints.intercityBus).toEqual(["STC", "VIP Bus"]);
    expect(getTransportHints("RURAL").join(" ")).toMatch(/Trotro from main station/);
  });
});
