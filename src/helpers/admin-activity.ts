/**
 * Admin activity log helper (Phase 0).
 *
 * Writes an `AdminActivityLog` row for every mutating admin-console action so
 * the dashboard "Recent Activity" feed and detail-screen "Activity Log" tabs can
 * be built from one source of truth instead of the provider-scoped `AuditLog`.
 */
// Imported directly from ./prisma rather than the ../config barrel: the barrel
// re-exports ./hubtel, which imports the payment gateway service, which imports
// this file. Going through the barrel creates an import cycle.
import { prisma } from "../config/prisma.js";

export const AdminEntityType = {
  VISA_REQUEST: "VISA_REQUEST",
  PAYMENT: "PAYMENT",
  TOUR: "TOUR",
  USER: "USER",
  REPORT: "REPORT",
  PROFILE_VERIFICATION: "PROFILE_VERIFICATION",
  MEMBERSHIP_PLAN: "MEMBERSHIP_PLAN",
  SUBSCRIPTION_ACCESS_GRANT: "SUBSCRIPTION_ACCESS_GRANT",
  PAYMENT_GATEWAY: "PAYMENT_GATEWAY",
  SETTINGS: "SETTINGS",
  MAINTENANCE: "MAINTENANCE",
  TOUR_DESTINATION: "TOUR_DESTINATION",
} as const;

export type AdminEntityType = (typeof AdminEntityType)[keyof typeof AdminEntityType];

export interface LogAdminActivityInput {
  actorId: string;
  entityType: AdminEntityType;
  entityId?: string;
  action: string;
  note?: string;
  /**
   * Structured, non-secret before/after context for the change. Also carries
   * the acting request's correlation id. Never store credentials here.
   */
  metadata?: Record<string, unknown>;
}

export function logAdminActivity(input: LogAdminActivityInput) {
  return prisma.adminActivityLog.create({
    data: {
      actorId: input.actorId,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      action: input.action,
      note: input.note ?? null,
      ...(input.metadata ? { metadata: input.metadata as object } : {}),
    },
  });
}
