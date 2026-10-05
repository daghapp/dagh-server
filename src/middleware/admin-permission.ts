import { Request, Response, NextFunction } from "express";
import { AdminRole } from "../../generated/prisma/client.js";
import { prisma } from "../config/prisma.js";
import { fail } from "../helpers/response.js";

/**
 * Capability-based authorization for admin routes.
 *
 * `requireAdmin` (src/middleware/admin.ts) only asserts `accountType === "ADMIN"`,
 * which is far too coarse for payment-gateway credentials: any admin account
 * could otherwise read and rewrite the live payment provider keys. This module
 * introduces the permission-scope vocabulary the API handoff specifies and
 * enforces it server-side, independently of what the admin UI renders.
 *
 * Scope enforcement today
 * -----------------------
 * Every scope currently resolves to SUPER_ADMIN only. That is deliberate: the
 * repository has no permission table, and inventing one alongside 30+ ungated
 * admin routes would create two competing authorization models. The role ->
 * scope mapping is isolated in {@link hasPermission} so widening it later (for
 * example to let FINANCE hold the `view` + `processing.manage` scopes) is a
 * single-function change with no call-site edits.
 */

/** Permission scopes for the payment gateway settings surface. */
export const PAYMENT_GATEWAY_PERMISSIONS = {
  VIEW: "settings.payment.view",
  MANAGE_CREDENTIALS: "settings.payment.credentials.manage",
  TEST_CONNECTION: "settings.payment.connection.test",
  MANAGE_CONNECTION: "settings.payment.connection.manage",
  MANAGE_ENVIRONMENT: "settings.payment.environment.manage",
  MANAGE_PROCESSING: "settings.payment.processing.manage",
} as const;

export type PaymentGatewayPermission =
  (typeof PAYMENT_GATEWAY_PERMISSIONS)[keyof typeof PAYMENT_GATEWAY_PERMISSIONS];

/**
 * Role -> scope mapping. Keep this the single place that decides who may do
 * what; nothing else in the codebase should compare roles to scopes.
 */
const ROLE_SCOPES: Record<AdminRole, readonly PaymentGatewayPermission[]> = {
  [AdminRole.SUPER_ADMIN]: Object.values(PAYMENT_GATEWAY_PERMISSIONS),
  [AdminRole.OPERATIONS]: [],
  [AdminRole.FINANCE]: [],
  [AdminRole.SUPPORT]: [],
  [AdminRole.ADMIN]: [],
  [AdminRole.VISA_OFFICER]: [],
  [AdminRole.TOUR_MANAGER]: [],
  [AdminRole.MODERATOR]: [],
};

export function hasPermission(role: AdminRole, scope: PaymentGatewayPermission): boolean {
  return ROLE_SCOPES[role]?.includes(scope) ?? false;
}

type AdminRoleCache = { role: AdminRole } | null;

const ROLE_CACHE_KEY = "__adminRole";

type RequestWithRoleCache = Request & { [ROLE_CACHE_KEY]?: AdminRoleCache };

/**
 * Loads (and memoises per request) the acting admin's role.
 *
 * A user with `accountType === "ADMIN"` but no AdminProfile row has no role at
 * all, which is treated as no permissions rather than as an implicit super admin.
 */
async function loadAdminRole(req: Request): Promise<AdminRole | null> {
  const cacheable = req as RequestWithRoleCache;
  if (ROLE_CACHE_KEY in cacheable) return cacheable[ROLE_CACHE_KEY]?.role ?? null;

  const user = req.user;
  if (!user) return null;

  const profile = await prisma.adminProfile.findUnique({
    where: { userId: user.id },
    select: { role: true },
  });

  cacheable[ROLE_CACHE_KEY] = profile;
  return profile?.role ?? null;
}

function deny(res: Response, scope: PaymentGatewayPermission, reason: string) {
  return fail(res, 403, {
    code: "INSUFFICIENT_PERMISSION",
    message: reason,
    scope,
  });
}

/**
 * Route guard: requires an ADMIN account holding `scope`.
 *
 * Must be mounted after `protectedRoute`.
 */
export function requireAdminPermission(scope: PaymentGatewayPermission) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user || user.accountType !== "ADMIN") {
      deny(res, scope, "Administrator account required");
      return;
    }

    let role: AdminRole | null;
    try {
      role = await loadAdminRole(req);
    } catch (error) {
      console.error("[RBAC] failed to load admin profile:", error);
      res.status(500).json({ success: false, error: "Failed to verify permissions" });
      return;
    }

    if (!role) {
      deny(res, scope, "Administrator account required");
      return;
    }

    if (!hasPermission(role, scope)) {
      deny(res, scope, `Your administrator role (${role}) cannot perform this action`);
      return;
    }

    next();
  };
}

/**
 * In-controller guard for sub-actions of an already-authorized request.
 *
 * `PUT /admin/settings/payment-gateway` can change credentials *and* the
 * environment in one call, so the environment half needs its own scope check
 * that route-level middleware cannot perform (it runs before the body is read).
 * Returns null when permitted, or a ready-to-send Response when not.
 */
export async function assertAdminPermission(
  req: Request,
  res: Response,
  scope: PaymentGatewayPermission,
): Promise<Response | null> {
  const user = req.user;
  if (!user || user.accountType !== "ADMIN") {
    return deny(res, scope, "Administrator account required");
  }

  const role = await loadAdminRole(req);
  if (!role || !hasPermission(role, scope)) {
    return deny(
      res,
      scope,
      `Your administrator role (${role ?? "NONE"}) cannot perform this action`,
    );
  }

  return null;
}

/** Test helper: clears the per-request memoised role. */
export function _clearAdminRoleCache(req: Request): void {
  delete (req as RequestWithRoleCache)[ROLE_CACHE_KEY];
}
