import express from "express";
import protectedRoute from "../../middleware/protected.js";
import { requirePermission, PERMISSIONS } from "../../middleware/permissions.js";
import { ContentModerationController } from "./content-moderation.controller.js";

const router = express.Router();
const c = new ContentModerationController();

router.get(
  "/queue",
  protectedRoute,
  requirePermission(PERMISSIONS.CONTENT.VIEW),
  c.adminQueue.bind(c),
);
router.patch(
  "/posts/:id/decide",
  protectedRoute,
  requirePermission(PERMISSIONS.CONTENT.MODERATE),
  c.adminDecide.bind(c),
);
router.patch(
  "/appeals/:appealId/decide",
  protectedRoute,
  requirePermission(PERMISSIONS.CONTENT.APPEAL),
  c.adminDecideAppeal.bind(c),
);

export { router };
