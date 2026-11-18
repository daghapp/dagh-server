import { Router } from "express";
import protectedRoute from "../middleware/protected.js";
import { validate } from "../middleware/validation.js";
import { requirePermission, PERMISSIONS } from "../middleware/permissions.js";
import { AdminAnnouncementController } from "../modules/admin/announcement.controller.js";
import { createAnnouncementSchema } from "../validator/announcementValidation.js";

const router = Router();
const controller = new AdminAnnouncementController();

// Broadcasting is global: SUPER_ADMIN only (`notifications.manage`). Read and
// maintenance of an admin's own bell remain available to every role.
router.get(
  "/broadcasts/audience-preview",
  protectedRoute,
  requirePermission(PERMISSIONS.NOTIFICATIONS.MANAGE),
  controller.preview.bind(controller),
);

router.get(
  "/broadcasts",
  protectedRoute,
  requirePermission(PERMISSIONS.NOTIFICATIONS.MANAGE),
  controller.list.bind(controller),
);

router.post(
  "/broadcasts",
  protectedRoute,
  requirePermission(PERMISSIONS.NOTIFICATIONS.MANAGE),
  validate(createAnnouncementSchema),
  controller.create.bind(controller),
);

router.get(
  "/broadcasts/:id",
  protectedRoute,
  requirePermission(PERMISSIONS.NOTIFICATIONS.MANAGE),
  controller.get.bind(controller),
);

router.post(
  "/broadcasts/:id/cancel",
  protectedRoute,
  requirePermission(PERMISSIONS.NOTIFICATIONS.MANAGE),
  controller.cancel.bind(controller),
);

export { router };
