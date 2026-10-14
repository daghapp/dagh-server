import { Router } from "express";
import protectedRoute from "../middleware/protected.js";
import { requirePermission, PERMISSIONS } from "../middleware/permissions.js";
import { AdminActivityController } from "../modules/admin/activity.controller.js";

const router = Router();
const controller = new AdminActivityController();

router.get(
  "/activity/export",
  protectedRoute,
  requirePermission(PERMISSIONS.REPORTS.EXPORT),
  controller.exportCsv.bind(controller),
);

router.get(
  "/activity",
  protectedRoute,
  requirePermission(PERMISSIONS.REPORTS.VIEW),
  controller.list.bind(controller),
);

router.get(
  "/audit-logs/export",
  protectedRoute,
  requirePermission(PERMISSIONS.AUDIT.EXPORT),
  controller.auditExport.bind(controller),
);

router.get(
  "/audit-logs",
  protectedRoute,
  requirePermission(PERMISSIONS.AUDIT.VIEW),
  controller.auditLogs.bind(controller),
);

export { router };
