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

  // --- Basic Info ---
  location: z.string().max(120, "Location must not exceed 120 characters").optional(),

  // --- Education & Career ---
  degree: z.string().max(120).optional(),
  university: z.string().max(120).optional(),
  profession: z.string().max(120).optional(),
  industry: z.string().max(120).optional(),
  workLocation: z.string().max(120).optional(),

  // --- Cultural Background ---
  languages: z.array(z.string().min(1).max(40)).max(20, "Maximum of 20 languages").optional(),
  religion: z.string().max(60).optional(),
  hometown: z.string().max(120).optional(),

  // --- Account-level fields (set on the User, sourced from the profile creation forms) ---
  fullName: z.string().min(2, "Full name must be at least 2 characters long").max(120).optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"], { message: "Invalid gender value" }).optional(),
  dateOfBirth: z.coerce
    .date({ message: "Invalid date of birth" })
    .refine((date) => date.getTime() < Date.now(), {
      message: "Date of birth must be in the past",
    })
    .refine(
      (date) => {
        // Use start-of-day in the user's perspective to avoid timezone edge cases.
        // If someone is 18 today in their timezone, they should pass.
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const birthDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const diff = today.getTime() - birthDate.getTime();
        const age = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
        return age >= 18;
      },
      { message: "You must be at least 18 years old" },
    )
    .optional(),
  ethnicity: z
    .enum(
      [
        "African",
        "Asian",
        "Black_African_American",
        "Caribbean",
        "Caucassian_White",
        "Hispanic_Latino",
        "Middle_Eastern",
        "Mixed",
        "Native_American_Indigenous",
        "Pacific_Islander",
        "Other",
      ],
      { message: "Invalid ethnicity value" },
    )
    .optional(),
});

export type DatingProfileInput = z.infer<typeof datingProfileSchema>;

export const discoveryPreferenceSchema = z.object({
  lookingFor: z.enum(["LONG_TERM_PARTNER", "SHORT_TERM", "FRIENDSHIP", "NOT_SURE"]).optional(),
  genderPreference: z.array(z.enum(["MALE", "FEMALE", "OTHER"])).optional(),
  minAge: z.number().int().min(18).max(99).optional(),
  maxAge: z.number().int().min(18).max(99).optional(),
  maxDistanceKm: z.number().int().min(1).max(20000).optional(),
  globalDiscovery: z.boolean().optional(),
  locationLat: z.number().min(-90).max(90).nullable().optional(),
  locationLng: z.number().min(-180).max(180).nullable().optional(),
  locationName: z.string().max(120).nullable().optional(),
  showProfile: z.boolean().optional(),
  showOnlineStatus: z.boolean().optional(),
});

export type DiscoveryPreferenceInput = z.infer<typeof discoveryPreferenceSchema>;

export const swipeSchema = z.object({
  targetId: z.string().uuid("Invalid target user ID"),
  direction: z.enum(["LIKE", "SUPER_LIKE", "PASS"]),
});

export type SwipeInput = z.infer<typeof swipeSchema>;
