import { describe, expect, it } from "vitest";
import {
  calculateAge,
  haversineKm,
  resolveTierBoost,
  scoreCandidate,
} from "../services/matching.service.js";
import type { MatchCandidate } from "../services/matching.service.js";

const baseFilters = {
  genderPreference: [] as never[],
  minAge: 18,
  maxAge: 60,
  maxDistanceKm: 5000,
  locationLat: 5.6037,
  locationLng: -0.187,
};

function makeCandidate(overrides: Partial<MatchCandidate>): MatchCandidate {
  return {
    userId: "u1",
    fullName: "Test",
    headline: null,
    about: null,
    photos: [],
    heightCm: null,
    interests: [],
    lookingFor: null,
    age: 30,
    gender: "FEMALE",
    distanceKm: null,
    interestsOverlap: 0,
    score: 0,
    tierBoost: 1,
    profileImage: null,
    ...overrides,
  };
}

describe("calculateAge", () => {
  it("returns null for no date of birth", () => {
    expect(calculateAge(null)).toBeNull();
    expect(calculateAge(undefined)).toBeNull();
  });

  it("computes the correct age", () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 25);
    expect(calculateAge(dob)).toBe(25);
  });
});

describe("haversineKm", () => {
  it("returns 0 for identical coordinates", () => {
    expect(haversineKm(5.6037, -0.187, 5.6037, -0.187)).toBe(0);
  });

  it("computes a plausible distance between Accra and Kumasi", () => {
    const dist = haversineKm(5.6037, -0.187, 6.6885, -1.6244);
    expect(dist).toBeGreaterThan(150);
    expect(dist).toBeLessThan(300);
  });
});

describe("resolveTierBoost", () => {
  it("defaults to FREE boost when unknown", () => {
    expect(resolveTierBoost(null)).toBe(1.0);
    expect(resolveTierBoost(undefined)).toBe(1.0);
    expect(resolveTierBoost("NOT_A_TIER")).toBe(1.0);
  });

  it("returns boost for known tiers", () => {
    expect(resolveTierBoost("FREE")).toBe(1.0);
    expect(resolveTierBoost("ELITE_AMBASSADOR")).toBe(1.4);
  });
});

describe("scoreCandidate", () => {
  it("rewards interest overlap", () => {
    const high = scoreCandidate(makeCandidate({ interests: ["Travel", "Music"] }), baseFilters, [
      "Travel",
      "Music",
    ]);
    const low = scoreCandidate(makeCandidate({ interests: ["Cooking"] }), baseFilters, [
      "Travel",
      "Music",
    ]);
    expect(high).toBeGreaterThan(low);
  });

  it("rewards profile completeness", () => {
    const complete = scoreCandidate(
      makeCandidate({ photos: ["x"], about: "bio", headline: "hi" }),
      baseFilters,
      [],
    );
    const empty = scoreCandidate(makeCandidate({}), baseFilters, []);
    expect(complete).toBeGreaterThan(empty);
  });

  it("applies the membership tier boost multiplicatively", () => {
    const free = scoreCandidate(makeCandidate({}), baseFilters, []);
    const elite = scoreCandidate(makeCandidate({ tierBoost: 1.4 }), baseFilters, []);
    expect(elite).toBeCloseTo(free * 1.4);
  });

  it("prefers ages near the center of the range", () => {
    const center = scoreCandidate(makeCandidate({ age: 35 }), baseFilters, []);
    const edge = scoreCandidate(makeCandidate({ age: 18 }), baseFilters, []);
    expect(center).toBeGreaterThan(edge);
  });
});
