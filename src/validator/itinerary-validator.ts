import { z } from "zod";
import { TourType, DayType, SiteCategory } from '../../generated/prisma/client.js';


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

  primaryPlaceOfStay: z.string().optional().default("East Legon, Accra"),

  proofOfAccommodationUrl: z
    .string()
    .url({ message: "Proof of accommodation must be a valid URL" })
    .optional(),

  relocationInterest: z.boolean().optional().default(false),

  apartmentType: z
    .enum(["HOTEL", "GUESTHOUSE", "AIRBNB", "APARTMENTS"])
    .optional(),

  transportType: z
    .enum(["TROTRO", "UBER", "RENTED_VEHICLE", "NONE"])
    .optional(),

  companionInterest: z.boolean().optional().default(false),
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
  durationDays: number;            // touring days only
  primaryPlaceOfStay?: string;     // defaults to East Legon
  proofOfAccommodationUrl?: string;
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

export interface ItineraryDayResponse {
  dayNumber: number;
  dayType: DayType;
  sites: ItineraryDaySiteResponse[];
}

export interface ItineraryResponse {
  id: string;
  tourRequestId: string;
  isFeasible: boolean;
  feasibilityError: string | null;
  totalDays: number;
  days: ItineraryDayResponse[];
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

export type ItineraryDayInput = 
{
     dayNumber: number; 
     dayType: DayType;
      relocationRequired: boolean; 

    }



export type CreateTourRequestInput = z.infer<typeof createTourRequestSchema>&{userId: string};
