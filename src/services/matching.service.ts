import { prisma } from "../config/index.js";
import type { Gender, LookingFor } from "../../generated/prisma/enums.js";
import { haversineDistance, maxPairwiseDistance } from "../helpers/haversine.js";

// ─────────────────────────────────────────
// Matching engine — candidate discovery, filtering & scoring
// ─────────────────────────────────────────

export interface DiscoveryFilters {
  lookingFor?: LookingFor;
  genderPreference: Gender[];
  minAge: number;
  maxAge: number;
  maxDistanceKm: number;
  locationLat?: number | null;
  locationLng?: number | null;
}

export interface MatchCandidate {
  userId: string;
  fullName: string;
  headline?: string | null;
  about?: string | null;
  photos: string[];
  heightCm?: number | null;
  interests: string[];
  lookingFor?: LookingFor | null;
  age: number | null;
  gender?: string | null;
  distanceKm: number | null;
  interestsOverlap: number;
  score: number;
  tierBoost: number;
  profileImage?: string | null;
  // Tour → dating travel fields (populated only when a travel context is supplied)
  scheduleOverlapDays?: number;
  withinGeofence?: boolean;
  availableFrom?: Date | null;
  availableTo?: Date | null;
  travelDistanceKm?: number | null;
}

// ─────────────────────────────────────────
// Tour → dating travel context
// Derives the geofence (centroid + radius of the selected tour sites) and the
// schedule window (trip start → start + total days) from a tour request, so the
// matching engine can filter candidates by proximity and schedule overlap.
// ─────────────────────────────────────────
export interface TravelContext {
  tourRequestId: string;
  start: Date;
  end: Date;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
}

const DEFAULT_GEOFENCE_RADIUS_KM = 50;

/**
 * The legally-allowed discovery gender is the OPPOSITE of the viewer's own
 * gender (MALE viewers see FEMALE profiles, FEMALE viewers see MALE profiles).
 * OTHER-gender viewers have no legally-allowed opposite, so they see nobody.
 * This is a hard compliance rule that overrides any user-configured
 * genderPreference.
 */
export function oppositeGenderPreference(myGender: string | null | undefined): Gender[] {
  if (myGender === "MALE") return ["FEMALE"];
  if (myGender === "FEMALE") return ["MALE"];
  return [];
}

export async function resolveTourTravelContext(
  tourRequestId: string,
  requesterId: string,
): Promise<TravelContext> {
  const tourRequest = await prisma.tourRequest.findUnique({
    where: { id: tourRequestId },
    select: {
      userId: true,
      durationDays: true,
      createdAt: true,
      selectedSites: { include: { tourSite: true } },
    },
  });

  if (!tourRequest) throw new Error("TOUR_REQUEST_NOT_FOUND");
  if (tourRequest.userId !== requesterId) throw new Error("FORBIDDEN");

  const sites = tourRequest.selectedSites.map((s) => s.tourSite);

  let centerLat = 0;
  let centerLng = 0;
  if (sites.length > 0) {
    centerLat = sites.reduce((acc, s) => acc + s.latitude, 0) / sites.length;
    centerLng = sites.reduce((acc, s) => acc + s.longitude, 0) / sites.length;
  }

  // Geofence radius is the max spread of the selected sites, with a sensible
  // floor so a single-site trip still yields nearby matches.
  const spreadKm =
    sites.length > 1
      ? maxPairwiseDistance(sites.map((s) => ({ latitude: s.latitude, longitude: s.longitude })))
      : 0;
  const radiusKm = Math.max(spreadKm, DEFAULT_GEOFENCE_RADIUS_KM);

  // Trip window: prep day + touring days + departure day, anchored on creation.
  const totalDays = tourRequest.durationDays + 2;
  const start = tourRequest.createdAt;
  const end = new Date(start.getTime() + totalDays * 24 * 60 * 60 * 1000);

  return {
    tourRequestId,
    start,
    end,
    centerLat,
    centerLng,
    radiusKm,
  };
}

// True when the candidate's availability window overlaps the tour trip window.
export function schedulesOverlap(
  availableFrom: Date | null | undefined,
  availableTo: Date | null | undefined,
  tripStart: Date,
  tripEnd: Date,
): boolean {
  // No stated availability → assume open (best-effort inclusion).
  if (!availableFrom || !availableTo) return true;
  return availableFrom <= tripEnd && availableTo >= tripStart;
}

export function dateRangeOverlapDays(
  availableFrom: Date | null | undefined,
  availableTo: Date | null | undefined,
  tripStart: Date,
  tripEnd: Date,
): number {
  if (!availableFrom || !availableTo) return 0;
  const overlapStart = availableFrom < tripStart ? tripStart : availableFrom;
  const overlapEnd = availableTo > tripEnd ? tripEnd : availableTo;
  if (overlapEnd < overlapStart) return 0;
  return Math.ceil((overlapEnd.getTime() - overlapStart.getTime()) / (24 * 60 * 60 * 1000));
}

// Membership tier → discovery boost multiplier (paid tiers rank higher).
const TIER_BOOST: Record<string, number> = {
  FREE: 1.0,
  BASELINE: 1.1,
  SENIOR_PIONEER: 1.15,
  SANKOFA_SETTLED: 1.2,
  BASIC: 1.15,
  SILVER: 1.25,
  GOLD_INVESTOR: 1.3,
  ELITE_AMBASSADOR: 1.4,
  FAMILY_PLAN: 1.2,
};

const DEFAULT_FILTERS: Omit<DiscoveryFilters, "genderPreference"> & {
  genderPreference: Gender[];
} = {
  genderPreference: [],
  minAge: 18,
  maxAge: 99,
  maxDistanceKm: 5000,
  locationLat: null,
  locationLng: null,
};

export function resolveTierBoost(tierCode: string | null | undefined): number {
  if (!tierCode) return TIER_BOOST.FREE;
  return TIER_BOOST[tierCode] ?? TIER_BOOST.FREE;
}

export function calculateAge(dateOfBirth: Date | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const diff = Date.now() - new Date(dateOfBirth).getTime();
  const ageDate = new Date(diff);
  return Math.abs(ageDate.getUTCFullYear() - 1970);
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function scoreCandidate(
  candidate: MatchCandidate,
  filters: DiscoveryFilters,
  myInterests: string[],
  travel?: TravelContext | null,
): number {
  let score = 0;

  // Interest overlap (strongest signal)
  if (myInterests.length > 0 && candidate.interests.length > 0) {
    const overlap = candidate.interests.filter((i) => myInterests.includes(i)).length;
    score += (overlap / Math.max(myInterests.length, candidate.interests.length)) * 40;
  }

  // Age proximity (prefer center of range)
  if (candidate.age !== null) {
    const center = (filters.minAge + filters.maxAge) / 2;
    const distance = Math.abs(candidate.age - center);
    score += Math.max(0, 30 - distance * 1.5);
  }

  // Profile completeness
  const completeness =
    (candidate.photos.length > 0 ? 10 : 0) +
    (candidate.about ? 5 : 0) +
    (candidate.headline ? 5 : 0);
  score += completeness;

  // Distance (closer is better) when both have coordinates
  if (travel && candidate.distanceKm !== null && candidate.distanceKm !== undefined) {
    score += Math.max(0, 15 - candidate.distanceKm / 20);
  } else if (filters.locationLat && filters.locationLng && candidate.distanceKm !== null) {
    score += Math.max(0, 10 - candidate.distanceKm / 100);
  }

  // Schedule overlap — bonus proportional to days the candidate is available
  // during the trip window. Candidates inside the geofence get a further bump.
  if (travel) {
    if ((candidate.scheduleOverlapDays ?? 0) > 0) {
      score += Math.min(candidate.scheduleOverlapDays ?? 0, 10);
    }
    if (candidate.withinGeofence) {
      score += 10;
    }
  }

  // Membership boost
  score *= candidate.tierBoost;

  return Math.round(score * 100) / 100;
}

async function loadMyFilters(userId: string): Promise<{
  filters: DiscoveryFilters;
  myInterests: string[];
}> {
  const [preference, profile, me] = await Promise.all([
    prisma.discoveryPreference.findUnique({ where: { userId } }),
    prisma.datingProfile.findUnique({ where: { userId } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { gender: true },
    }),
  ]);

  // Legal compliance: always show only the opposite gender, regardless of any
  // user-configured genderPreference.
  const genderPreference = oppositeGenderPreference(me?.gender ?? null);

  const filters: DiscoveryFilters = {
    lookingFor: preference?.lookingFor ?? undefined,
    genderPreference,
    minAge: preference?.minAge ?? DEFAULT_FILTERS.minAge,
    maxAge: preference?.maxAge ?? DEFAULT_FILTERS.maxAge,
    maxDistanceKm: preference?.maxDistanceKm ?? DEFAULT_FILTERS.maxDistanceKm,
    locationLat: preference?.locationLat ?? DEFAULT_FILTERS.locationLat,
    locationLng: preference?.locationLng ?? DEFAULT_FILTERS.locationLng,
  };

  return { filters, myInterests: profile?.interests ?? [] };
}

/**
 * Fetch ranked discovery candidates for a user.
 * Excludes: self, users explicitly passed (PASS), blocked users, hidden profiles.
 * Sending an expression of interest (LIKE / SUPER_LIKE) does NOT remove the
 * person from the discovery queue.
 * Optionally filters by gender preference and age range.
 *
 * Ranking is computed after fetching every candidate that matches the DB-side
 * filters, then the page is sliced — so offset pagination returns the true
 * top-ranked candidates instead of ranking only the fetched page.
 */
export async function getDiscoveryCandidates(
  userId: string,
  options: { limit?: number; offset?: number; travel?: TravelContext | null } = {},
): Promise<{ candidates: MatchCandidate[]; total: number }> {
  const { limit = 20, offset = 0, travel = null } = options;
  const { filters, myInterests } = await loadMyFilters(userId);

  const [swipes, blocks] = await Promise.all([
    prisma.userSwipe.findMany({
      where: { swiperId: userId, direction: "PASS" },
      select: { targetId: true },
    }),
    prisma.userBlock.findMany({
      where: {
        OR: [{ blockerId: userId }, { blockedId: userId }],
      },
      select: { blockerId: true, blockedId: true },
    }),
  ]);

  const excludedIds = new Set<string>([
    userId,
    ...swipes.map((s) => s.targetId),
    ...blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)),
  ]);

  const ageFilter =
    filters.minAge > 18 || filters.maxAge < 99
      ? {
          OR: [
            { dateOfBirth: null },
            {
              dateOfBirth: {
                lte: new Date(new Date().setFullYear(new Date().getFullYear() - filters.minAge)),
              },
            },
            {
              dateOfBirth: {
                gte: new Date(
                  new Date().setFullYear(new Date().getFullYear() - filters.maxAge - 1),
                ),
              },
            },
          ],
        }
      : {};

  const where = {
    id: { notIn: [...excludedIds] },
    accountStatus: "ACTIVE" as const,
    ...(filters.genderPreference.length > 0 ? { gender: { in: filters.genderPreference } } : {}),
    ...ageFilter,
    AND: [
      { datingProfile: { isNot: null } },
      { datingProfile: { discoveryPreference: { is: { showProfile: true } } } },
    ],
  };

  // Fetch every matching candidate (projected columns only), rank in memory,
  // then paginate — DB-side take/skip would rank a subset, not the whole pool.
  const users = await prisma.user.findMany({
    where,
    orderBy: { lastActiveAt: "desc" },
    select: {
      id: true,
      fullName: true,
      gender: true,
      dateOfBirth: true,
      lastActiveAt: true,
      datingProfile: {
        select: {
          headline: true,
          about: true,
          photos: true,
          heightCm: true,
          interests: true,
          lookingFor: true,
          travelLocationLat: true,
          travelLocationLng: true,
          availableFrom: true,
          availableTo: true,
        },
      },
      subscription: { select: { tierCode: true } },
      profile: { select: { bio_profile_image_url: true } },
    },
  });

  const ranked = users.map((u) => {
    const profile = u.datingProfile!;
    const age = calculateAge(u.dateOfBirth);

    // Candidate proximity to the trip geofence (when a travel context is given).
    let travelDistanceKm: number | null = null;
    let withinGeofence = false;
    if (
      travel &&
      profile.travelLocationLat != null &&
      profile.travelLocationLng != null &&
      travel.centerLat != null
    ) {
      travelDistanceKm = haversineDistance(
        { latitude: travel.centerLat, longitude: travel.centerLng },
        { latitude: profile.travelLocationLat, longitude: profile.travelLocationLng },
      );
      withinGeofence = travelDistanceKm <= travel.radiusKm;
    }

    // Schedule overlap with the trip window.
    const scheduleOverlapDays = travel
      ? dateRangeOverlapDays(profile.availableFrom, profile.availableTo, travel.start, travel.end)
      : 0;
    const overlaps = travel
      ? schedulesOverlap(profile.availableFrom, profile.availableTo, travel.start, travel.end)
      : true;

    const baseCandidate: MatchCandidate = {
      userId: u.id,
      fullName: u.fullName,
      headline: profile.headline,
      about: profile.about,
      photos: profile.photos,
      heightCm: profile.heightCm,
      interests: profile.interests,
      lookingFor: profile.lookingFor,
      age,
      gender: u.gender,
      // In global discovery the candidate's static location is not computed;
      // the travel context supplies the distance used for proximity scoring.
      distanceKm: travel ? travelDistanceKm : null,
      interestsOverlap: profile.interests.filter((i) => myInterests.includes(i)).length,
      score: 0,
      tierBoost: resolveTierBoost(u.subscription?.tierCode),
      profileImage: u.profile?.bio_profile_image_url ?? null,
      scheduleOverlapDays,
      withinGeofence,
      availableFrom: profile.availableFrom,
      availableTo: profile.availableTo,
      travelDistanceKm,
    };

    baseCandidate.score = scoreCandidate(baseCandidate, filters, myInterests, travel);

    return { baseCandidate, overlaps };
  });

  // Keep only candidates whose schedules overlap the trip (when travel context given).
  const filtered = travel
    ? ranked.filter((r) => r.overlaps).map((r) => r.baseCandidate)
    : ranked.map((r) => r.baseCandidate);

  filtered.sort((a, b) => b.score - a.score);

  const total = filtered.length;
  const candidates = filtered.slice(offset, offset + limit);

  return { candidates, total };
}
