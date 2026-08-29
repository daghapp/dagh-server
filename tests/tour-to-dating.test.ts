import { describe, expect, it } from "vitest";
import {
  schedulesOverlap,
  dateRangeOverlapDays,
  scoreCandidate,
  type MatchCandidate,
} from "../src/services/matching.service.js";
import { createTourRequestSchema } from "../src/validator/itinerary-validator.js";

const baseFilters = {
  genderPreference: [] as never[],
  minAge: 18,
  maxAge: 60,
  maxDistanceKm: 5000,
  locationLat: 5.6037,
  locationLng: -0.187,
};

const tripStart = new Date("2026-11-01T00:00:00Z");
const tripEnd = new Date("2026-11-11T00:00:00Z");

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

describe("schedulesOverlap", () => {
  it("treats candidates without an availability window as open", () => {
    expect(schedulesOverlap(null, null, tripStart, tripEnd)).toBe(true);
    expect(schedulesOverlap(undefined, undefined, tripStart, tripEnd)).toBe(true);
  });

  it("returns true when windows overlap", () => {
    expect(
      schedulesOverlap(
        new Date("2026-11-03T00:00:00Z"),
        new Date("2026-11-09T00:00:00Z"),
        tripStart,
        tripEnd,
      ),
    ).toBe(true);
  });

  it("returns false when windows do not overlap", () => {
    expect(
      schedulesOverlap(
        new Date("2026-12-01T00:00:00Z"),
        new Date("2026-12-10T00:00:00Z"),
        tripStart,
        tripEnd,
      ),
    ).toBe(false);
  });
});

describe("dateRangeOverlapDays", () => {
  it("counts overlapping days", () => {
    const days = dateRangeOverlapDays(
      new Date("2026-11-03T00:00:00Z"),
      new Date("2026-11-09T00:00:00Z"),
      tripStart,
      tripEnd,
    );
    expect(days).toBe(6);
  });

  it("returns 0 for non-overlapping windows", () => {
    const days = dateRangeOverlapDays(
      new Date("2026-12-01T00:00:00Z"),
      new Date("2026-12-10T00:00:00Z"),
      tripStart,
      tripEnd,
    );
    expect(days).toBe(0);
  });

  it("returns 0 when availability is missing", () => {
    expect(dateRangeOverlapDays(null, null, tripStart, tripEnd)).toBe(0);
  });
});

describe("scoreCandidate with travel context", () => {
  const travel = {
    tourRequestId: "tr1",
    start: tripStart,
    end: tripEnd,
    centerLat: 5.6037,
    centerLng: -0.187,
    radiusKm: 50,
  };

  it("rewards candidates inside the geofence", () => {
    const inside = scoreCandidate(
      makeCandidate({ distanceKm: 10, withinGeofence: true }),
      baseFilters,
      [],
      travel,
    );
    const outside = scoreCandidate(
      makeCandidate({ distanceKm: 500, withinGeofence: false }),
      baseFilters,
      [],
      travel,
    );
    expect(inside).toBeGreaterThan(outside);
  });

  it("rewards schedule overlap", () => {
    const overlapping = scoreCandidate(
      makeCandidate({ scheduleOverlapDays: 5 }),
      baseFilters,
      [],
      travel,
    );
    const nonOverlapping = scoreCandidate(
      makeCandidate({ scheduleOverlapDays: 0 }),
      baseFilters,
      [],
      travel,
    );
    expect(overlapping).toBeGreaterThan(nonOverlapping);
  });
});

describe("createTourRequestSchema casualDatingInterest", () => {
  const basePayload = {
    tourSiteIds: ["1ad36343-904a-4a0c-a740-b68484dd51cb"],
    tourType: "SINGLE",
    durationDays: 5,
  };

  it("defaults casualDatingInterest to false when omitted", () => {
    const result = createTourRequestSchema.safeParse(basePayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.casualDatingInterest).toBe(false);
    }
  });

  it("accepts an explicit casualDatingInterest", () => {
    const result = createTourRequestSchema.safeParse({
      ...basePayload,
      casualDatingInterest: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.casualDatingInterest).toBe(true);
    }
  });
});
