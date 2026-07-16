// User Profile Validator Schema

import { z } from "zod";

export const profileSchema = z.object({
  userId: z.string().uuid({ message: "Invalid user ID format" }),
  username: z
    .string()
    .min(3, { message: "Username must be at least 3 characters long" })
    .optional(),
  firstName: z
    .string()
    .min(2, { message: "First name must be at least 2 characters long" })
    .optional(),
  lastName: z
    .string()
    .min(2, { message: "Last name must be at least 2 characters long" })
    .optional(),
  dateOfBirth: z.coerce.date({ message: "Invalid date format" }).optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"], { message: "Invalid gender value" }).optional(),
  nationality: z
    .string()
    .min(2, { message: "Nationality must be at least 2 characters long" })
    .optional(),
  residenceCountry: z
    .string()
    .min(2, { message: "Residence country must be at least 2 characters long" })
    .optional(),
  residenceCity: z
    .string()
    .min(2, { message: "Residence city must be at least 2 characters long" })
    .optional(),
  residenceState: z
    .string()
    .min(2, { message: "Residence state must be at least 2 characters long" })
    .optional(),
  profilePhotoUrl: z.string().url({ message: "Invalid URL format" }).optional(),
  profilePhotoUploadedAt: z.coerce.date({ message: "Invalid date format" }).optional(),
  bio: z.string().max(500, { message: "Bio must not exceed 500 characters" }).optional(),
  languages: z.array(z.string()).optional(),
});

// Update Profile Schema - userId comes from auth context/params, not body
export const updateProfileSchema = z.object({
  username: z
    .string()
    .min(3, { message: "Username must be at least 3 characters long" })
    .optional(),
  firstName: z
    .string()
    .min(2, { message: "First name must be at least 2 characters long" })
    .optional(),
  lastName: z
    .string()
    .min(2, { message: "Last name must be at least 2 characters long" })
    .optional(),
  dateOfBirth: z.coerce.date({ message: "Invalid date format" }).optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"], { message: "Invalid gender value" }).optional(),
  nationality: z
    .string()
    .min(2, { message: "Nationality must be at least 2 characters long" })
    .optional(),
  residenceCountry: z
    .string()
    .min(2, { message: "Residence country must be at least 2 characters long" })
    .optional(),
  residenceCity: z
    .string()
    .min(2, { message: "Residence city must be at least 2 characters long" })
    .optional(),
  residenceState: z
    .string()
    .min(2, { message: "Residence state must be at least 2 characters long" })
    .optional(),
  profilePhotoUrl: z.string().url({ message: "Invalid URL format" }).optional(),
  bio: z.string().max(500, { message: "Bio must not exceed 500 characters" }).optional(),
  languages: z.array(z.string()).optional(),
});

export type UpdateProfileSchema = z.infer<typeof updateProfileSchema>;
export type ProfileSchema = z.infer<typeof profileSchema>;
