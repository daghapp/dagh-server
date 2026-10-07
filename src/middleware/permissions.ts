import { Request, Response, NextFunction } from "express";
import { AdminRole } from "../../generated/prisma/client.js";
import { prisma } from "../config/prisma.js";
import { fail } from "../helpers/response.js";

export const PERMISSIONS = {
  DASHBOARD: {
    VIEW: "dashboard.view",
    FULL: "dashboard.full",
  },
  TOURS: {
    VIEW: "tours.view",
    EDIT: "tours.edit",
    DELETE: "tours.delete",
    APPROVE: "tours.approve",
  },
  PAYMENTS: {
    VIEW: "payments.view",
    REFUND: "payments.refund",
    FLAG: "payments.flag",
    TOGGLE: "payments.toggle",
    EXPORT: "payments.export",
  },
  USERS: {
    VIEW: "users.view",
    EDIT: "users.edit",
    SUSPEND: "users.suspend",
    TERMINATE: "users.terminate",
    APPROVE: "users.approve",
    REJECT: "users.reject",
    DELETE: "users.delete",
    WARN: "users.warn",
    LOOKUP: "users.lookup",
  },
  DATING: {
    VIEW: "dating.view",
    APPROVE: "dating.approve",
    REJECT: "dating.reject",
    WARN: "dating.warn",
  },
  BUSINESS_APPS: {
    VIEW: "business.view",
    APPROVE: "business.approve",
    REJECT: "business.reject",
  },
  NGO_ACCESS: {
    VIEW: "ngo.view",
    GRANT: "ngo.grant",
    REVOKE: "ngo.revoke",
  },
  REPORTS: {
    VIEW: "reports.view",
    EXPORT: "reports.export",
    GENERATE: "reports.generate",
  },
  SETTINGS: {
    FULL: "settings.full",
    VIEW: "settings.view",
  },
  AUDIT: {
    VIEW: "audit.view",
    EXPORT: "audit.export",
  },
  MAINTENANCE: {
    MANAGE: "maintenance.manage",
  },
  ROLES: {
    VIEW: "roles.view",
    MANAGE: "roles.manage",
  },
  NOTIFICATIONS: {
    VIEW: "notifications.view",
    MANAGE: "notifications.manage",
  },
} as const;

export type PermissionKey = string;

const ROLE_SCOPES_MAP: Record<AdminRole, string[]> = {
  [AdminRole.SUPER_ADMIN]: [
    "dashboard.view",
    "dashboard.full",
    "tours.view",
    "tours.edit",
    "tours.delete",
    "tours.approve",
    "payments.view",
    "payments.refund",
    "payments.flag",
    "payments.toggle",
    "payments.export",
    "users.view",
    "users.edit",
    "users.suspend",
    "users.terminate",
    "users.approve",
    "users.reject",
    "users.delete",
    "users.warn",
    "users.lookup",
    "dating.view",
    "dating.approve",
    "dating.reject",
    "dating.warn",
    "business.view",
    "business.approve",
    "business.reject",
    "ngo.view",
    "ngo.grant",
    "ngo.revoke",
    "reports.view",
    "reports.export",
    "reports.generate",
    "settings.full",
    "settings.view",
    "audit.view",
    "audit.export",
    "maintenance.manage",
    "roles.view",
    "roles.manage",
    "notifications.view",
    "notifications.manage",
  ],
  [AdminRole.OPERATIONS]: [
    "dashboard.view",
    "tours.view",
    "tours.edit",
    "tours.approve",
    "users.view",
    "users.edit",
    "users.suspend",
    "users.approve",
    "users.reject",
    "dating.view",
    "dating.approve",
    "dating.reject",
    "dating.warn",
    "business.view",
    "business.approve",
    "business.reject",
    "ngo.view",
    "ngo.grant",
    "reports.view",
    "reports.export",
  ],
  [AdminRole.FINANCE]: [
    "dashboard.view",
    "payments.view",
    "payments.refund",
    "payments.flag",
    "payments.export",
    "users.view",
    "reports.view",
    "reports.export",
    "reports.generate",
  ],
  [AdminRole.SUPPORT]: [
    "dashboard.view",
    "tours.view",
    "users.view",
    "users.lookup",
    "dating.view",
    "business.view",
    "ngo.view",
    "reports.view",
  ],
};

function getPermissionsForRole(role: AdminRole): string[] {
  return ROLE_SCOPES_MAP[role] || [];
}

export function hasPermissionKey(role: AdminRole, permission: string): boolean {
  return getPermissionsForRole(role).includes(permission);
}

const ROLE_CACHE_KEY = "__adminRole";

export async function loadAdminRole(req: Request): Promise<AdminRole | null> {
  const cacheable = req as any;
  if (cacheable[ROLE_CACHE_KEY] !== undefined) {
    return cacheable[ROLE_CACHE_KEY]?.role ?? cacheable[ROLE_CACHE_KEY];
  }
  const user = req.user;
  if (!user) return null;
  const profile = await prisma.adminProfile.findUnique({
    where: { userId: user.id },
    select: { role: true },
  });
  cacheable[ROLE_CACHE_KEY] = profile;
  return profile?.role ?? null;
}

export function requirePermission(permission: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user || user.accountType !== "ADMIN") {
      fail(res, 403, { code: "INSUFFICIENT_PERMISSION", message: "Administrator account required" });
      return;
    }
    try {
      const role = await loadAdminRole(req);
      if (!role) {
        fail(res, 403, { code: "INSUFFICIENT_PERMISSION", message: "Administrator account required" });
        return;
      }
      if (!hasPermissionKey(role, permission)) {
        fail(res, 403, {
          code: "INSUFFICIENT_PERMISSION",
          message: `Your administrator role (${role}) cannot perform this action`,
          scope: permission,
        });
        return;
      }
      next();
    } catch (error) {
      console.error("[RBAC] failed to load admin profile:", error);
      res.status(500).json({ success: false, error: "Failed to verify permissions" });
      return;
    }
  };
}

export async function assertPermission(req: Request, res: Response, permission: string): Promise<Response | null> {
  const user = req.user;
  if (!user || user.accountType !== "ADMIN") {
    return fail(res, 403, { code: "INSUFFICIENT_PERMISSION", message: "Administrator account required" });
  }
  const role = await loadAdminRole(req);
  if (!role || !hasPermissionKey(role, permission)) {
    return fail(res, 403, {
      code: "INSUFFICIENT_PERMISSION",
      message: `Your administrator role (${role ?? "NONE"}) cannot perform this action`,
      scope: permission,
    });
  }
  return null;
}

export function _clearAdminRoleCache(req: Request): void {
  delete (req as any)[ROLE_CACHE_KEY];
}

export function getAllPermissionsForRole(role: AdminRole): string[] {
  return getPermissionsForRole(role);
}
