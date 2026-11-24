import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  discoveryPreference: { findUnique: vi.fn() },
  datingProfile: { findUnique: vi.fn() },
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  userSwipe: { findMany: vi.fn() },
  userBlock: { findMany: vi.fn() },
}));

vi.mock("../src/config/index.js", () => ({ prisma: prismaMock }));
vi.mock("../src/helpers/membership.js", () => ({
  TIER_VALUE: { FREE: 1 },
  applyFreeMode: (access: unknown) => access,
  getFreeModeTierCode: vi.fn(async () => null),
  resolveEffectiveAccess: () => ({ perksTierCode: "FREE" }),
}));
vi.mock("../src/services/dating-contacts.service.js", () => ({
  getDatingContactUserIds: vi.fn(async () => new Set<string>()),
}));

const { getDiscoveryCandidates, distanceFromViewer } =
  await import("../src/services/matching.service.js");

type UserRow = ReturnType<typeof makeUser>;

function makeUser(
  id: string,
  options: {
    lat?: number | null;
    lng?: number | null;
    lookingFor?: string | null;
  } = {},
) {
  const { lat = null, lng = null, lookingFor = null } = options;
  return {
    id,
    fullName: id,
    gender: "FEMALE",
    dateOfBirth: new Date(1995, 0, 1),
    lastActiveAt: new Date("2026-01-01T00:00:00Z"),
    datingProfile: {
      headline: null,
      about: null,
      photos: [],
      heightCm: null,
      interests: [],
      lookingFor,
      travelLocationLat: null,
      travelLocationLng: null,
      availableFrom: null,
      availableTo: null,
      discoveryPreference:
        lat != null && lng != null ? { locationLat: lat, locationLng: lng } : null,
    },
    subscription: null,
    accessGrants: [],
    profile: null,
  };
}

function setPreference(overrides: Record<string, unknown> = {}) {
  prismaMock.discoveryPreference.findUnique.mockResolvedValue({
    lookingFor: null,
    minAge: 18,
    maxAge: 99,
    maxDistanceKm: 50,
    globalDiscovery: true,
    locationLat: null,
    locationLng: null,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockResolvedValue({ gender: "MALE" });
  prismaMock.datingProfile.findUnique.mockResolvedValue({ interests: [] });
  prismaMock.userSwipe.findMany.mockResolvedValue([]);
  prismaMock.userBlock.findMany.mockResolvedValue([]);
  setPreference();
});

describe("distanceFromViewer", () => {
  it("returns null when either side has no coordinates", () => {
    const filters = {
      genderPreference: [] as never[],
      minAge: 18,
      maxAge: 99,
      maxDistanceKm: 50,
      locationLat: null,
      locationLng: null,
    };
    expect(distanceFromViewer(filters, 5.6, -0.18)).toBeNull();
    expect(
      distanceFromViewer({ ...filters, locationLat: 5.6, locationLng: -0.18 }, null, null),
    ).toBeNull();
  });

  it("computes the distance from the viewer's saved location", () => {
    const filters = {
      genderPreference: [] as never[],
      minAge: 18,
      maxAge: 99,
      maxDistanceKm: 50,
      locationLat: 5.6037,
      locationLng: -0.187,
    };
    expect(distanceFromViewer(filters, 5.6037, -0.187)).toBeCloseTo(0, 5);
    expect(distanceFromViewer(filters, 5.61, -0.187)).toBeLessThan(5);
  });
});

describe("getDiscoveryCandidates — nearby mode", () => {
  it("excludes candidates beyond maxDistanceKm or without coordinates", async () => {
    setPreference({
      globalDiscovery: false,
      maxDistanceKm: 50,
      locationLat: 5.6037,
      locationLng: -0.187,
    });
    prismaMock.user.findMany.mockResolvedValue([
      makeUser("near", { lat: 5.61, lng: -0.187 }),
      makeUser("far", { lat: 6.6885, lng: -1.6244 }),
      makeUser("unknown"),
    ] as UserRow[]);

    const result = await getDiscoveryCandidates("viewer");

    expect(result.candidates.map((c) => c.userId)).toEqual(["near"]);
    expect(result.total).toBe(1);
    expect(result.candidates[0].distanceKm).toBeLessThan(5);
  });

  it("keeps everyone when global discovery is on", async () => {
    setPreference({
      globalDiscovery: true,
      maxDistanceKm: 50,
      locationLat: 5.6037,
      locationLng: -0.187,
    });
    prismaMock.user.findMany.mockResolvedValue([
      makeUser("near", { lat: 5.61, lng: -0.187 }),
      makeUser("far", { lat: 6.6885, lng: -1.6244 }),
      makeUser("unknown"),
    ] as UserRow[]);

    const result = await getDiscoveryCandidates("viewer");

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.every((c) => c.distanceKm === null)).toBe(true);
  });
});

describe("getDiscoveryCandidates — intent filter", () => {
  it("filters the candidate query by the viewer's lookingFor preference", async () => {
    setPreference({ lookingFor: "LONG_TERM_PARTNER" });
    prismaMock.user.findMany.mockResolvedValue([makeUser("candidate")] as UserRow[]);

    await getDiscoveryCandidates("viewer");

    const where = prismaMock.user.findMany.mock.calls[0][0].where;
    expect(where.gender).toEqual({ in: ["FEMALE"] });
    const intentClause = where.AND.find(
      (clause: { datingProfile?: { OR?: Array<{ lookingFor?: string | null }> } }) =>
        clause.datingProfile?.OR?.some((candidate) => candidate.lookingFor === "LONG_TERM_PARTNER"),
    );

    expect(intentClause).toBeDefined();
    expect(intentClause.datingProfile.OR).toEqual([
      { lookingFor: "LONG_TERM_PARTNER" },
      { lookingFor: null },
    ]);
  });
});

describe("getDiscoveryCandidates — gender compliance", () => {
  it.each(["OTHER", null, "UNKNOWN", "BOGUS"])(
    "returns nobody when the viewer gender is %s",
    async (gender) => {
      prismaMock.user.findUnique.mockResolvedValue({ gender });

      const result = await getDiscoveryCandidates("viewer");

      expect(result).toEqual({ candidates: [], total: 0 });
      expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    },
  );

  it("normalizes the viewer gender before building the query", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ gender: " woman " });
    prismaMock.user.findMany.mockResolvedValue([
      { ...makeUser("candidate"), gender: "MALE" } as UserRow,
    ]);

    await getDiscoveryCandidates("viewer");

    expect(prismaMock.user.findMany.mock.calls[0][0].where.gender).toEqual({ in: ["MALE"] });
  });
});
