import { z } from "zod";
import { GHANA_REGIONS } from "../helpers/itinerary-routing.js";

// ─────────────────────────────────────────
// ADMIN-CREATED TOUR SITES
// Admins add rows directly to the production catalogue (bypassing the
// pending-site review queue). Category is free-text and normalized into the
// SiteCategory enum by the service, matching the approval pipeline.
// ─────────────────────────────────────────

const regionEnum = z.enum(GHANA_REGIONS, {
  message: "region must be a valid Ghanaian region",
});

export const createTourSiteSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, { message: "Site name must be at least 3 characters" })
    .max(100, { message: "Site name cannot exceed 100 characters" }),

  region: regionEnum,

  latitude: z
    .number()
    .min(4.5, { message: "coordinates must fall within Ghana" })
    .max(11.5, { message: "coordinates must fall within Ghana" }),

  longitude: z
    .number()
    .min(-3.3, { message: "coordinates must fall within Ghana" })
    .max(1.3, { message: "coordinates must fall within Ghana" }),

  description: z
    .string()
    .trim()
    .min(10, { message: "Description must be at least 10 characters" })
    .max(2000, { message: "Description cannot exceed 2000 characters" }),

  history: z
    .string()
    .trim()
    .max(5000, { message: "History cannot exceed 5000 characters" })
    .optional(),

  category: z
    .string()
    .trim()
    .max(50, { message: "Category tag cannot exceed 50 characters" })
    .optional(),

  // Extra album tags in addition to the tag derived from `category`.
  categories: z
    .array(z.string().trim().min(1).max(50))
    .max(10, { message: "At most 10 album tags are allowed" })
    .optional(),

  imageUrl: z.string().url({ message: "imageUrl must be a valid URL" }).optional(),

  imageCredit: z
    .string()
    .trim()
    .max(200, { message: "imageCredit cannot exceed 200 characters" })
    .optional(),
});

export type CreateTourSiteInput = z.infer<typeof createTourSiteSchema>;
