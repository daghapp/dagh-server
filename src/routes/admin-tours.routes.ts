import { Router } from "express";
import protectedRoute from "../middleware/protected.js";
import { requirePermission, PERMISSIONS } from "../middleware/permissions.js";
import { AdminTourController } from "../modules/tour-management/admin-tour.controller.js";

const router = Router();
const controller = new AdminTourController();

router.get(
  "/",
  protectedRoute,
  requirePermission(PERMISSIONS.TOURS.VIEW),
  controller.listDestinations.bind(controller),
);

router.get(
  "/:id",
  protectedRoute,
  requirePermission(PERMISSIONS.TOURS.VIEW),
  controller.getDestination.bind(controller),
);

router.patch(
  "/:id/status",
  protectedRoute,
  requirePermission(PERMISSIONS.TOURS.EDIT),
  controller.updateStatus.bind(controller),
);

router.delete(
  "/:id/media/:mediaId",
  protectedRoute,
  requirePermission(PERMISSIONS.TOURS.EDIT),
  controller.deleteMedia.bind(controller),
);

export { router };
