import { z } from "zod";
import { TourType, DayType, SiteCategory } from "../../generated/prisma/client.js";
import { GHANA_REGIONS, DEFAULT_START_REGION } from "../helpers/itinerary-routing.js";

const regionEnum = z.enum(GHANA_REGIONS, {
  message: "startRegion must be a valid Ghanaian region",
});

export const createTourRequestSchema = z.object({
  tourSiteIds: z
    .array(z.string().uuid({ message: "Each tour site ID must be a valid UUID" }))
    .min(1, { message: "Please select at least one tour site" })
    .max(50, { message: "Too many tour sites selected" }),

  tourType: z.enum(["GROUP", "SINGLE"], {
    message: "Tour type must be either GROUP or SINGLE",
  }),

  durationDays: z
    .number()
    .int({ message: "Duration must be a whole number of days" })
    .min(1, { message: "Tour must be at least 1 touring day" })
    .max(30, { message: "Tour cannot exceed 30 touring days" }),

  // Hub the loop is anchored to. Defaults to Central Region (Cape Coast).
  startRegion: regionEnum.optional().default(DEFAULT_START_REGION),

  // Explicit opt-in to more than two Greater Accra nights. Off by default so the
  // engine keeps Accra to the arrival/departure gateways and cuts urban lodging.
  allowAccraOvernight: z.boolean().optional().default(false),

  relocationInterest: z.boolean().optional().default(false),

  apartmentType: z.enum(["HOTEL", "GUESTHOUSE", "AIRBNB", "APARTMENTS"]).optional(),

  transportType: z.enum(["TROTRO", "UBER", "RENTED_VEHICLE", "NONE"]).optional(),

  companionInterest: z.boolean().optional().default(false),

  // Tour-to-dating integration: opt-in to casual-dating recommendations during
  // the trip. When true, the request is gated behind full KYC verification.
  casualDatingInterest: z.boolean().optional().default(false),
});

// ─────────────────────────────────────────
// LOCAL ENUMS (mirror Prisma enums)
// These are duplicated here so the code compiles before
// `prisma generate` has been run against a live DB.
// Once generated, you can import directly from @prisma/client.
// ─────────────────────────────────────────

// ─────────────────────────────────────────
// REQUEST TYPES (incoming from frontend)
// ─────────────────────────────────────────

export interface CreateTourRequestBody {
  tourSiteIds: string[];
  tourType: TourType;
  durationDays: number; // touring days only
  startRegion?: string;
  allowAccraOvernight?: boolean;
  relocationInterest?: boolean;
}

// ─────────────────────────────────────────
// RESPONSE TYPES (outgoing to frontend)
// ─────────────────────────────────────────

export interface TourSiteResponse {
  id: string;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  description: string;
  imageUrl: string | null;
  category: SiteCategory;
}

export interface ItineraryDaySiteResponse {
  visitOrder: number;
  site: TourSiteResponse;
}

export interface LocalProviderRecommendation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  // Echo of the provider's own classification, so the frontend can tell an
  // exact-type match from a best-effort fallback (present on the relevant
  // recommendation: apartmentType on accommodation, transportType on transport).
  apartmentType?: string | null;
  transportType?: string | null;
}

// Car-rental recommendation. Richer than the generic location recommendation
// because selecting a rental is a real decision: the fleet, price and terms
// must be visible to the traveller, not just the provider's name.
export interface TransportRecommendation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
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

export interface DatingSocialBlockProfile {
  datingProfileId: string;
  userId: string;
  fullName: string;
  headline?: string | null;
  photos: string[];
  about?: string | null;
  interests: string[];
  profileImage?: string | null;
}

export interface DatingSocialBlock {
  type: "SOCIAL";
  profile: DatingSocialBlockProfile;
}

export interface ItineraryDayResponse {
  dayNumber: number;
  dayType: DayType;
  // Descriptive, human-readable label, e.g.
  // "Day 3: Canopy Walk & Coastal Heritage (Central Region)".
  title: string | null;
  // Primary region the day is anchored to.
  region: string | null;
  sites: ItineraryDaySiteResponse[];
  // Providers native to this day's region, assigned as the traveller crosses
  // regional boundaries to cut idle transfer cost.
  localAccommodation: LocalProviderRecommendation | null;
  localTransport: TransportRecommendation | null;
  // The rental the traveller confirmed for this day (null = using the
  // localTransport recommendation). Set via
  // POST /itinerary/:tourRequestId/days/:dayNumber/transport.
  selectedTransport: TransportRecommendation | null;
  socialBlocks: DatingSocialBlock[];
}

export interface ItineraryLocationRecommendation {
  id: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  region?: string;
  distanceKm?: number;
  imageUrl?: string | null;
}

export interface ItineraryResponse {
  id: string;
  tourRequestId: string;
  isFeasible: boolean;
  feasibilityError: string | null;
  totalDays: number;
  dateCreated: Date;
  // Ordered, de-duplicated region cascade actually traversed by the loop.
  routeRegions: string[];
  // Nights attributed to Greater Accra (surfaced for the cost limiter).
  accraNights: number;
  // Non-fatal advisories, e.g. the Accra night-cap breach.
  warnings: string[];
  days: ItineraryDayResponse[];

  // Recommendations derived from the user's selected accommodation/transport preferences
  available_hotels: ItineraryLocationRecommendation[];
  available_transports: TransportRecommendation[];

  // Tour → dating: selected dating profiles merged into the itinerary timeline.
  datingSelections: (DatingSocialBlockProfile & { selectedAt: Date })[];
}

export interface CreateTourResponse {
  success: boolean;
  message: string;
  data: {
    tourRequestId: string;
    itinerary: ItineraryResponse | null;
  } | null;
  error?: string;
}

// ─────────────────────────────────────────
// INTERNAL SERVICE TYPES
// ─────────────────────────────────────────

export interface SiteWithCoords {
  id: string;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  description: string;
  imageUrl: string | null;
  category: SiteCategory;
  distanceFromOrigin: number; // km — calculated at runtime
}

export interface DayGroup {
  sites: SiteWithCoords[];
}

export interface FeasibilityResult {
  feasible: boolean;
  error: string | null;
}

// // Alias used by the service (matches zod inferred output)
// export type CreateTourRequestInput = {
//   tourSiteIds: string[];
//   tourType: TourType;
//   durationDays: number;
//   primaryPlaceOfStay: string;
//   proofOfAccommodationUrl?: string;
//   relocationInterest: boolean;
// };

export type ItineraryDayInput = {
  dayNumber: number;
  dayType: DayType;
  relocationRequired: boolean;
  title?: string;
  region?: string | null;
  sites?: {
    create: Array<{ tourSiteId: string; visitOrder: number }>;
  };
};

export type CreateTourRequestInput = z.infer<typeof createTourRequestSchema> & { userId: string };
