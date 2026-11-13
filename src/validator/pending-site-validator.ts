import { z } from "zod";
import { GHANA_REGIONS } from "../helpers/itinerary-routing.js";

// ─────────────────────────────────────────
// USER-SUBMITTED TOUR SITES (§3)
// Free-text category is kept as a String — admins review it, and the approval
// pipeline normalizes it into the SiteCategory enum at migration time.
// ─────────────────────────────────────────

const regionEnum = z.enum(GHANA_REGIONS, {
  message: "region must be a valid Ghanaian region",
});

export const submitPendingSiteSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, { message: "Site name must be at least 3 characters" })
    .max(100, { message: "Site name cannot exceed 100 characters" }),

  region: regionEnum,

  // Bounding box around Ghana's landmass — keeps obviously-wrong coordinates
  // out of the moderation queue.
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
    .max(2000, { message: "Description cannot exceed 2000 characters" })
    .optional(),

  // Long-form historical background shown on the destination detail page.
  history: z
    .string()
    .trim()
    .max(5000, { message: "History cannot exceed 5000 characters" })
    .optional(),

  // Free-text tag supplied by the submitter; mapped to SiteCategory on approval.
  category: z
    .string()
    .trim()
    .max(50, { message: "Category tag cannot exceed 50 characters" })
    .optional(),

  imageUrl:
    z
      .union([
        z.string().url({ message: "imageUrl must be a valid URL" }),
        z
          .array(z.string().url({ message: "Each imageUrl must be a valid URL" }))
          .max(4, { message: "Maximum 4 images allowed" }),
      ])
      .optional(),

  // Attribution for the submitted photo, e.g. "Wikimedia Commons".
  imageCredit: z
    .string()
    .trim()
    .max(200, { message: "imageCredit cannot exceed 200 characters" })
    .optional(),
});

export type SubmitPendingSiteInput = z.infer<typeof submitPendingSiteSchema>;
