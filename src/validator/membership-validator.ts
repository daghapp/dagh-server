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
export const createMembershipPlanSchema = z.object({
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
});

export type SubscribeMembershipSchema = z.infer<typeof subscribeMembershipSchema>;
export type PrioritySupportSchema = z.infer<typeof prioritySupportSchema>;
export type CreateMembershipPlanSchema = z.infer<typeof createMembershipPlanSchema>;
