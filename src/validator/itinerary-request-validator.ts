import { z } from "zod";
import { TourType } from "../../generated/prisma/client.js";
import { GHANA_REGIONS } from "../helpers/itinerary-routing.js";

export const itineraryRequestSchema = z.object({
  tourSiteIds: z
    .array(z.string().uuid({ message: "Each tour site ID must be a valid UUID" }))
    .min(1, { message: "Please select at least one tour site" })
    .max(50, { message: "Too many tour sites selected" }),

  tourType: z.enum(["GROUP", "SINGLE"] satisfies TourType[]),

  durationDays: z
    .number()
    .int({ message: "Duration must be a whole number of days" })
    .min(1, { message: "Tour must be at least 1 touring day" })
    .max(30, { message: "Tour cannot exceed 30 touring days" }),

  // Hub the loop is anchored to. When omitted, it is inferred from the selected
  // sites rather than hard-defaulted to Central. Send it explicitly to override.
  startRegion: z
    .enum(GHANA_REGIONS, { message: "startRegion must be a valid Ghanaian region" })
    .optional(),

  // Explicit opt-in to more than two Greater Accra nights.
  allowAccraOvernight: z.boolean().optional().default(false),

  relocationInterest: z.boolean().optional().default(false),

  apartmentType: z.enum(["HOTEL", "GUESTHOUSE", "AIRBNB", "APARTMENTS", "MOTEL"]).optional(),

  transportType: z.enum(["TROTRO", "UBER", "RENTED_VEHICLE", "NONE"]).optional(),

  companionInterest: z.boolean().optional().default(false),

  casualDatingInterest: z.boolean().optional().default(false),
});

export type ItineraryRequestInput = z.infer<typeof itineraryRequestSchema>;
