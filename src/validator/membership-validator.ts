// ─────────────────────────────────────────
// Membership Module — Zod Validation Schemas
// ─────────────────────────────────────────

import { z } from "zod";

// Schema for subscribing to a membership plan
// Hubtel checkout handles the payment method selection on its hosted page,
// so only Hubtel return/callback URLs and the plan ID are needed.
// returnUrl and cancellationUrl accept any non-empty string because mobile apps
// send Expo/application deep links (e.g. "daghapp://payment") which are not
// standard HTTP URLs. The controller bridges unsupported schemes to HTTPS.
export const subscribeMembershipSchema = z.object({
  planId: z.string().uuid("Invalid plan ID"),
  returnUrl: z.string().min(1, "Return URL is required"),
  callbackUrl: z.string().url("Invalid callback URL"),
  cancellationUrl: z.string().min(1, "Cancellation URL must not be empty").optional(),
});

// Schema for creating a priority support ticket (paid tier members only)
export const prioritySupportSchema = z.object({
  subject: z.string().min(3, "Subject must be at least 3 characters"),
  message: z.string().min(10, "Message must be at least 10 characters"),
});

// Admin schema for creating/updating membership plan definitions
export const createMembershipPlanSchema = z
  .object({
    code: z.enum([
      "FREE",
      "BASELINE",
      "SENIOR_PIONEER",
      "SANKOFA_SETTLED",
      "BASIC",
      "SILVER",
      "GOLD_INVESTOR",
      "ELITE_AMBASSADOR",
      "FAMILY_PLAN",
    ]),
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    price: z.number().nonnegative("Price must be non-negative"),
    currency: z.string().default("GHS"),
    interval: z.enum(["MONTHLY", "ANNUAL", "BIENNIAL", "CUSTOM"]),
    features: z.array(z.string()).default([]),
    isMostPopular: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .refine((data) => data.code === "FREE" || data.price > 0, {
    message:
      "Only the FREE plan may be priced at 0 — a paid tier at 0 would activate without payment",
    path: ["price"],
  });

export type SubscribeMembershipSchema = z.infer<typeof subscribeMembershipSchema>;
export type PrioritySupportSchema = z.infer<typeof prioritySupportSchema>;
export type CreateMembershipPlanSchema = z.infer<typeof createMembershipPlanSchema>;

// ─────────────────────────────────────────
// Admin access grants (comped membership)
// ─────────────────────────────────────────

const TIER_CODE_ENUM = [
  "FREE",
  "BASELINE",
  "SENIOR_PIONEER",
  "SANKOFA_SETTLED",
  "BASIC",
  "SILVER",
  "GOLD_INVESTOR",
  "ELITE_AMBASSADOR",
  "FAMILY_PLAN",
] as const;

/**
 * Grants a user complimentary access to a tier.
 *
 * endDate is optional: omitted means perpetual. Grants never auto-renew, so a
 * comp either runs to its end date or forever — there is no billing side effect.
 */
export const createAccessGrantSchema = z
  .object({
    userId: z.string().min(1, "User ID is required"),
    // FREE is rejected below: a grant must give more than the user already has.
    tierCode: z.enum(TIER_CODE_ENUM),
    includePaidPerks: z.boolean().default(false),
    reason: z.string().min(3, "A reason is required for the audit trail").max(500),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().nullable().optional(),
  })
  .refine((data) => data.tierCode !== "FREE", {
    message: "A grant must confer a paid tier, not FREE",
    path: ["tierCode"],
  })
  .refine((data) => !data.endDate || !data.startDate || data.endDate > data.startDate, {
    message: "endDate must be after startDate",
    path: ["endDate"],
  });

/** Partial update. Revoking early is done by moving endDate into the past. */
export const updateAccessGrantSchema = z
  .object({
    tierCode: z.enum(TIER_CODE_ENUM).optional(),
    includePaidPerks: z.boolean().optional(),
    reason: z.string().min(3).max(500).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().nullable().optional(),
  })
  .refine((data) => data.tierCode !== "FREE", {
    message: "A grant must confer a paid tier, not FREE",
    path: ["tierCode"],
  })
  // An empty patch would be a no-op update that still writes an "updated" audit
  // entry, so reject it rather than record a change that never happened.
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "Provide at least one field to update",
  });

export const revokeAccessGrantSchema = z.object({
  reason: z.string().min(3, "A revocation reason is required").max(500).optional(),
});

export type CreateAccessGrantSchema = z.infer<typeof createAccessGrantSchema>;
export type UpdateAccessGrantSchema = z.infer<typeof updateAccessGrantSchema>;
export type RevokeAccessGrantSchema = z.infer<typeof revokeAccessGrantSchema>;
