/**
 * Admin activity log helper (Phase 0).
 *
 * Writes an `AdminActivityLog` row for every mutating admin-console action so
 * the dashboard "Recent Activity" feed and detail-screen "Activity Log" tabs can
 * be built from one source of truth instead of the provider-scoped `AuditLog`.
 */
import { prisma } from "../config/index.js";

export const AdminEntityType = {
  VISA_REQUEST: "VISA_REQUEST",
  PAYMENT: "PAYMENT",
  TOUR: "TOUR",
  USER: "USER",
  REPORT: "REPORT",
  PROFILE_VERIFICATION: "PROFILE_VERIFICATION",
} as const;

export type AdminEntityType = (typeof AdminEntityType)[keyof typeof AdminEntityType];

export interface LogAdminActivityInput {
  actorId: string;
  entityType: AdminEntityType;
  entityId?: string;
  action: string;
  note?: string;
}

export function logAdminActivity(input: LogAdminActivityInput) {
  return prisma.adminActivityLog.create({
    data: {
      actorId: input.actorId,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      action: input.action,
      note: input.note ?? null,
    },
  });
}
