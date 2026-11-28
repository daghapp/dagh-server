import express from "express";
import protectedRoute from "../../middleware/protected.js";
import { requirePermission, PERMISSIONS } from "../../middleware/permissions.js";
import { ListingsController } from "./listings.controller.js";

const router = express.Router();
const c = new ListingsController();

router.get(
  "/queue",
  protectedRoute,
  requirePermission(PERMISSIONS.LISTINGS.VIEW),
  c.adminQueue.bind(c),
);
router.patch(
  "/:id/decide",
  protectedRoute,
  requirePermission(PERMISSIONS.LISTINGS.VERIFY),
  c.adminDecide.bind(c),
);
router.patch(
  "/:id/badge",
  protectedRoute,
  requirePermission(PERMISSIONS.LISTINGS.VERIFY),
  c.issueBadge.bind(c),
);
router.get(
  "/search-requests",
  protectedRoute,
  requirePermission(PERMISSIONS.LISTINGS.VIEW),
  c.listSearchRequests.bind(c),
);
router.patch(
  "/search-requests/:id",
  protectedRoute,
  requirePermission(PERMISSIONS.LISTINGS.MANAGE),
  c.updateSearchRequest.bind(c),
);

export { router };
