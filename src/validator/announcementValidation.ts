import { z } from "zod";

/**
 * Admin push broadcasts.
 *
 * `ANNOUNCEMENT` covers service/operational messages and is on by default.
 * `PROMOTION` is marketing content and is delivered only to users who
 * explicitly opted in, matching Expo/FCM/APNs and app-store policy.
 */
export const ANNOUNCEMENT_CATEGORIES = ["ANNOUNCEMENT", "PROMOTION"] as const;
export const ANNOUNCEMENT_AUDIENCES = ["ACTIVE", "VERIFIED", "ALL"] as const;

export const createAnnouncementSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "title is required")
      .max(120, "title must be 120 characters or fewer"),
    body: z
      .string()
      .trim()
      .min(1, "body is required")
      .max(500, "body must be 500 characters or fewer"),
    category: z.enum(ANNOUNCEMENT_CATEGORIES),
    audience: z.enum(ANNOUNCEMENT_AUDIENCES).default("ACTIVE"),
    route: z
      .string()
      .trim()
      .max(200, "route must be 200 characters or fewer")
      .refine((value) => value === "" || value.startsWith("/"), "route must be an in-app path")
      .optional()
      .nullable(),
    scheduledAt: z.coerce
      .date({ message: "scheduledAt must be an ISO date-time" })
      .optional()
      .nullable(),
    sendNow: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.sendNow && value.scheduledAt) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduledAt"],
        message: "Omit scheduledAt when sendNow is true",
      });
    }
    if (!value.sendNow && !value.scheduledAt) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduledAt"],
        message: "scheduledAt is required when sendNow is false",
      });
    }
    if (value.scheduledAt && value.scheduledAt.getTime() <= Date.now()) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduledAt"],
        message: "scheduledAt must be in the future",
      });
    }
  });

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;

/** Preferences shape needed to decide whether a category may be delivered. */
export interface AnnouncementPreference {
  announcementsEnabled: boolean;
  promotionsEnabled: boolean;
}

/**
 * Marketing requires explicit opt-in; service announcements are opt-out.
 * A missing preference row uses the database defaults (announcements on,
 * promotions off).
 */
export function isEligibleForCategory(
  category: string,
  preference: AnnouncementPreference | null | undefined,
): boolean {
  if (category === "PROMOTION") return preference?.promotionsEnabled === true;
  return preference?.announcementsEnabled !== false;
}
