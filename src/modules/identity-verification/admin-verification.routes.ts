import express from "express";
import protectedRoute from "../../middleware/protected.js";
import { requirePermission, PERMISSIONS } from "../../middleware/permissions.js";
import { IdentityVerificationController } from "./identity-verification.controller.js";

const router = express.Router();
const c = new IdentityVerificationController();

router.get("/", protectedRoute, requirePermission(PERMISSIONS.IDENTITY.VIEW), c.adminList.bind(c));
router.patch(
  "/:userId/decide",
  protectedRoute,
  requirePermission(PERMISSIONS.IDENTITY.REVIEW),
  c.adminDecide.bind(c),
);
router.patch(
  "/appeals/:appealId/decide",
  protectedRoute,
  requirePermission(PERMISSIONS.IDENTITY.APPEAL),
  c.adminDecideAppeal.bind(c),
);

export { router };
