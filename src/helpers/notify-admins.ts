import { prisma } from "../config/prisma.js";
import { hasPermissionKey } from "../middleware/permissions.js";
import { emitAdminNotification } from "./admin-room.js";
import { getSocketIO } from "../sockets/io.js";

/**
 * Fan-out for admin notifications (§3.4).
 *
 * Writes one `AdminNotification` row per eligible admin (active, non-deleted,
 * whose role carries the category's permission) and emits `admin:notification`
 * into each recipient's `admin:{id}` room. Never throws — notification
 * delivery must not fail the action that triggered it.
 */

export const NOTIFICATION_CATEGORY_PERMISSION: Record<string, string> = {
  payments: "payments.view",
  security: "users.view",
  users: "users.view",
  subscriptions: "subscriptions.view",
  ngo: "ngo.view",
  dating: "dating.view",
};

export interface NotifyAdminsInput {
  category: keyof typeof NOTIFICATION_CATEGORY_PERMISSION | string;
  message: string;
  actionUrl?: string;
  meta?: Record<string, unknown>;
  excludeAdminId?: string;
}

export async function notifyAdmins(input: NotifyAdminsInput): Promise<void> {
  try {
    const permission = NOTIFICATION_CATEGORY_PERMISSION[input.category] ?? "dashboard.view";
    const admins = await prisma.user.findMany({
      where: { accountType: "ADMIN", accountStatus: "ACTIVE", isDeleted: false },
      select: { id: true, adminProfile: { select: { role: true } } },
    });
    const targets = admins.filter(
      (a) =>
        a.adminProfile &&
        hasPermissionKey(a.adminProfile.role, permission) &&
        a.id !== input.excludeAdminId,
    );
    if (targets.length === 0) return;

    const rows = await Promise.all(
      targets.map((t) =>
        prisma.adminNotification.create({
          data: {
            adminId: t.id,
            category: input.category,
            message: input.message,
            actionUrl: input.actionUrl ?? null,
            meta: (input.meta ?? {}) as object,
          },
        }),
      ),
    );

    const io = getSocketIO();
    if (!io) return;
    for (const row of rows) {
      emitAdminNotification(io, row.adminId, {
        id: row.id,
        category: row.category,
        message: row.message,
        actionUrl: row.actionUrl,
        createdAt: row.createdAt,
      });
    }
  } catch (error) {
    console.error("[notify-admins] fan-out failed:", error);
  }
}
