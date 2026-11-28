import express from "express";
import protectedRoute from "../../middleware/protected.js";
import { requirePermission, PERMISSIONS } from "../../middleware/permissions.js";
import { ForumsController } from "./forums.controller.js";

const router = express.Router();
const c = new ForumsController();

router.get(
  "/pending-threads",
  protectedRoute,
  requirePermission(PERMISSIONS.CONTENT.VIEW),
  c.adminPendingThreads.bind(c),
);
router.get(
  "/pending-comments",
  protectedRoute,
  requirePermission(PERMISSIONS.CONTENT.VIEW),
  c.adminPendingComments.bind(c),
);
router.patch(
  "/threads/:id/decide",
  protectedRoute,
  requirePermission(PERMISSIONS.CONTENT.MODERATE),
  c.adminDecideThread.bind(c),
);
router.patch(
  "/comments/:id/decide",
  protectedRoute,
  requirePermission(PERMISSIONS.CONTENT.MODERATE),
  c.adminDecideComment.bind(c),
);

export { router };
