import { describe, expect, it } from "vitest";
import {
  nearestWithTypeFallback,
  pickLocalProvider,
} from "../src/modules/itinerary/itinerary.service.js";

type FakeProvider = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  kind: string | null;
};

// Accra-area supply, mirroring the seeded DB: one RENTED_VEHICLE operator.
const ACCRA = { latitude: 5.6037, longitude: -0.187 };
// Cape Coast (Central) — ~130km from Accra, outside the 75km local radius.
const CAPE_COAST = { latitude: 5.1054, longitude: -1.2466 };

const rentedOnly: FakeProvider[] = [
  { id: "t1", name: "DAGH Rentals", latitude: 5.6037, longitude: -0.187, kind: "RENTED_VEHICLE" },
];

const mixed: FakeProvider[] = [
  ...rentedOnly,
  { id: "t2", name: "City Uber Fleet", latitude: 5.61, longitude: -0.19, kind: "UBER" },
];

const typeOf = (p: FakeProvider) => p.kind;

describe("nearestWithTypeFallback", () => {
  it("returns exact-type matches when they exist", () => {
    const res = nearestWithTypeFallback(mixed, [ACCRA], typeOf, "UBER", { limit: 3 });
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("t2");
  });

  it("falls back to any type instead of [] when the requested type has no supply", () => {
    // Regression: selecting UBER/TROTRO used to yield available_transports: []
    // because the only verified operator is RENTED_VEHICLE.
    const res = nearestWithTypeFallback(rentedOnly, [ACCRA], typeOf, "UBER", { limit: 3 });
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("t1");
  });

  it("returns unfiltered supply when no type is requested", () => {
    const res = nearestWithTypeFallback(mixed, [ACCRA], typeOf, null, { limit: 3 });
    expect(res).toHaveLength(2);
  });

  it("returns [] when there is no supply at all", () => {
    expect(nearestWithTypeFallback([], [ACCRA], typeOf, "UBER", { limit: 3 })).toEqual([]);
  });
});

describe("pickLocalProvider", () => {
  it("prefers an exact-type match within radius", () => {
    const picked = pickLocalProvider(mixed, [ACCRA], typeOf, "UBER", 75);
    expect(picked?.id).toBe("t2");
  });

  it("falls back to another type within radius rather than null", () => {
    const picked = pickLocalProvider(rentedOnly, [ACCRA], typeOf, "UBER", 75);
    expect(picked?.id).toBe("t1");
  });

  it("falls back to the national nearest when nothing is within radius", () => {
    // Regression: Central/Ashanti days resolved to localTransport: null
    // because every provider sits in Accra (>75km away).
    const picked = pickLocalProvider(rentedOnly, [CAPE_COAST], typeOf, "RENTED_VEHICLE", 75);
    expect(picked?.id).toBe("t1");
    expect(picked!.distanceKm).toBeGreaterThan(75);
  });

  it("returns undefined for an explicit opt-out (transport NONE)", () => {
    expect(pickLocalProvider(rentedOnly, [ACCRA], typeOf, "NONE", 75, true)).toBeUndefined();
  });

  it("returns undefined when there is no supply at all", () => {
    expect(pickLocalProvider([], [ACCRA], typeOf, "UBER", 75)).toBeUndefined();
  });
});
