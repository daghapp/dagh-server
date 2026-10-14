import { Router, Request, Response } from "express";
import protectedRoute from "../middleware/protected.js";
import { requirePermission, PERMISSIONS } from "../middleware/permissions.js";
import { AdminMaintenanceController } from "../modules/admin/maintenance.controller.js";
import { systemStatus } from "../middleware/maintenance.js";
import { ok, fail } from "../helpers/response.js";

const adminRouter = Router();
const controller = new AdminMaintenanceController();

adminRouter.get(
  "/",
  protectedRoute,
  requirePermission(PERMISSIONS.MAINTENANCE.MANAGE),
  controller.current.bind(controller),
);

adminRouter.post(
  "/",
  protectedRoute,
  requirePermission(PERMISSIONS.MAINTENANCE.MANAGE),
  controller.create.bind(controller),
);

adminRouter.patch(
  "/:id",
  protectedRoute,
  requirePermission(PERMISSIONS.MAINTENANCE.MANAGE),
  controller.endEarly.bind(controller),
);

adminRouter.get(
  "/history",
  protectedRoute,
  requirePermission(PERMISSIONS.MAINTENANCE.MANAGE),
  controller.history.bind(controller),
);

/** Public router — mount at /system (no auth). */
const publicRouter = Router();
publicRouter.get("/status", async (_req: Request, res: Response) => {
  try {
    return ok(res, await systemStatus());
  } catch (error) {
    console.error("[system-status] failed:", error);
    return fail(res, 500, "Failed to load system status");
  }
});

export { adminRouter, publicRouter };
