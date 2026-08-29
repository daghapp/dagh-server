// NOTE: PrismaClient and enums are imported from @prisma/client.
// Run `npx prisma generate` after connecting your database to resolve these imports.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — generated after `prisma generate`
// import {
//   haversineDistance,
//   maxPairwiseDistance,
//   ORIGIN,
//   MAX_DAILY_DISTANCE_KM,
// } from "../../utils/haversine";

import { DayType, SiteCategory } from "../../../generated/prisma/client.js";
import type {
  Itinerary as PrismaItinerary,
  ItineraryDay as PrismaItineraryDay,
  ItineraryDaySite as PrismaItineraryDaySite,
  TourSite as PrismaTourSite,
  ApartmentType,
} from "../../../generated/prisma/client.js";
import { prisma } from "../../config/index.js";
import {
  haversineDistance,
  maxPairwiseDistance,
  ORIGIN,
  MAX_DAILY_DISTANCE_KM,
} from "../../helpers/haversine.js";
import type {
  SiteWithCoords,
  DayGroup,
  FeasibilityResult,
  CreateTourResponse,
  ItineraryResponse,
  CreateTourRequestInput,
  ItineraryDayInput,
  DatingSocialBlock,
} from "../../validator/itinerary-validator.js";

const MAX_SITES_PER_DAY = 3;

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: Get all available tour sites (for frontend listing)
// ─────────────────────────────────────────────────────────────────────────────
export async function getAllTourSites() {
  return prisma.tourSite.findMany({
    orderBy: [{ region: "asc" }, { name: "asc" }],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: Create a tour request and generate its itinerary
// ─────────────────────────────────────────────────────────────────────────────
export async function createTourRequest(
  input: CreateTourRequestInput,
): Promise<CreateTourResponse> {
  const {
    userId,
    tourSiteIds,
    tourType,
    durationDays,
    relocationInterest,

    apartmentType,
    transportType,
    companionInterest,
    casualDatingInterest,
  } = input;

  // ── Step 1: Fetch all selected tour sites from DB ──────────────────────────
  const rawSites = await prisma.tourSite.findMany({
    where: { id: { in: tourSiteIds } },
  });

  if (rawSites.length !== tourSiteIds.length) {
    const foundIds = rawSites.map((s: { id: string }) => s.id);
    const missing = tourSiteIds.filter((id: string) => !foundIds.includes(id));
    return {
      success: false,
      message: "One or more selected tour sites were not found.",
      data: null,
      error: `Unknown tour site IDs: ${missing.join(", ")}`,
    };
  }

  // ── Step 2: Attach distance from origin to each site ──────────────────────
  const sites: SiteWithCoords[] = rawSites.map(
    (site: {
      id: string;
      name: string;
      region: string;
      latitude: number;
      longitude: number;
      description: string;
      imageUrl: string | null;
      category: SiteCategory;
    }) => ({
      ...site,
      distanceFromOrigin: haversineDistance(ORIGIN, {
        latitude: site.latitude,
        longitude: site.longitude,
      }),
    }),
  );

  // ── Step 3: Sort sites by distance from origin (closest first) ─────────────
  sites.sort((a, b) => a.distanceFromOrigin - b.distanceFromOrigin);

  // ── Step 4: Feasibility checks ────────────────────────────────────────────
  const feasibility = checkFeasibility(sites, durationDays);

  // ── Step 5: Save tour request to DB (NO itinerary generation here) ──────
  const tourRequest = await prisma.tourRequest.create({
    data: {
      userId: userId,
      tourType,
      durationDays,
      relocationInterest: relocationInterest ?? false,

      apartmentType: apartmentType ?? undefined,

      transportType: transportType ?? undefined,
      companionInterest: companionInterest ?? false,
      casualDatingInterest: casualDatingInterest ?? false,

      status: feasibility.feasible ? "CONFIRMED" : "FAILED",

      selectedSites: {
        create: tourSiteIds.map((id: string) => ({ tourSiteId: id })),
      },
    },
  });

  // If not feasible: keep behavior consistent: return 422 from controller path.
  if (!feasibility.feasible) {
    return {
      success: false,
      message: feasibility.error!,
      data: {
        tourRequestId: tourRequest.id,
        itinerary: null,
      },
      error: feasibility.error ?? undefined,
    };
  }

  // If feasible: do not create itinerary yet. It will be generated lazily
  // when the user requests itinerary after payment SUCCESS.
  return {
    success: true,
    message: "Tour request created successfully. Proceed to complete payment to view itinerary.",
    data: {
      tourRequestId: tourRequest.id,
      itinerary: null,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: Get a previously generated itinerary or generate if payment is made using tour request ID
// ─────────────────────────────────────────────────────────────────────────────
export async function getItineraryByRequestId(
  tourRequestId: string,
  requesterId: string,
): Promise<ItineraryResponse> {
  // Payment gating: itinerary is only visible after payment SUCCESS
  const tourRequest = await prisma.tourRequest.findUnique({
    where: { id: tourRequestId },
    select: {
      id: true,
      userId: true,
      durationDays: true,
      paymentStatus: true,
      relocationInterest: true,
      apartmentType: true,
      transportType: true,
      selectedSites: {
        include: {
          tourSite: true,
        },
      },
    },
  });

  if (!tourRequest) {
    throw new Error("TOUR_REQUEST_NOT_FOUND");
  }
  if (tourRequest.userId !== requesterId) {
    throw new Error("FORBIDDEN");
  }
  if (tourRequest.paymentStatus !== "SUCCESS") {
    throw new Error("PAYMENT_REQUIRED");
  }

  // If itinerary already exists, return it mapped to ItineraryResponse
  const existing = await prisma.itinerary.findUnique({
    where: { tourRequestId },
    include: {
      days: {
        orderBy: { dayNumber: "asc" },
        include: {
          sites: {
            orderBy: { visitOrder: "asc" },
            include: { tourSite: true },
          },
        },
      },
    },
  });

  if (existing) {
    const availableParams = {
      apartmentType: tourRequest.apartmentType ?? null,
      transportType: tourRequest.transportType ?? null,
      itinerarySites: tourRequest.selectedSites
        .map((rs) => rs.tourSite)
        .map((s) => ({
          id: s.id,
          latitude: s.latitude,
          longitude: s.longitude,
        })),
      relocationInterest: !!tourRequest.relocationInterest,
    };
    return mapItineraryToResponseWithRecommendations(existing, availableParams);
  }

  // Otherwise generate itinerary lazily now that payment succeeded
  const rawSites = tourRequest.selectedSites.map((rs) => rs.tourSite);
  if (!rawSites.length) {
    throw new Error("NO_SITES_FOR_ITINERARY");
  }

  const sites: SiteWithCoords[] = rawSites.map(
    (site: {
      id: string;
      name: string;
      region: string;
      latitude: number;
      longitude: number;
      description: string;
      imageUrl: string | null;
      category: SiteCategory;
    }) => ({
      ...site,
      distanceFromOrigin: haversineDistance(ORIGIN, {
        latitude: site.latitude,
        longitude: site.longitude,
      }),
    }),
  );

  // Sort sites by distance from origin (closest first)
  sites.sort((a, b) => a.distanceFromOrigin - b.distanceFromOrigin);

  const durationDays = tourRequest.durationDays;
  const totalDays = durationDays + 2;

  const feasibility = checkFeasibility(sites, durationDays);

  // If not feasible, still persist itinerary row for traceability
  if (!feasibility.feasible) {
    // Persist trace, but do not return an itinerary structure to caller
    await prisma.itinerary.create({
      data: {
        tourRequestId: tourRequestId,
        isFeasible: false,
        feasibilityError: feasibility.error,
        totalDays,
      },
    });

    throw new Error("ITINERARY_NOT_FEASIBLE");
  }

  // Generate itinerary
  const dayGroups = buildDayGroups(sites);

  const itinerary = await prisma.itinerary.create({
    data: {
      tourRequestId: tourRequestId,
      isFeasible: true,
      feasibilityError: null,
      totalDays,
      days: {
        create: buildItineraryDaysPayload(dayGroups, durationDays),
      },
    },
    include: {
      days: {
        orderBy: { dayNumber: "asc" },
        include: {
          sites: {
            orderBy: { visitOrder: "asc" },
            include: { tourSite: true },
          },
        },
      },
    },
  });

  const availableParams = {
    apartmentType: tourRequest.apartmentType ?? null,
    transportType: tourRequest.transportType ?? null,
    itinerarySites: tourRequest.selectedSites
      .map((rs) => rs.tourSite)
      .map((s) => ({
        id: s.id,
        latitude: s.latitude,
        longitude: s.longitude,
      })),
    relocationInterest: !!tourRequest.relocationInterest,
  };

  return mapItineraryToResponseWithRecommendations(itinerary, availableParams);
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: Get all itinerary requests for the authenticated user
// (Payment gating is handled by itinerary GET endpoint. This lists requests only.)
// ─────────────────────────────────────────────────────────────────────────────
export async function getTourRequestsByUserId(userId: string) {
  return prisma.tourRequest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      selectedSites: {
        include: { tourSite: true },
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TOUR → DATING: select recommended dating profiles to merge into the itinerary
// as social / leisure blocks. Passing candidate *user* ids resolves each user's
// dating profile and persists the selection against the tour request.
// ─────────────────────────────────────────────────────────────────────────────
export async function selectDatingProfilesForTour(
  tourRequestId: string,
  requesterId: string,
  candidateUserIds: string[],
): Promise<Array<{ userId: string; datingProfileId: string; selectedAt: Date }>> {
  const tourRequest = await prisma.tourRequest.findUnique({
    where: { id: tourRequestId },
    select: { userId: true },
  });

  if (!tourRequest) throw new Error("TOUR_REQUEST_NOT_FOUND");
  if (tourRequest.userId !== requesterId) throw new Error("FORBIDDEN");

  const ids = Array.from(new Set(candidateUserIds.filter(Boolean)));

  const profiles = await prisma.datingProfile.findMany({
    where: { userId: { in: ids } },
    select: { id: true, userId: true },
  });

  if (!profiles.length) {
    throw new Error("NO_VALID_DATING_PROFILES");
  }

  const created = await prisma.$transaction(
    profiles.map((p) =>
      prisma.tourRequestDatingSelection.upsert({
        where: {
          tourRequestId_datingProfileId: {
            tourRequestId,
            datingProfileId: p.id,
          },
        },
        create: { tourRequestId, datingProfileId: p.id },
        update: {},
      }),
    ),
  );

  // Keep output ordered to match the requested ids.
  const byUser = new Map(profiles.map((p) => [p.userId, p.id]));
  const createdByProfile = new Map(created.map((c) => [c.datingProfileId, c.createdAt]));

  const selections = ids
    .filter((uid) => byUser.has(uid))
    .map((uid) => ({
      userId: uid,
      datingProfileId: byUser.get(uid)!,
      selectedAt: createdByProfile.get(byUser.get(uid)!)!,
    }));

  return selections;
}

export async function getDatingSelectionsForTour(tourRequestId: string) {
  return prisma.tourRequestDatingSelection.findMany({
    where: { tourRequestId },
    orderBy: { createdAt: "asc" },
    include: {
      datingProfile: {
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              profile: { select: { bio_profile_image_url: true, profileUrl: true } },
            },
          },
        },
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL: Feasibility checks
// ─────────────────────────────────────────────────────────────────────────────
function checkFeasibility(sites: SiteWithCoords[], durationDays: number): FeasibilityResult {
  const maxAllowedSites = durationDays * MAX_SITES_PER_DAY;
  const simulatedGroups = buildDayGroups(sites);
  // ── Check 1: Capacity ─────────────────────────────────────────────────────
  if (sites.length > maxAllowedSites) {
    return {
      feasible: false,
      error:
        `You have selected ${sites.length} sites but only have ${durationDays} touring ` +
        `day(s). A maximum of ${MAX_SITES_PER_DAY} sites can be visited per day. ` +
        `Maximum allowed for your trip is ${maxAllowedSites} sites. ` +
        `Please add more days or reduce your selected sites.`,
    };
  }

  // ── Check 2: Geographic feasibility ──────────────────────────────────────
  if (durationDays === 1) {
    // All sites must be within 250km of each other for a single day tour
    const maxDist = maxPairwiseDistance(
      sites.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
    );

    if (maxDist > MAX_DAILY_DISTANCE_KM) {
      return {
        feasible: false,
        error:
          `Your selected locations are too far apart to complete in ${durationDays} touring day(s). ` +
          `The furthest two locations are approximately ${Math.round(maxDist)}km apart. ` +
          `Maximum travel distance between any two sites in a single day is ${MAX_DAILY_DISTANCE_KM}km (~3 hours).`,
      };
    }
  } else {
    // Simulate grouping and check each group for internal distance violations
    // const simulatedGroups = buildDayGroups(sites);
    for (let i = 0; i < simulatedGroups.length; i++) {
      const group = simulatedGroups[i];
      if (group.sites.length < 2) continue;

      const maxDist = maxPairwiseDistance(
        group.sites.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
      );

      if (maxDist > MAX_DAILY_DISTANCE_KM) {
        return {
          feasible: false,
          error:
            `Touring day ${i + 1} contains locations that are too far apart ` +
            `(~${Math.round(maxDist)}km). ` +
            `Maximum travel distance between any two sites in a single day is ${MAX_DAILY_DISTANCE_KM}km (~3 hours). ` +
            `Try adding more touring days so these locations can be split across days.`,
        };
      }
    }
  }

  const requiredDays = simulatedGroups.length;
  if (requiredDays > durationDays) {
    return {
      feasible: false,
      error:
        `Your selected locations are too geographically spread out to fit into ${durationDays} touring day(s). ` +
        `Based on the distances between your chosen sites, you would need at least ` +
        `${requiredDays} touring day(s) to complete this itinerary. ` +
        `Please increase your trip duration to ${requiredDays} day(s) or more.`,
    };
  }

  return { feasible: true, error: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL: Group sites into days (max 3 per day, closest to origin first)
// Sites must already be sorted by distanceFromOrigin ASC before calling this.
// ─────────────────────────────────────────────────────────────────────────────
function buildDayGroups(sortedSites: SiteWithCoords[]): DayGroup[] {
  const groups: DayGroup[] = [];
  let currentGroup: SiteWithCoords[] = [];

  for (const site of sortedSites) {
    if (currentGroup.length === 0) {
      currentGroup.push(site);
      continue;
    }

    // Check if adding this site to the current group would exceed distance threshold
    const wouldExceed = currentGroup.some(
      (existing) =>
        haversineDistance(
          { latitude: existing.latitude, longitude: existing.longitude },
          { latitude: site.latitude, longitude: site.longitude },
        ) > MAX_DAILY_DISTANCE_KM,
    );

    if (wouldExceed || currentGroup.length >= MAX_SITES_PER_DAY) {
      groups.push({ sites: currentGroup });
      currentGroup = [site];
    } else {
      currentGroup.push(site);
    }
  }

  if (currentGroup.length > 0) {
    groups.push({ sites: currentGroup });
  }

  return groups;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL: Build the Prisma nested create payload for itinerary days
// Day 1     = PREPARATION  (no sites)
// Days 2..N-1 = TOURING    (up to 3 sites per day, closest to furthest)
// Day N     = DEPARTURE    (no sites)
// ─────────────────────────────────────────────────────────────────────────────
type ItineraryWithDays = PrismaItinerary & {
  days: (PrismaItineraryDay & {
    sites: (PrismaItineraryDaySite & { tourSite: PrismaTourSite })[];
  })[];
};

type ProviderRecommendation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
};

type AccommodationRecommendation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  apartmentType: ApartmentType | null;
  distanceKm: number;
};

async function mapItineraryToResponseWithRecommendations(
  itinerary: ItineraryWithDays,
  params: {
    apartmentType: string | null;
    transportType: string | null;
    itinerarySites: Array<{ id: string; latitude: number; longitude: number; region?: string }>;
    relocationInterest: boolean;
  },
): Promise<ItineraryResponse> {
  const available_hotels = (
    await getAvailableHotels(params.apartmentType, params.itinerarySites)
  ).map((h) => ({
    ...h,
    region: undefined as string | undefined,
    imageUrl: undefined as string | null | undefined,
  }));
  const available_transports = (
    await getAvailableTransports(params.transportType, params.itinerarySites)
  ).map((t) => ({
    ...t,
    region: undefined as string | undefined,
    imageUrl: undefined as string | null | undefined,
  }));

  // If relocationInterest is enabled, attach availableAccomodation per itinerary touring site.
  // We resolve the closest hotel/provider within 30km to each site.
  const shouldAttachRelocation = !!params.relocationInterest;

  const bestRelocationsByDaySite: Record<string, AccommodationRecommendation | null> = {};
  if (shouldAttachRelocation) {
    const locationsToResolve = params.itinerarySites;
    for (const site of locationsToResolve) {
      bestRelocationsByDaySite[site.id] = await getClosestAccommodationWithin30km(
        params.apartmentType,
        site.latitude,
        site.longitude,
        /*maxKm*/ 30,
      );
    }
  }

  // Tour → dating: merge the user's selected dating profiles into the itinerary
  // as social / leisure blocks, one per touring day (cycled if more than the
  // number of touring days).
  const datingSelections = await getDatingSelectionsForTour(itinerary.tourRequestId);
  const touringDays = (itinerary.days ?? []).filter((d) => d.dayType === DayType.TOURING);

  const daySocialBlocks: Record<number, DatingSocialBlock[]> = {};
  datingSelections.forEach((sel, index) => {
    const targetDay = touringDays[index % Math.max(touringDays.length, 1)];
    if (!targetDay) return;
    const socialBlock = {
      type: "SOCIAL" as const,
      profile: {
        datingProfileId: sel.datingProfileId,
        userId: sel.datingProfile.user.id,
        fullName: sel.datingProfile.user.fullName,
        headline: sel.datingProfile.headline,
        photos: sel.datingProfile.photos,
        about: sel.datingProfile.about,
        interests: sel.datingProfile.interests,
        profileImage: sel.datingProfile.user.profile?.bio_profile_image_url ?? null,
      },
    };
    daySocialBlocks[targetDay.dayNumber] = [
      ...(daySocialBlocks[targetDay.dayNumber] ?? []),
      socialBlock,
    ];
  });

  return {
    id: itinerary.id,
    tourRequestId: itinerary.tourRequestId,
    isFeasible: itinerary.isFeasible,
    feasibilityError: itinerary.feasibilityError,
    totalDays: itinerary.totalDays,
    dateCreated: itinerary.createdAt,
    days: (itinerary.days ?? []).map((day) => ({
      dayNumber: day.dayNumber,
      dayType: day.dayType as "PREPARATION" | "TOURING" | "DEPARTURE",
      sites: (day.sites ?? []).map((ds) => {
        const touringSiteId = ds.tourSite?.id ?? ds.tourSiteId;
        const availableAccomodation = shouldAttachRelocation
          ? (bestRelocationsByDaySite[String(touringSiteId)] ?? null)
          : null;

        return {
          visitOrder: ds.visitOrder,
          site: {
            id: ds.tourSite.id,
            name: ds.tourSite.name,
            region: ds.tourSite.region,
            latitude: ds.tourSite.latitude,
            longitude: ds.tourSite.longitude,
            description: ds.tourSite.description,
            imageUrl: ds.tourSite.imageUrl,
            category: ds.tourSite.category as
              "NATURE" | "CULTURAL" | "HISTORICAL" | "BEACH" | "WILDLIFE" | "RELIGIOUS" | "SCENIC",
          },
          availableAccomodation,
        };
      }),
      // Dating selections merged as social / leisure blocks for this day.
      socialBlocks: daySocialBlocks[day.dayNumber] ?? [],
    })),

    available_hotels,
    available_transports,

    // Flat list of selected dating profiles for convenient UI rendering.
    datingSelections: datingSelections.map((sel) => ({
      datingProfileId: sel.datingProfileId,
      userId: sel.datingProfile.user.id,
      fullName: sel.datingProfile.user.fullName,
      headline: sel.datingProfile.headline,
      photos: sel.datingProfile.photos,
      about: sel.datingProfile.about,
      interests: sel.datingProfile.interests,
      profileImage: sel.datingProfile.user.profile?.bio_profile_image_url ?? null,
      selectedAt: sel.createdAt,
    })),
  };
}

async function getAvailableHotels(
  apartmentType: string | null,
  itinerarySites: Array<{ id: string; latitude: number; longitude: number }>,
) {
  // Only search among providers that have a hotel row.
  // If apartmentType is provided, match that. Otherwise match any apartment_type.
  const hotels = await prisma.provider.findMany({
    where: {
      verification_status: true,
      hotel: { isNot: null },
    },
    include: { hotel: true },
  });

  const filtered = hotels
    .map((p) => {
      const hotelRow = p.hotel;
      if (!hotelRow) return null;

      // Find closest distance from provider hotel to ANY itinerary site.
      const distanceKm = Math.min(
        ...itinerarySites.map((s) =>
          haversineDistance(
            { latitude: s.latitude, longitude: s.longitude },
            { latitude: p.location_lat, longitude: p.location_lng },
          ),
        ),
      );

      // Filter by apartmentType when provided.
      if (apartmentType && hotelRow.apartment_type !== apartmentType) {
        return null;
      }

      return {
        id: p.provider_id,
        name: p.display_name,
        latitude: p.location_lat,
        longitude: p.location_lng,
        distanceKm,
      };
    })
    .filter((item): item is ProviderRecommendation => item !== null);

  return filtered.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 3);
}

async function getClosestAccommodationWithin30km(
  apartmentType: string | null,
  siteLatitude: number,
  siteLongitude: number,
  maxKm: number,
) {
  const hotels = await prisma.provider.findMany({
    where: {
      verification_status: true,
      hotel: { isNot: null },
    },
    include: { hotel: true },
  });

  const within = hotels
    .map((p) => {
      const hotelRow = p.hotel;
      if (!hotelRow) return null;
      if (apartmentType && hotelRow.apartment_type !== apartmentType) return null;

      const distanceKm = haversineDistance(
        { latitude: siteLatitude, longitude: siteLongitude },
        { latitude: p.location_lat, longitude: p.location_lng },
      );

      if (distanceKm > maxKm) return null;

      return {
        id: p.provider_id,
        name: p.display_name,
        latitude: p.location_lat,
        longitude: p.location_lng,
        apartmentType: hotelRow.apartment_type,
        distanceKm,
      };
    })
    .filter((item): item is AccommodationRecommendation => item !== null);

  if (!within.length) return null;
  within.sort((a, b) => a.distanceKm - b.distanceKm);
  return within[0];
}

async function getAvailableTransports(
  transportType: string | null,
  itinerarySites: Array<{ id: string; latitude: number; longitude: number }>,
) {
  const cars = await prisma.provider.findMany({
    where: {
      verification_status: true,
      car_rental: { isNot: null },
    },
    include: { car_rental: true },
  });

  const filtered = cars
    .map((p) => {
      const carRow = p.car_rental;
      if (!carRow) return null;

      if (transportType && carRow.transport_type !== transportType) {
        return null;
      }

      const distanceKm = Math.min(
        ...itinerarySites.map((s) =>
          haversineDistance(
            { latitude: s.latitude, longitude: s.longitude },
            { latitude: p.location_lat, longitude: p.location_lng },
          ),
        ),
      );

      return {
        id: p.provider_id,
        name: p.display_name,
        latitude: p.location_lat,
        longitude: p.location_lng,
        distanceKm,
      };
    })
    .filter((item): item is ProviderRecommendation => item !== null);

  // If transportType is null, return top 3 anyway.
  return filtered.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 3);
}

function buildItineraryDaysPayload(
  dayGroups: DayGroup[],
  durationDays: number,
): ItineraryDayInput[] {
  const totalDays = durationDays + 2;
  const days = [];

  // Day 1 — Preparation
  days.push({
    dayNumber: 1,
    dayType: DayType.PREPARATION,
    relocationRequired: false,
  });

  // Touring days — map each group to a day
  dayGroups.forEach((group, index) => {
    const dayNumber = index + 2;
    days.push({
      dayNumber,
      dayType: DayType.TOURING,
      relocationRequired: false,
      sites: {
        create: group.sites.map((site, siteIndex) => ({
          tourSiteId: site.id,
          visitOrder: siteIndex + 1,
        })),
      },
    });
  });

  // Fill any remaining touring days with no sites
  // (e.g. user selected 2 sites for a 3 day tour — extra day stays empty)
  const touringSlotsUsed = dayGroups.length;
  for (let i = touringSlotsUsed; i < durationDays; i++) {
    days.push({
      dayNumber: i + 2,
      dayType: DayType.TOURING,
      relocationRequired: false,
    });
  }

  // Last day — Departure
  days.push({
    dayNumber: totalDays,
    dayType: DayType.DEPARTURE,
    relocationRequired: false,
  });

  // console.log("days ", {days})

  return days;
}
