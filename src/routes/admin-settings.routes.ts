import { Router } from "express";
import protectedRoute from "../middleware/protected.js";
import { requirePermission, PERMISSIONS } from "../middleware/permissions.js";
import { AdminSettingsController } from "../modules/admin/settings.controller.js";

const router = Router();
const controller = new AdminSettingsController();

router.get(
  "/:tab",
  protectedRoute,
  requirePermission(PERMISSIONS.SETTINGS.VIEW),
  controller.getTab.bind(controller),
);

router.put(
  "/:tab",
  protectedRoute,
  requirePermission(PERMISSIONS.SETTINGS.FULL),
  controller.updateTab.bind(controller),
);

export { router };
