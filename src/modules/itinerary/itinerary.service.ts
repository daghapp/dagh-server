// NOTE: PrismaClient and enums are imported from the generated client.
// Run `npx prisma generate` after changing the schema to resolve these imports.

import { DayType, SiteCategory } from "../../../generated/prisma/client.js";
import type {
  Itinerary as PrismaItinerary,
  ItineraryDay as PrismaItineraryDay,
  ItineraryDaySite as PrismaItineraryDaySite,
  TourSite as PrismaTourSite,
  ApartmentType,
  PublicTransportService,
  TransitProfile,
} from "../../../generated/prisma/client.js";
import { prisma } from "../../config/index.js";
import sendEmail from "../../config/resend.config.js";
import { isPaymentsEnabled } from "../../config/payments.js";
import { hasServiceFeeWaiver } from "../../helpers/membership.js";
import {
  haversineDistance,
  maxPairwiseDistance,
  ORIGIN,
  MAX_DAILY_DISTANCE_KM,
} from "../../helpers/haversine.js";
import {
  deriveTransitProfile,
  getTransportHints,
  getStructuredTravelNotes,
  type TravelNote,
} from "../../helpers/transit-profile.js";
import {
  ACCRA_REGION,
  DEFAULT_START_REGION,
  MAX_ACCRA_NIGHTS,
  applyAccraGatewayConstraint,
  buildRegionDayGroups,
  deriveDayTheme,
  findRegionReentries,
  formatDayTitle,
  orderRegionsByLoop,
  regionCentroid,
  type RegionDayGroup,
  type RoutableSite,
} from "../../helpers/itinerary-routing.js";
import type {
  SiteWithCoords,
  CreateTourResponse,
  ItineraryResponse,
  CreateTourRequestInput,
  ItineraryDayInput,
  DatingSocialBlock,
  AvailableTransport,
  PublicTransportOption,
} from "../../validator/itinerary-validator.js";
import {
  ACCOMMODATION_RADIUS_KM,
  MIN_VERIFIED_ACCOMMODATIONS,
  recommendAccommodationsForSites,
} from "../../services/accommodation-recommendation.service.js";
import {
  loadActiveTransportServices,
  recommendPublicTransportForSites,
  resolveMobilityForSites,
} from "../../services/mobility.service.js";
import { dedupeById } from "../../helpers/tiered-recommendation.js";

const MAX_SITES_PER_DAY = 3;

// Providers are considered "native" to a day's zone within this radius. It is
// generous because rural regions (Volta, Savannah) have sparse verified supply,
// and a hotel 60km out still beats shipping the traveller back to Accra.
const LOCAL_PROVIDER_RADIUS_KM = 75;

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: Get all available tour sites (for frontend listing)
// ─────────────────────────────────────────────────────────────────────────────
export async function getAllTourSites() {
  return prisma.tourSite.findMany({
    orderBy: [{ region: "asc" }, { name: "asc" }],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: Create a tour request (itinerary generated lazily after payment)
// ─────────────────────────────────────────────────────────────────────────────
export async function createTourRequest(
  input: CreateTourRequestInput,
): Promise<CreateTourResponse> {
  const {
    userId,
    tourSiteIds,
    tourType,
    durationDays,
    startRegion,
    allowAccraOvernight,
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

  const sites = toSiteWithCoords(rawSites);

  // ── Step 2: Plan the contiguous regional loop from the chosen hub ──────────
  const plan = planItinerary(sites, startRegion, durationDays, allowAccraOvernight);

  // ── Step 3: Save tour request to DB (NO itinerary generation here) ─────────
  const tourRequest = await prisma.tourRequest.create({
    data: {
      userId: userId,
      tourType,
      durationDays,
      startRegion,
      allowAccraOvernight: allowAccraOvernight ?? false,
      relocationInterest: relocationInterest ?? false,
      apartmentType: apartmentType ?? undefined,
      transportType: transportType ?? undefined,
      companionInterest: companionInterest ?? false,
      casualDatingInterest: casualDatingInterest ?? false,
      status: plan.feasible ? "CONFIRMED" : "FAILED",
      selectedSites: {
        create: tourSiteIds.map((id: string) => ({ tourSiteId: id })),
      },
    },
  });

  // Best-effort email notification to the account handling tour requests.
  try {
    const requester = await prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true, email: true },
    });
    await sendEmail({
      email: "josephbekoe15@gmail.com",
      subject: "New tour request submitted",
      html: `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body {font-family: Arial, sans-serif; background: #f4f4f4; padding: 20px;}
      .container {background: #ffffff; max-width: 600px; margin: 0 auto; border-radius: 8px; overflow: hidden;}
      .header {background: #667eea; color: #ffffff; padding: 20px; text-align: center;}
      .content {padding: 30px; color: #333333;}
      .content h2 {color: #667eea; margin-top: 0;}
      .info-row {margin: 20px 0; padding: 10px; background: #f9f9f9; border-radius: 4px;}
      .info-label {font-weight: bold; color: #555555; display: inline-block; width: 30%;}
      .info-value {margin-left: 5%;}
      .footer {background: #667eea; color: #ffffff; padding: 15px; text-align: center; font-size: 12px;}
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>New Tour Request Submitted</h1>
      </div>
      <div class="content">
        <p>A new tour request has been submitted:</p>
        <p><strong>Duration:</strong> ${durationDays} days</p>
        <p><strong>Region:</strong> ${startRegion ?? "unknown"}</p>
        <p><strong>Tour sites:</strong> ${rawSites.slice(0, 3).map(s => s.name).join(', ')} ${rawSites.length > 3 ? `+${rawSites.length - 3} more` : ''}</p>
        <p><strong>Requested by:</strong> ${requester?.fullName ?? "unknown"}</p>
        <p><strong>Email:</strong> ${requester?.email ?? "unknown"}</p>
      </div>
      <div class="footer">
        — The DAGH Team
      </div>
    </div>
  </body>
</html>`,
    });
  } catch (error) {
    console.error("[itinerary] tour request email failed:", error);
  }

  // If not feasible: keep behavior consistent: return 422 from controller path.
  if (!plan.feasible) {
    return {
      success: false,
      message: plan.error!,
      data: {
        tourRequestId: tourRequest.id,
        itinerary: null,
      },
      error: plan.error ?? undefined,
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
// PUBLIC: Get a previously generated itinerary or generate if payment is made
// ─────────────────────────────────────────────────────────────────────────────
export async function getItineraryByRequestId(
  tourRequestId: string,
  requesterId: string,
  deps: ItineraryMappingDeps = {},
): Promise<ItineraryResponse> {
  // Payment gating: itinerary is only visible after payment SUCCESS
  const tourRequest = await prisma.tourRequest.findUnique({
    where: { id: tourRequestId },
    select: {
      id: true,
      userId: true,
      durationDays: true,
      startRegion: true,
      allowAccraOvernight: true,
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
    // When payments are off or an admin granted a lifetime fee waiver, waive the
    // fee in-place so this and every subsequent fetch pass without requiring the
    // user to call the payment endpoint first. Mirrors initiateItineraryPayment.
    // The caller can resolve access once and pass it down (the "my itineraries"
    // list would otherwise do three lookups per itinerary).
    let paymentAccess = deps.paymentAccess;
    if (!paymentAccess) {
      const [paymentsOff, feeWaiver] = await Promise.all([
        isPaymentsEnabled().then((enabled) => !enabled),
        hasServiceFeeWaiver(requesterId),
      ]);
      paymentAccess = { paymentsOff, feeWaiver };
    }
    if (!paymentAccess.paymentsOff && !paymentAccess.feeWaiver) {
      throw new Error("PAYMENT_REQUIRED");
    }
    await prisma.tourRequest.update({
      where: { id: tourRequestId },
      data: { paymentStatus: "SUCCESS", paymentId: null, feeWaived: true },
    });
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

  const requestParams = {
    apartmentType: tourRequest.apartmentType ?? null,
    transportType: tourRequest.transportType ?? null,
    itinerarySites: tourRequest.selectedSites.map((rs) => rs.tourSite).map(toCoordRef),
    relocationInterest: !!tourRequest.relocationInterest,
  };

  if (existing) {
    return mapItineraryToResponseWithRecommendations(existing, requestParams, deps);
  }

  // Otherwise generate itinerary lazily now that payment succeeded
  const rawSites = tourRequest.selectedSites.map((rs) => rs.tourSite);
  if (!rawSites.length) {
    throw new Error("NO_SITES_FOR_ITINERARY");
  }

  const sites = toSiteWithCoords(rawSites);
  const durationDays = tourRequest.durationDays;
  const totalDays = durationDays + 2;
  const startRegion = tourRequest.startRegion ?? DEFAULT_START_REGION;

  const plan = planItinerary(sites, startRegion, durationDays, tourRequest.allowAccraOvernight);

  // If not feasible, still persist itinerary row for traceability
  if (!plan.feasible) {
    await prisma.itinerary.create({
      data: {
        tourRequestId: tourRequestId,
        isFeasible: false,
        feasibilityError: plan.error,
        totalDays,
        routeRegions: plan.orderedRegions,
        accraNights: plan.accraNights,
        warnings: plan.warnings,
      },
    });

    throw new Error("ITINERARY_NOT_FEASIBLE");
  }

  const itinerary = await prisma.itinerary.create({
    data: {
      tourRequestId: tourRequestId,
      isFeasible: true,
      feasibilityError: null,
      totalDays,
      routeRegions: plan.orderedRegions,
      accraNights: plan.accraNights,
      warnings: plan.warnings,
      days: {
        create: buildItineraryDaysPayload(plan, durationDays),
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

  return mapItineraryToResponseWithRecommendations(itinerary, requestParams, deps);
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: Get all itinerary requests for the authenticated user
// ─────────────────────────────────────────────────────────────────────────────
export async function getTourRequestsByUserId(
  userId: string,
  opts: { take?: number; skip?: number } = {},
) {
  return prisma.tourRequest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: opts.take,
    skip: opts.skip,
    include: {
      selectedSites: {
        // `history` is long-form copy for the destination detail page; leaving
        // it out keeps this list response small (was ~660 KB for some users).
        include: { tourSite: { omit: { history: true } } },
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TOUR → DATING: select recommended dating profiles to merge into the itinerary
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

  const byUser = new Map(profiles.map((p) => [p.userId, p.id]));
  const createdByProfile = new Map(created.map((c) => [c.datingProfileId, c.createdAt]));

  return ids
    .filter((uid) => byUser.has(uid))
    .map((uid) => ({
      userId: uid,
      datingProfileId: byUser.get(uid)!,
      selectedAt: createdByProfile.get(byUser.get(uid)!)!,
    }));
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

/**
 * Batch variant of `getDatingSelectionsForTour` — one query for many tour
 * requests, grouped in memory. Used by /itinerary/my-itineraries so the dating
 * lookup does not add one query per itinerary.
 */
export async function getDatingSelectionsForTours(
  tourRequestIds: string[],
): Promise<Map<string, DatingSelections>> {
  const byRequest = new Map<string, DatingSelections>();
  if (!tourRequestIds.length) return byRequest;

  const selections = await prisma.tourRequestDatingSelection.findMany({
    where: { tourRequestId: { in: tourRequestIds } },
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

  for (const selection of selections) {
    const list = byRequest.get(selection.tourRequestId) ?? [];
    list.push(selection);
    byRequest.set(selection.tourRequestId, list);
  }

  return byRequest;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOUR → TRANSPORT: confirm (or clear) a specific rental for one itinerary day
// ─────────────────────────────────────────────────────────────────────────────
export interface DayTransportSelection {
  dayNumber: number;
  transportProviderId: string | null;
}

/**
 * Persists the traveller's confirmed car rental for a single touring day.
 *
 * Pass `providerId: null` to clear the selection and fall back to the read-time
 * localTransport recommendation. Only verified providers that actually carry a
 * car-rental record may be selected, so a stale client cannot attach an
 * arbitrary (or de-verified) provider to the trip.
 */
export async function selectDayTransport(
  tourRequestId: string,
  dayNumber: number,
  requesterId: string,
  providerId: string | null,
): Promise<DayTransportSelection> {
  const tourRequest = await prisma.tourRequest.findUnique({
    where: { id: tourRequestId },
    select: { userId: true },
  });

  if (!tourRequest) throw new Error("TOUR_REQUEST_NOT_FOUND");
  if (tourRequest.userId !== requesterId) throw new Error("FORBIDDEN");

  const itinerary = await prisma.itinerary.findUnique({
    where: { tourRequestId },
    select: { id: true },
  });

  if (!itinerary) throw new Error("ITINERARY_NOT_FOUND");

  const day = await prisma.itineraryDay.findUnique({
    where: { itineraryId_dayNumber: { itineraryId: itinerary.id, dayNumber } },
    select: { id: true, dayType: true },
  });

  if (!day) throw new Error("ITINERARY_DAY_NOT_FOUND");
  // Only touring days carry transport needs; arrival/departure days are
  // transfers handled outside the rental selection.
  if (day.dayType !== DayType.TOURING) throw new Error("DAY_NOT_TOURING");

  if (providerId !== null) {
    const provider = await prisma.provider.findFirst({
      where: {
        provider_id: providerId,
        verification_status: true,
        car_rental: { isNot: null },
      },
      select: { provider_id: true },
    });

    if (!provider) throw new Error("INVALID_TRANSPORT_PROVIDER");
  }

  await prisma.itineraryDay.update({
    where: { id: day.id },
    data: { transportProviderId: providerId },
  });

  return { dayNumber, transportProviderId: providerId };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL: Shared helpers
// ─────────────────────────────────────────────────────────────────────────────
function toSiteWithCoords(
  sites: Array<{
    id: string;
    name: string;
    region: string;
    latitude: number;
    longitude: number;
    description: string;
    history?: string | null;
    imageUrl: string | null;
    imageCredit?: string | null;
    category: SiteCategory;
  }>,
): SiteWithCoords[] {
  return sites.map((site) => ({
    ...site,
    distanceFromOrigin: haversineDistance(ORIGIN, {
      latitude: site.latitude,
      longitude: site.longitude,
    }),
  }));
}

function toCoordRef(site: PrismaTourSite) {
  return {
    id: site.id,
    latitude: site.latitude,
    longitude: site.longitude,
    region: site.region,
    transitProfile: site.transit_profile,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL: Plan the loop-based itinerary
// ─────────────────────────────────────────────────────────────────────────────
export interface ItineraryPlan {
  feasible: boolean;
  error: string | null;
  orderedRegions: string[];
  dayGroups: RegionDayGroup[];
  accraNights: number;
  warnings: string[];
}

/**
 * Builds the full route plan:
 *   1. Cap the site count against the touring-day budget.
 *   2. Order regions into a crossing-free loop anchored at the hub.
 *   3. Force Greater Accra onto a gateway unless the traveller opted in.
 *   4. Group each region's sites into contiguous touring days.
 *   5. Enforce the Accra night cap and collect advisories.
 *
 * Exported for unit testing of the routing/limiter rules.
 */
export function planItinerary(
  sites: RoutableSite[],
  startRegion: string,
  durationDays: number,
  allowAccraOvernight: boolean,
): ItineraryPlan {
  const hub = startRegion || DEFAULT_START_REGION;
  const warnings: string[] = [];

  // ── Check 1: Capacity ─────────────────────────────────────────────────────
  const maxAllowedSites = durationDays * MAX_SITES_PER_DAY;
  if (sites.length > maxAllowedSites) {
    return {
      feasible: false,
      error:
        `You have selected ${sites.length} sites but only have ${durationDays} touring ` +
        `day(s). A maximum of ${MAX_SITES_PER_DAY} sites can be visited per day. ` +
        `Maximum allowed for your trip is ${maxAllowedSites} sites. ` +
        `Please add more days or reduce your selected sites.`,
      orderedRegions: [],
      dayGroups: [],
      accraNights: 0,
      warnings,
    };
  }

  // ── Check 2: Single-day geographic feasibility ────────────────────────────
  if (durationDays === 1) {
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
        orderedRegions: [],
        dayGroups: [],
        accraNights: 0,
        warnings,
      };
    }
  }

  // ── Step 2: Region cascade (convex-hull loop from the hub) ────────────────
  const baseOrder = orderRegionsByLoop(hub, sites);
  const orderedRegions = applyAccraGatewayConstraint(baseOrder, hub, allowAccraOvernight);

  // ── Step 3: Contiguous regional day groups ────────────────────────────────
  const dayGroups = buildRegionDayGroups(orderedRegions, sites, {
    maxPerDay: MAX_SITES_PER_DAY,
    maxKm: MAX_DAILY_DISTANCE_KM,
  });

  // Zero-backtracking guard — this is structural, so a breach is a bug.
  const reentries = findRegionReentries(dayGroups.map((g) => g.region));
  if (reentries.length > 0) {
    return {
      feasible: false,
      error: `Routing error: regions were re-entered mid-trip (${reentries.join(", ")}). Please contact support.`,
      orderedRegions,
      dayGroups,
      accraNights: 0,
      warnings,
    };
  }

  // ── Check 3: Enough touring days for the contiguous layout ────────────────
  const requiredDays = dayGroups.length;
  if (requiredDays > durationDays) {
    return {
      feasible: false,
      error:
        `Your selected locations are too geographically spread out to fit into ${durationDays} touring day(s). ` +
        `Each region is explored as one continuous block, so this route needs at least ` +
        `${requiredDays} touring day(s). ` +
        `Please increase your trip duration to ${requiredDays} day(s) or more.`,
      orderedRegions,
      dayGroups,
      accraNights: 0,
      warnings,
    };
  }

  // ── Step 4: Greater Accra cost limiter ────────────────────────────────────
  const accraTouringDays = dayGroups.filter((g) => g.region === ACCRA_REGION).length;
  // The preparation night (day 1) is spent at the hub; only counts as Accra when
  // the hub itself is Accra. The departure day carries no overnight.
  const accraNights = accraTouringDays + (hub === ACCRA_REGION ? 1 : 0);

  if (accraNights > MAX_ACCRA_NIGHTS) {
    const message =
      `This itinerary spends ${accraNights} nights in Greater Accra, above the ` +
      `${MAX_ACCRA_NIGHTS}-night cap meant to avoid expensive urban lodging. ` +
      `Accra is otherwise confined to the arrival/departure gateway.`;
    if (!allowAccraOvernight) {
      return {
        feasible: false,
        error:
          `${message} Reduce your Greater Accra selection or set ` +
          `"allowAccraOvernight": true to opt in explicitly.`,
        orderedRegions,
        dayGroups,
        accraNights,
        warnings,
      };
    }
    warnings.push(message);
  }

  return {
    feasible: true,
    error: null,
    orderedRegions,
    dayGroups,
    accraNights,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL: Build the Prisma nested create payload for itinerary days
// Day 1        = PREPARATION  (hub arrival / orientation)
// Days 2..N-1  = TOURING      (region-contiguous, up to 3 sites per day)
// Day N        = DEPARTURE    (from the final region)
// ─────────────────────────────────────────────────────────────────────────────
export function buildItineraryDaysPayload(
  plan: ItineraryPlan,
  durationDays: number,
): ItineraryDayInput[] {
  const totalDays = durationDays + 2;
  const days: ItineraryDayInput[] = [];
  const hub = plan.orderedRegions[0] ?? DEFAULT_START_REGION;
  const finalRegion = plan.orderedRegions[plan.orderedRegions.length - 1] ?? hub;

  // Day 1 — Preparation / arrival at the chosen hub
  days.push({
    dayNumber: 1,
    dayType: DayType.PREPARATION,
    relocationRequired: false,
    region: hub,
    title: formatDayTitle(1, deriveDayTheme({ dayType: "PREPARATION", region: hub })),
  });

  // Touring days — one contiguous region per day
  plan.dayGroups.forEach((group, index) => {
    const dayNumber = index + 2;
    days.push({
      dayNumber,
      dayType: DayType.TOURING,
      relocationRequired: false,
      region: group.region,
      title: formatDayTitle(
        dayNumber,
        deriveDayTheme({ dayType: "TOURING", region: group.region, sites: group.sites }),
      ),
      sites: {
        create: group.sites.map((site, siteIndex) => ({
          tourSiteId: site.id,
          visitOrder: siteIndex + 1,
        })),
      },
    });
  });

  // Spare touring days stay in the final region (e.g. selected 2 sites for a
  // 4-day tour). Kept region-anchored so day titles remain meaningful.
  for (let i = plan.dayGroups.length; i < durationDays; i++) {
    const dayNumber = i + 2;
    days.push({
      dayNumber,
      dayType: DayType.TOURING,
      relocationRequired: false,
      region: finalRegion,
      title: formatDayTitle(
        dayNumber,
        deriveDayTheme({ dayType: "TOURING", region: finalRegion, sites: [] }),
      ),
    });
  }

  // Last day — Departure from the final region of the loop
  days.push({
    dayNumber: totalDays,
    dayType: DayType.DEPARTURE,
    relocationRequired: false,
    region: finalRegion,
    title: formatDayTitle(totalDays, deriveDayTheme({ dayType: "DEPARTURE", region: finalRegion })),
  });

  return days;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL: Response mapping + localized provider provisioning
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

type AccommodationRecommendation = ProviderRecommendation & {
  apartmentType: ApartmentType | null;
  source: "verified" | "fallback";
  imageUrl?: string | null;
  images?: string[];
  description?: string | null;
  address?: string | null;
  basePricePerNight?: number | null;
  avgRating?: number;
  reviewCount?: number;
  googleMapsUrl?: string | null;
};

type TransportRecommendation = ProviderRecommendation & {
  kind: "car_rental";
  transportType: string | null;
  locationAddress: string;
  avgRating: number;
  reviewCount: number;
  imageUrl: string | null;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number;
  transmission: string;
  fuelType: string;
  dailyRate: number;
  driverRequired: boolean;
};

interface RawHotelProvider {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  apartmentType: ApartmentType | null;
  imageUrl: string | null;
  images: string[];
  description: string | null;
  address: string | null;
  basePricePerNight: number | null;
  avgRating: number;
  reviewCount: number;
  googleMapsUrl: string;
}

interface RawTransportProvider {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  transportType: string | null;
  locationAddress: string;
  avgRating: number;
  reviewCount: number;
  imageUrl: string | null;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number;
  transmission: string;
  fuelType: string;
  dailyRate: number;
  driverRequired: boolean;
}

/**
 * Verified supply needed to build itinerary responses. Loaded once per request
 * and shared across every itinerary so a multi-itinerary read (e.g.
 * /itinerary/my-itineraries) does not re-query the same provider tables N
 * times and exhaust the pg pool.
 */
export interface ItineraryCatalogues {
  hotelProviders: RawHotelProvider[];
  transportProviders: RawTransportProvider[];
  publicTransportServices: PublicTransportService[];
}

type DatingSelections = Awaited<ReturnType<typeof getDatingSelectionsForTour>>;

interface ItineraryPaymentAccess {
  paymentsOff: boolean;
  feeWaiver: boolean;
}

interface ItineraryMappingDeps {
  catalogues?: ItineraryCatalogues;
  datingSelections?: DatingSelections;
  /** Resolved once by list endpoints and reused across every itinerary. */
  paymentAccess?: ItineraryPaymentAccess;
}

export async function loadItineraryCatalogues(): Promise<ItineraryCatalogues> {
  const [hotelProviders, transportProviders, publicTransportServices] = await Promise.all([
    loadHotelProviders(),
    loadTransportProviders(),
    loadActiveTransportServices(),
  ]);
  return { hotelProviders, transportProviders, publicTransportServices };
}

async function mapItineraryToResponseWithRecommendations(
  itinerary: ItineraryWithDays,
  params: {
    apartmentType: string | null;
    transportType: string | null;
    itinerarySites: Array<{
      id: string;
      latitude: number;
      longitude: number;
      region?: string;
      transitProfile?: TransitProfile | null;
    }>;
    relocationInterest: boolean;
  },
  deps: ItineraryMappingDeps = {},
): Promise<ItineraryResponse> {
  // transportType NONE is an explicit opt-out ("no transport needed"), so no
  // transport is recommended, mobility profiles stay null and per-day
  // localTransport stays null by design.
  const wantsNoTransport = params.transportType === "NONE";

  // Load verified supply once and allocate it in-memory. Callers that build
  // several itineraries in one request pass a shared catalogue so this runs
  // once per HTTP request instead of once per itinerary.
  const { hotelProviders, transportProviders, publicTransportServices } =
    deps.catalogues ?? (await loadItineraryCatalogues());

  const available_hotels = nearestWithTypeFallback(
    hotelProviders,
    params.itinerarySites,
    (h) => h.apartmentType,
    params.apartmentType,
    { limit: 3 },
  ).map((h) => ({ ...toHotelRecommendation(h), source: "verified" }));

  // ── §1 Accommodation engine: tiered verified (5 km radius, category
  // preference) → external geographic fallback, one list per tour site.
  const accommodationOptionsBySite = await recommendAccommodationsForSites(
    params.itinerarySites,
    params.apartmentType,
    {
      verifiedProviders: hotelProviders.map((h) => ({
        id: h.id,
        name: h.name,
        latitude: h.latitude,
        longitude: h.longitude,
        propertyType: h.apartmentType,
        imageUrl: h.imageUrl,
        images: h.images,
        description: h.description,
        address: h.address,
        basePricePerNight: h.basePricePerNight,
        avgRating: h.avgRating,
        reviewCount: h.reviewCount,
        googleMapsUrl: h.googleMapsUrl,
      })),
      radiusKm: ACCOMMODATION_RADIUS_KM,
      minResults: MIN_VERIFIED_ACCOMMODATIONS,
      limit: 3,
    },
  );

  // ── §2 Mobility engine: ride-hailing availability by transit profile,
  // tiered car rentals + STC/VIP/trotro/air catalogue per tour site.
  const mobilityBySite = wantsNoTransport
    ? {}
    : await resolveMobilityForSites(params.itinerarySites, {
        wantedTransportType: params.transportType,
        wantsNoTransport,
        carRentals: transportProviders.map((t) => ({
          id: t.id,
          name: t.name,
          latitude: t.latitude,
          longitude: t.longitude,
          transportType: t.transportType,
          locationAddress: t.locationAddress,
          avgRating: t.avgRating,
          imageUrl: t.imageUrl,
          vehicleMake: t.vehicleMake,
          vehicleModel: t.vehicleModel,
          dailyRate: t.dailyRate,
          driverRequired: t.driverRequired,
        })),
        services: publicTransportServices,
      });

  // ── §2 Public-transport engine, shaped like accommodationOptions: one
  // tiered list per tour site (STC/VIP intercity coaches, domestic air, trotro
  // corridors) with primary in-radius options ahead of tagged national
  // fallbacks. Reuses the preloaded catalogue — no extra query.
  const publicTransportBySite: Record<string, PublicTransportOption[]> = wantsNoTransport
    ? {}
    : await recommendPublicTransportForSites(params.itinerarySites, {
        services: publicTransportServices,
      });

  // Transport hints derived from each site's stored transit_profile (§2),
  // falling back to region derivation for rows that predate the column.
  const transportHintsBySite: Record<string, string[]> = {};
  const structuredNotesBySite: Record<string, TravelNote[]> = {};
  for (const site of params.itinerarySites) {
    const profile = site.transitProfile ?? deriveTransitProfile(site.region ?? "");
    transportHintsBySite[site.id] = getTransportHints(profile);
    structuredNotesBySite[site.id] = getStructuredTravelNotes(profile);
  }

  // Verified car rentals first, then the tiered public-transport suggestions
  // (STC/VIP coaches, air, trotro) collected across every tour site.
  const available_transports: AvailableTransport[] = [
    ...(wantsNoTransport
      ? []
      : nearestWithTypeFallback(
          transportProviders,
          params.itinerarySites,
          (t) => t.transportType,
          params.transportType,
          { limit: 3 },
        ).map(toTransportRecommendation)),
    ...dedupeById(Object.values(publicTransportBySite).flat()),
  ];

  // Surface a read-time advisory when the requested type has no verified
  // supply at all, so the frontend can explain why a fallback is shown.
  // (Not persisted — stored itinerary.warnings is left untouched.)
  const responseWarnings = [...(itinerary.warnings ?? [])];
  if (
    params.apartmentType &&
    hotelProviders.length > 0 &&
    !hotelProviders.some((h) => h.apartmentType === params.apartmentType)
  ) {
    responseWarnings.push(
      `No verified ${params.apartmentType} stays are listed yet — showing the closest verified option instead. <span class="tag">Suggested Alternative Accommodation</span>`,
    );
  }
  if (
    !wantsNoTransport &&
    params.transportType &&
    transportProviders.length > 0 &&
    !transportProviders.some((t) => t.transportType === params.transportType)
  ) {
    responseWarnings.push(
      `No verified ${params.transportType} transport providers are listed yet — showing the closest verified option instead.`,
    );
  }

  // If relocationInterest is enabled, attach availableAccomodation per itinerary
  // touring site, resolved to the closest provider within 30km.
  const shouldAttachRelocation = !!params.relocationInterest;
  const bestRelocationsByDaySite: Record<string, AccommodationRecommendation | null> = {};
  if (shouldAttachRelocation) {
    for (const site of params.itinerarySites) {
      const [best] = nearestWithTypeFallback(
        hotelProviders,
        [site],
        (h) => h.apartmentType,
        params.apartmentType,
        {
          maxKm: 30,
          limit: 1,
        },
      );
      bestRelocationsByDaySite[site.id] = best ? toHotelRecommendation(best) : null;
    }
  }

  // Tour → dating: merge selected dating profiles as social / leisure blocks,
  // one per touring day (cycled if there are more profiles than touring days).
  const datingSelections =
    deps.datingSelections ?? (await getDatingSelectionsForTour(itinerary.tourRequestId));
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
    routeRegions: itinerary.routeRegions ?? [],
    accraNights: itinerary.accraNights ?? 0,
    warnings: responseWarnings,
    days: (itinerary.days ?? []).map((day) => {
      const dayAnchors = (day.sites ?? []).map((ds) => ({
        latitude: ds.tourSite.latitude,
        longitude: ds.tourSite.longitude,
      }));
      // Empty / spare days still resolve local supply from the region's centre.
      const anchors = dayAnchors.length > 0 ? dayAnchors : [regionCentroid(day.region ?? "", [])];

      const localHotel = pickLocalProvider(
        hotelProviders,
        anchors,
        (h) => h.apartmentType,
        params.apartmentType,
        LOCAL_PROVIDER_RADIUS_KM,
      );
      const localHotelWithSource = localHotel
        ? {
            ...localHotel,
            source: (hotelProviders.some((h) => h.apartmentType === params.apartmentType)
              ? "verified"
              : "fallback") as "verified" | "fallback",
          }
        : null;
      const localTransport = pickLocalProvider(
        transportProviders,
        anchors,
        (t) => t.transportType,
        params.transportType,
        LOCAL_PROVIDER_RADIUS_KM,
        wantsNoTransport,
      );
      // Hints follow the day's actual sites and their stored transit_profile
      // (§2) — urban corridors surface ride-hailing, peri/rural surface
      // station-based trotro + intercity coach guidance.
      const daySiteProfiles = (day.sites ?? []).map(
        (ds) => ds.tourSite?.transit_profile ?? deriveTransitProfile(ds.tourSite?.region ?? ""),
      );
      const transportHints = [...new Set(daySiteProfiles.flatMap(getTransportHints))];
      const structuredTravelNotes = dedupeNotes(daySiteProfiles.flatMap(getStructuredTravelNotes));

      // Traveller's confirmed rental for this day, if any. Resolved from the
      // same verified supply so a de-verified provider degrades to the
      // recommendation rather than a stale row.
      const selectedTransportProvider = day.transportProviderId
        ? transportProviders.find((t) => t.id === day.transportProviderId)
        : undefined;

      return {
        dayNumber: day.dayNumber,
        dayType: day.dayType as "PREPARATION" | "TOURING" | "DEPARTURE",
        title: day.title ?? null,
        region: day.region ?? null,
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
              history: ds.tourSite.history,
              imageUrl: ds.tourSite.imageUrl,
              imageCredit: ds.tourSite.imageCredit,
              category: ds.tourSite.category as
                | "NATURE"
                | "CULTURAL"
                | "HISTORICAL"
                | "BEACH"
                | "WILDLIFE"
                | "RELIGIOUS"
                | "SCENIC",
              transitProfile: ds.tourSite.transit_profile,
            },
            availableAccomodation,
            // §1 tiered options around this exact site (external fallbacks
            // arrive tagged "Suggested Alternative Accommodation").
            accommodationOptions: accommodationOptionsBySite[String(touringSiteId)] ?? [],
            // §2 tiered public-transport options (STC/VIP, air, trotro) around
            // this exact site — national fallbacks tagged like accommodation.
            publicTransportOptions: publicTransportBySite[String(touringSiteId)] ?? [],
            // §2 mobility profile for this location — null on transport opt-out.
            mobility: wantsNoTransport ? null : (mobilityBySite[String(touringSiteId)] ?? null),
          };
        }),
        localAccommodation: localHotelWithSource
          ? toHotelRecommendation(localHotelWithSource)
          : null,
        localTransport: localTransport ? toTransportRecommendation(localTransport) : null,
        selectedTransport: selectedTransportProvider
          ? toTransportRecommendation({
              ...selectedTransportProvider,
              distanceKm: Math.min(
                ...anchors.map((a) => haversineDistance(a, selectedTransportProvider)),
              ),
            })
          : null,
        transportHints,
        structuredTravelNotes,
        socialBlocks: daySocialBlocks[day.dayNumber] ?? [],
      };
    }),

    available_hotels,
    available_transports,
    transportHints: [...new Set(Object.values(transportHintsBySite).flat())],
    structuredTravelNotes: dedupeNotes(Object.values(structuredNotesBySite).flat()),

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

function dedupeNotes(notes: TravelNote[]): TravelNote[] {
  const seen = new Set<string>();
  const out: TravelNote[] = [];
  for (const n of notes) {
    if (!seen.has(n.title)) {
      seen.add(n.title);
      out.push(n);
    }
  }
  return out;
}

function toHotelRecommendation(
  provider: RawHotelProvider & { distanceKm: number; source?: "verified" | "fallback" },
): AccommodationRecommendation {
  return {
    id: provider.id,
    name: provider.name,
    latitude: provider.latitude,
    longitude: provider.longitude,
    distanceKm: provider.distanceKm,
    apartmentType: provider.apartmentType ?? null,
    source: provider.source ?? "verified",
    imageUrl: provider.imageUrl ?? null,
    images: provider.images ?? (provider.imageUrl ? [provider.imageUrl] : []),
    description: provider.description ?? null,
    address: provider.address ?? null,
    basePricePerNight: provider.basePricePerNight ?? null,
    avgRating: provider.avgRating ?? 0,
    reviewCount: provider.reviewCount ?? 0,
    googleMapsUrl:
      provider.googleMapsUrl ??
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(provider.name)}`,
  };
}

function toTransportRecommendation(
  provider: RawTransportProvider & { distanceKm: number },
): TransportRecommendation {
  return {
    kind: "car_rental",
    id: provider.id,
    name: provider.name,
    latitude: provider.latitude,
    longitude: provider.longitude,
    distanceKm: provider.distanceKm,
    transportType: provider.transportType ?? null,
    locationAddress: provider.locationAddress,
    avgRating: provider.avgRating,
    reviewCount: provider.reviewCount,
    imageUrl: provider.imageUrl,
    vehicleMake: provider.vehicleMake,
    vehicleModel: provider.vehicleModel,
    vehicleYear: provider.vehicleYear,
    transmission: provider.transmission,
    fuelType: provider.fuelType,
    dailyRate: provider.dailyRate,
    driverRequired: provider.driverRequired,
  };
}

/**
 * Closest provider to any of the given anchor points, optionally filtered and
 * capped by radius. Pure (operates on preloaded supply) and shared by the global
 * recommendation lists, the per-day local allocation, and relocation lookups.
 */
function nearestProviders<T extends { latitude: number; longitude: number }>(
  providers: T[],
  anchors: Array<{ latitude: number; longitude: number }>,
  opts: { maxKm?: number; limit?: number; filter?: (p: T) => boolean } = {},
): Array<T & { distanceKm: number }> {
  if (anchors.length === 0) return [];
  const { maxKm = Number.POSITIVE_INFINITY, limit = Number.POSITIVE_INFINITY, filter } = opts;

  const scored = providers
    .filter((p) => (filter ? filter(p) : true))
    .map((p) => ({
      ...p,
      distanceKm: Math.min(...anchors.map((a) => haversineDistance(a, p))),
    }))
    .filter((p) => p.distanceKm <= maxKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  return Number.isFinite(limit) ? scored.slice(0, limit) : scored;
}

/**
 * Preference-aware closest-provider lookup with graceful fallback.
 *
 * Verified supply is sparse (e.g. a single transport operator, hotels only in
 * Accra, no AIRBNB/TROTRO/UBER supply at all). A strict exact-type filter
 * therefore resolves to null/[] for most selections even though usable supply
 * exists. So: prefer the requested type, but fall back to the closest provider
 * of any type rather than returning nothing.
 *
 * Exported for unit testing.
 */
export function nearestWithTypeFallback<T extends { latitude: number; longitude: number }>(
  providers: T[],
  anchors: Array<{ latitude: number; longitude: number }>,
  getType: (p: T) => string | null | undefined,
  wantedType: string | null | undefined,
  opts: { maxKm?: number; limit?: number } = {},
): Array<T & { distanceKm: number }> {
  if (!wantedType) return nearestProviders(providers, anchors, opts);
  const exact = nearestProviders(providers, anchors, {
    ...opts,
    filter: (p) => getType(p) === wantedType,
  });
  if (exact.length > 0) return exact;
  return nearestProviders(providers, anchors, opts);
}

/**
 * Per-day "local" provider pick. Prefers supply within `radiusKm` of the
 * day's anchors (exact type first, then any type); when nothing is that
 * close, falls back to the closest nationally so the day still carries a
 * usable recommendation (with an honest distanceKm) instead of null.
 *
 * `optOut` covers explicit "no thanks" selections (transportType NONE):
 * those always resolve to undefined.
 *
 * Exported for unit testing.
 */
export function pickLocalProvider<T extends { latitude: number; longitude: number }>(
  providers: T[],
  anchors: Array<{ latitude: number; longitude: number }>,
  getType: (p: T) => string | null | undefined,
  wantedType: string | null | undefined,
  radiusKm: number,
  optOut = false,
): (T & { distanceKm: number }) | undefined {
  if (optOut) return undefined;
  const [within] = nearestWithTypeFallback(providers, anchors, getType, wantedType, {
    maxKm: radiusKm,
    limit: 1,
  });
  if (within) return within;
  const [national] = nearestWithTypeFallback(providers, anchors, getType, wantedType, { limit: 1 });
  return national;
}

// Region → transit-profile derivation and profile → hint building moved to
// src/helpers/transit-profile.ts (§2) so seeding, moderation and the itinerary
// engine share one source of truth.

async function loadHotelProviders(): Promise<RawHotelProvider[]> {
  const providers = await prisma.provider.findMany({
    where: { verification_status: true, hotel: { isNot: null } },
    include: { hotel: true },
  });

  return providers
    .filter((p) => !!p.hotel)
    .map((p) => ({
      id: p.provider_id,
      name: p.display_name,
      latitude: p.location_lat,
      longitude: p.location_lng,
      apartmentType: p.hotel!.apartment_type,
      imageUrl: p.media_assets[0] ?? null,
      images: p.media_assets,
      description: p.bio_description ?? null,
      address: p.location_address ?? null,
      basePricePerNight: p.hotel!.base_price_per_night ?? null,
      avgRating: p.avg_rating ?? 0,
      reviewCount: p.review_count ?? 0,
      googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.display_name)}`,
    }));
}

async function loadTransportProviders(): Promise<RawTransportProvider[]> {
  const providers = await prisma.provider.findMany({
    where: { verification_status: true, car_rental: { isNot: null } },
    include: { car_rental: true },
  });

  return providers
    .filter((p) => !!p.car_rental)
    .map((p) => ({
      id: p.provider_id,
      name: p.display_name,
      latitude: p.location_lat,
      longitude: p.location_lng,
      transportType: p.car_rental!.transport_type ?? null,
      locationAddress: p.location_address,
      avgRating: p.avg_rating,
      reviewCount: p.review_count,
      imageUrl: p.media_assets[0] ?? null,
      vehicleMake: p.car_rental!.vehicle_make,
      vehicleModel: p.car_rental!.vehicle_model,
      vehicleYear: p.car_rental!.vehicle_year,
      transmission: p.car_rental!.transmission,
      fuelType: p.car_rental!.fuel_type,
      dailyRate: p.car_rental!.daily_rate,
      driverRequired: p.car_rental!.driver_required,
    }));
}
