import { z } from "zod";

/**
 * Login-profile update schema — the account-level profile the logged-in user
 * can edit (username, first/last name, and profile image). Unlike the dating
 * profile, this lives directly on the User record.
 *
 * `profileImageUrl` accepts a URL from POST /upload (nullable so the user can
 * remove their picture by sending null).
 */
export const accountProfileSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Username must be at least 3 characters long")
    .max(30, "Username must not exceed 30 characters")
    .regex(/^[a-z0-9_]+$/, "Username may only contain lowercase letters, numbers, and underscores")
    .optional(),
  firstName: z
    .string()
    .trim()
    .min(1, "First name is required")
    .max(120, "First name must not exceed 120 characters")
    .optional(),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name is required")
    .max(120, "Last name must not exceed 120 characters")
    .optional(),
  profileImageUrl: z
    .union([z.string().url("Invalid profile image URL"), z.null().transform(() => null)])
    .optional(),
});

export type AccountProfileInput = z.infer<typeof accountProfileSchema>;

/**
 * Account-deletion schema — the authenticated user can permanently delete
 * their account via DELETE /profile/account. The current password is required
 * for accounts registered with email/password. It is optional because
 * OAuth-only accounts (Google/Facebook/Apple) have no passwordHash to verify.
 */
export const deleteAccountSchema = z.object({
  password: z.string().trim().min(1, "Password is required").optional(),
});

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
