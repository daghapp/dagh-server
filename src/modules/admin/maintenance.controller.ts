import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { logAdminActivity, AdminEntityType } from "../../helpers/admin-activity.js";
import { ok, fail, paginated } from "../../helpers/response.js";
import { MAINTENANCE_MODULES } from "../../middleware/maintenance.js";

function parseModules(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const modules = raw.filter((m): m is string => typeof m === "string" && m.length > 0);
  if (modules.length === 0) return null;
  const unknown = modules.filter((m) => !MAINTENANCE_MODULES.includes(m));
  return unknown.length > 0 ? null : modules;
}

export class AdminMaintenanceController {
  /** GET /admin/maintenance — current active window, if any. */
  async current(req: Request, res: Response) {
    try {
      const active = await prisma.maintenanceWindow.findFirst({
        where: { active: true },
        orderBy: { startedAt: "desc" },
      });
      return ok(res, { active: active ?? null, modules: MAINTENANCE_MODULES });
    } catch (error) {
      console.error("[maintenance] current failed:", error);
      return fail(res, 500, "Failed to load maintenance state");
    }
  }

  /** POST /admin/maintenance — activate a window. Ends any active one first. */
  async create(req: Request, res: Response) {
    try {
      const modules = parseModules(req.body?.modules);
      if (!modules) {
        return fail(
          res,
          400,
          `modules must be a non-empty array of: ${MAINTENANCE_MODULES.join(", ")}`,
        );
      }
      const message =
        typeof req.body?.message === "string" && req.body.message.length > 0
          ? req.body.message
          : "The platform is undergoing scheduled maintenance.";
      const scheduledAt =
        req.body?.scheduledAt != null ? new Date(req.body.scheduledAt) : new Date();
      if (Number.isNaN(scheduledAt.getTime())) return fail(res, 400, "Invalid scheduledAt");

      await prisma.maintenanceWindow.updateMany({
        where: { active: true },
        data: { active: false, endedAt: new Date(), endedBy: req.user!.id },
      });
      const window = await prisma.maintenanceWindow.create({
        data: { modules: modules as object, message, startedAt: scheduledAt, active: true },
      });
      await logAdminActivity({
        actorId: req.user!.id,
        entityType: AdminEntityType.MAINTENANCE,
        entityId: window.id,
        action: "MAINTENANCE_STARTED",
        note: message,
        metadata: { modules },
      });
      return ok(res, window, "Maintenance window activated");
    } catch (error) {
      console.error("[maintenance] create failed:", error);
      return fail(res, 500, "Failed to activate maintenance window");
    }
  }

  /** PATCH /admin/maintenance/:id — end a window early. */
  async endEarly(req: Request, res: Response) {
    try {
      const existing = await prisma.maintenanceWindow.findUnique({
        where: { id: req.params.id as string },
      });
      if (!existing) return fail(res, 404, "Maintenance window not found");
      const updated = await prisma.maintenanceWindow.update({
        where: { id: req.params.id as string },
        data: { active: false, endedAt: new Date(), endedBy: req.user!.id },
      });
      await logAdminActivity({
        actorId: req.user!.id,
        entityType: AdminEntityType.MAINTENANCE,
        entityId: updated.id,
        action: "MAINTENANCE_ENDED",
      });
      return ok(res, updated, "Maintenance window ended");
    } catch (error) {
      console.error("[maintenance] end failed:", error);
      return fail(res, 500, "Failed to end maintenance window");
    }
  }

  /** GET /admin/maintenance/history — latest windows first. */
  async history(req: Request, res: Response) {
    try {
      const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "20", 10)));
      const [rows, total] = await Promise.all([
        prisma.maintenanceWindow.findMany({
          orderBy: { startedAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.maintenanceWindow.count(),
      ]);
      return paginated(res, rows, total, page, limit);
    } catch (error) {
      console.error("[maintenance] history failed:", error);
      return fail(res, 500, "Failed to load maintenance history");
    }
  }
}
