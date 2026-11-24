import { z } from "zod";
import { genderSchema } from "./genderValidation.js";

export const profileSettingsSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters long").max(120).optional(),
  gender: genderSchema.optional(),
  dateOfBirth: z.coerce
    .date({ message: "Invalid date of birth" })
    .refine((date) => date.getTime() < Date.now(), {
      message: "Date of birth must be in the past",
    })
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

export type ProfileSettingsInput = z.infer<typeof profileSettingsSchema>;
