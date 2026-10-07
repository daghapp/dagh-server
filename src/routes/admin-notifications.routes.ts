import express from "express";
import { AdminNotificationsController } from "../modules/admin/notifications.controller.js";
import protectedRoute from "../middleware/protected.js";
import { requirePermission, PERMISSIONS } from "../middleware/permissions.js";

const router = express.Router();
const controller = new AdminNotificationsController();

// The bell is a per-admin channel: every role can read and maintain their own
// queue (granted via notifications.view on all roles), while broadcasting /
// global management stays notifications.manage (SUPER_ADMIN only).
router.get(
  "/",
  protectedRoute,
  requirePermission(PERMISSIONS.NOTIFICATIONS.VIEW),
  controller.list.bind(controller),
);
router.patch(
  "/:id/read",
  protectedRoute,
  requirePermission(PERMISSIONS.NOTIFICATIONS.VIEW),
  controller.markRead.bind(controller),
);
router.patch(
  "/read-all",
  protectedRoute,
  requirePermission(PERMISSIONS.NOTIFICATIONS.VIEW),
  controller.markAllRead.bind(controller),
);
router.delete(
  "/",
  protectedRoute,
  requirePermission(PERMISSIONS.NOTIFICATIONS.VIEW),
  controller.clearAll.bind(controller),
);

export { router };
