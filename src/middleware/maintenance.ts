import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma.js";
import { isPaymentsEnabled } from "../config/payments.js";

/**
 * Maintenance-mode enforcement (§3.14).
 *
 * An active `MaintenanceWindow` lists modules under maintenance. Non-admin
 * requests touching those modules get 503; admins always bypass. Because this
 * runs as a global middleware (before per-route auth), admin identity is
 * resolved from the Authorization header when `req.user` is not yet set.
 */

export const MAINTENANCE_MODULES: string[] = [
  "ALL_MODULES",
  "TOURS",
  "SUBSCRIPTIONS",
  "NGO_MEMBERSHIP",
  "CASUAL_DATING",
  "PAYMENTS",
  "USER_REGISTRATION",
  "USER_LOGIN",
];
/** Map a request path to its maintenance module (null = not gated). */
export function moduleForPath(path: string, method: string): string | null {
  if (path === "/health" || path === "/" || path.startsWith("/system/")) return null;
  if (path.startsWith("/admin")) return null; // admins bypass; console stays up
  if (path.startsWith("/tours") || path.startsWith("/itinerary")) return "TOURS";
  if (path.startsWith("/membership") || path.startsWith("/dating/recommendations"))
    return "SUBSCRIPTIONS";
  if (path.startsWith("/dating")) return "CASUAL_DATING";
  if (path.startsWith("/payment")) return "PAYMENTS";
  if (method === "POST" && path === "/auth/register") return "USER_REGISTRATION";
  if (method === "POST" && path === "/auth/login") return "USER_LOGIN";
  if (method === "POST" && path === "/admin/auth/register") return "USER_REGISTRATION";
  return null;
}

let cached: { modules: string[]; expires: number } | null = null;

async function activeModules(): Promise<string[]> {
  if (cached && cached.expires > Date.now()) return cached.modules;
  try {
    const window = await prisma.maintenanceWindow.findFirst({
      where: { active: true },
      orderBy: { startedAt: "desc" },
      select: { modules: true },
    });
    const modules = Array.isArray(window?.modules) ? (window.modules as string[]) : [];
    cached = { modules, expires: Date.now() + 10_000 };
    return modules;
  } catch {
    return [];
  }
}

async function isAdminRequest(req: Request): Promise<boolean> {
  const sessionUser = (req as unknown as { user?: { accountType?: string } }).user;
  if (sessionUser?.accountType === "ADMIN") return true;
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  try {
    const decoded = jwt.verify(
      header.slice(7),
      process.env.JWT_ACCESS_SECRET as string,
    ) as jwt.JwtPayload & { id?: string; accountType?: string };
    if (decoded.accountType !== "ADMIN" || !decoded.id) return false;
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { accountType: true, accountStatus: true },
    });
    return user?.accountType === "ADMIN" && user?.accountStatus === "ACTIVE";
  } catch {
    return false;
  }
}

export async function maintenanceGate(req: Request, res: Response, next: NextFunction) {
  try {
    const module = moduleForPath(req.path, req.method);
    if (!module) return next();
    const modules = await activeModules();
    if (modules.length === 0) return next();
    if (!modules.includes(module) && !modules.includes("ALL_MODULES")) return next();
    if (await isAdminRequest(req)) return next();
    const window = await prisma.maintenanceWindow.findFirst({
      where: { active: true },
      orderBy: { startedAt: "desc" },
      select: { message: true },
    });
    res.status(503).json({
      success: false,
      error: {
        code: "MAINTENANCE",
        message: window?.message ?? "The platform is undergoing scheduled maintenance.",
        module,
      },
    });
  } catch (error) {
    console.error("[maintenance] gate failed open:", error);
    next();
  }
}

/** Public system status for the mobile app + dashboard module badges. */
export async function systemStatus() {
  const [window, paymentsEnabled] = await Promise.all([
    prisma.maintenanceWindow.findFirst({
      where: { active: true },
      orderBy: { startedAt: "desc" },
    }),
    isPaymentsEnabled().catch(() => true),
  ]);
  return {
    maintenance: window
      ? {
          active: true,
          modules: window.modules,
          message: window.message,
          startedAt: window.startedAt,
        }
      : { active: false, modules: [] as string[], message: null as string | null },
    payments: { enabled: paymentsEnabled },
    timestamp: new Date().toISOString(),
  };
}
