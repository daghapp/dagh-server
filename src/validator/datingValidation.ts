import { z } from "zod";

export const datingProfileSchema = z.object({
  headline: z.string().max(80, "Headline must not exceed 80 characters").optional(),
  about: z.string().max(2000, "Bio must not exceed 2000 characters").optional(),
  photos: z.array(z.string().url("Invalid photo URL")).max(9, "Maximum of 9 photos").optional(),
  heightCm: z
    .number()
    .int()
    .min(120, "Height must be at least 120cm")
    .max(250, "Height must be at most 250cm")
    .optional(),
  interests: z.array(z.string().min(1).max(40)).max(20, "Maximum of 20 interests").optional(),
  lookingFor: z.enum(["LONG_TERM_PARTNER", "SHORT_TERM", "FRIENDSHIP", "NOT_SURE"]).optional(),
});

export type DatingProfileInput = z.infer<typeof datingProfileSchema>;

export const discoveryPreferenceSchema = z.object({
  lookingFor: z.enum(["LONG_TERM_PARTNER", "SHORT_TERM", "FRIENDSHIP", "NOT_SURE"]).optional(),
  genderPreference: z.array(z.enum(["MALE", "FEMALE", "OTHER"])).optional(),
  minAge: z.number().int().min(18).max(99).optional(),
  maxAge: z.number().int().min(18).max(99).optional(),
  maxDistanceKm: z.number().int().min(1).max(20000).optional(),
  locationLat: z.number().min(-90).max(90).optional(),
  locationLng: z.number().min(-180).max(180).optional(),
  locationName: z.string().max(120).optional(),
  showProfile: z.boolean().optional(),
  showOnlineStatus: z.boolean().optional(),
});

export type DiscoveryPreferenceInput = z.infer<typeof discoveryPreferenceSchema>;

export const swipeSchema = z.object({
  targetId: z.string().uuid("Invalid target user ID"),
  direction: z.enum(["LIKE", "SUPER_LIKE", "PASS"]),
});

export type SwipeInput = z.infer<typeof swipeSchema>;
