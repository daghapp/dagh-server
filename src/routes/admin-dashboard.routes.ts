import { Router } from "express";
import protectedRoute from "../middleware/protected.js";
import { requirePermission, PERMISSIONS } from "../middleware/permissions.js";
import { AdminDashboardController } from "../modules/admin/dashboard.controller.js";

const router = Router();
const controller = new AdminDashboardController();

router.get(
  "/charts",
  protectedRoute,
  requirePermission(PERMISSIONS.DASHBOARD.VIEW),
  controller.charts.bind(controller),
);

router.get(
  "/recent-activity",
  protectedRoute,
  requirePermission(PERMISSIONS.DASHBOARD.VIEW),
  controller.recentActivity.bind(controller),
);

export { router };
