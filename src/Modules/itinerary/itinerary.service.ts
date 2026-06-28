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


import { TourType, DayType, SiteCategory } from '../../../generated/prisma/client.js';
import { prisma } from "../../config/index.js";
import { haversineDistance,
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
ItineraryDayInput
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
  input: CreateTourRequestInput
): Promise<CreateTourResponse> {
  const {
    userId,
    tourSiteIds,
    tourType,
    durationDays,
    primaryPlaceOfStay,
    proofOfAccommodationUrl,
    relocationInterest,
    apartmentType,
    transportType,
    companionInterest,
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
    })
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
      primaryPlaceOfStay: primaryPlaceOfStay ?? "East Legon, Accra",
      proofOfAccommodationUrl,
      relocationInterest: relocationInterest ?? false,
      apartmentType: apartmentType ?? undefined,
      transportType: transportType ?? undefined,
      companionInterest: companionInterest ?? false,
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
  tourRequestId: string
): Promise<ItineraryResponse> {
  // Payment gating: itinerary is only visible after payment SUCCESS
  const tourRequest = await prisma.tourRequest.findUnique({
    where: { id: tourRequestId },
    select: {
      id: true,
      durationDays: true,
      paymentStatus: true,
      relocationInterest: true,
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
      apartmentType: (tourRequest as any).apartmentType ?? null,
      transportType: (tourRequest as any).transportType ?? null,
      itinerarySites: tourRequest.selectedSites
        .map((rs: any) => rs.tourSite)
        .map((s: any) => ({
          id: s.id,
          latitude: s.latitude,
          longitude: s.longitude,
        })),
      relocationInterest: !!(tourRequest as any).relocationInterest,
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
    })
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
    apartmentType: (tourRequest as any)?.apartmentType ?? null,
    transportType: (tourRequest as any)?.transportType ?? null,
    itinerarySites: tourRequest.selectedSites
      .map((rs: any) => rs.tourSite)
      .map((s: any) => ({
        id: s.id,
        latitude: s.latitude,
        longitude: s.longitude,
      })),
    relocationInterest: !!(tourRequest as any)?.relocationInterest,
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
// INTERNAL: Feasibility checks
// ─────────────────────────────────────────────────────────────────────────────
function checkFeasibility(
  sites: SiteWithCoords[],
  durationDays: number
): FeasibilityResult {
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
      sites.map((s) => ({ latitude: s.latitude, longitude: s.longitude }))
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
        group.sites.map((s) => ({ latitude: s.latitude, longitude: s.longitude }))
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
          { latitude: site.latitude, longitude: site.longitude }
        ) > MAX_DAILY_DISTANCE_KM
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
async function mapItineraryToResponseWithRecommendations(
  itinerary: any,
  params: {
    apartmentType: string | null;
    transportType: string | null;
    itinerarySites: Array<{ id: string; latitude: number; longitude: number; region?: string }>;
    relocationInterest: boolean;
  }
): Promise<ItineraryResponse> {
  const available_hotels = await getAvailableHotels(params.apartmentType, params.itinerarySites);
  const available_transports = await getAvailableTransports(params.transportType, params.itinerarySites);

  // If relocationInterest is enabled, attach availableAccomodation per itinerary touring site.
  // We resolve the closest hotel/provider within 30km to each site.
  const shouldAttachRelocation = !!params.relocationInterest;

  let bestRelocationsByDaySite: Record<string, any> = {};
      console.log("attach relocation ", shouldAttachRelocation);
  if (shouldAttachRelocation) {
    const locationsToResolve = params.itinerarySites;
    for (const site of locationsToResolve) {
      console.log("site ", site);
      bestRelocationsByDaySite[site.id] = await getClosestAccommodationWithin30km(
        params.apartmentType,
        site.latitude,
        site.longitude,
        /*maxKm*/ 30,
      );
    }
  }

  return {
    id: itinerary.id,
    tourRequestId: itinerary.tourRequestId,
    isFeasible: itinerary.isFeasible,
    feasibilityError: itinerary.feasibilityError,
    totalDays: itinerary.totalDays,
    days: (itinerary.days ?? []).map((day: any) => ({
      dayNumber: day.dayNumber,
      dayType: day.dayType as "PREPARATION" | "TOURING" | "DEPARTURE",
      sites: (day.sites ?? []).map((ds: any) => {
        const touringSiteId = ds.tourSite?.id ?? ds.tourSiteId;
        const availableAccomodation = shouldAttachRelocation
          ? bestRelocationsByDaySite[String(touringSiteId)] ?? null
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
              | "NATURE"
              | "CULTURAL"
              | "HISTORICAL"
              | "BEACH"
              | "WILDLIFE"
              | "RELIGIOUS"
              | "SCENIC",
          },
          availableAccomodation,
        };
      }),
    })),

    available_hotels,
    available_transports,
  };
}


async function getAvailableHotels(
  apartmentType: string | null,
  itinerarySites: Array<{ id: string; latitude: number; longitude: number }>
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
            { latitude: p.location_lat, longitude: p.location_lng }
          )
        )
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
        region: undefined,
        distanceKm,
        imageUrl: undefined as string | null | undefined,
      };
    })
    .filter(Boolean) as any[];

  return filtered.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 3);
}

async function getClosestAccommodationWithin30km(
  apartmentType: string | null,
  siteLatitude: number,
  siteLongitude: number,
  maxKm: number,
) {
  console.log("got here ")
  const hotels = await prisma.provider.findMany({
    where: {
      verification_status: true,
      hotel: { isNot: null },
    },
    include: { hotel: true },
  });

  console.log("the hotels ", hotels);

  const within = hotels
    .map((p) => {
      const hotelRow = p.hotel;
      if (!hotelRow) return null;
      if (apartmentType && hotelRow.apartment_type !== apartmentType) return null;

      const distanceKm = haversineDistance(
        { latitude: siteLatitude, longitude: siteLongitude },
        { latitude: p.location_lat, longitude: p.location_lng },
      );

      console.log("distance ", distanceKm)

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
    .filter(Boolean) as any[];

  if (!within.length) return null;
  within.sort((a, b) => a.distanceKm - b.distanceKm);
  return within[0];
}

async function getAvailableTransports(
  transportType: string | null,
  itinerarySites: Array<{ id: string; latitude: number; longitude: number }>
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
            { latitude: p.location_lat, longitude: p.location_lng }
          )
        )
      );

      return {
        id: p.provider_id,
        name: p.display_name,
        latitude: p.location_lat,
        longitude: p.location_lng,
        region: undefined,
        distanceKm,
        imageUrl: undefined as string | null | undefined,
      };
    })
    .filter(Boolean) as any[];

  // If transportType is null, return top 3 anyway.
  return filtered.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 3);
}


function buildItineraryDaysPayload(
  dayGroups: DayGroup[],
  durationDays: number
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
