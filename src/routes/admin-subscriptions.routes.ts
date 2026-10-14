import express from "express";
import protectedRoute from "../middleware/protected.js";
import { requirePermission, PERMISSIONS } from "../middleware/permissions.js";
import { AdminSubscriptionsController } from "../modules/admin/subscriptions-admin.controller.js";

// Admin subscriptions + NGO access (§3.9). Router root — mounted centrally
// at /admin, so paths below are relative to that mount.
const router = express.Router();
const controller = new AdminSubscriptionsController();

router.get(
  "/subscriptions",
  protectedRoute,
  requirePermission(PERMISSIONS.SUBSCRIPTIONS.VIEW),
  controller.listSubscriptions.bind(controller),
);

router.patch(
  "/subscriptions/:id/cancel",
  protectedRoute,
  requirePermission(PERMISSIONS.SUBSCRIPTIONS.CANCEL),
  controller.cancelSubscription.bind(controller),
);

router.patch(
  "/subscriptions/:id/extend",
  protectedRoute,
  requirePermission(PERMISSIONS.SUBSCRIPTIONS.EXTEND),
  controller.extendSubscription.bind(controller),
);

router.get(
  "/ngo/members",
  protectedRoute,
  requirePermission(PERMISSIONS.NGO_ACCESS.VIEW),
  controller.listNgoMembers.bind(controller),
);

router.patch(
  "/ngo/members/:id/grant-access",
  protectedRoute,
  requirePermission(PERMISSIONS.NGO_ACCESS.GRANT),
  controller.grantNgoAccess.bind(controller),
);

router.patch(
  "/ngo/members/:id/revoke-access",
  protectedRoute,
  requirePermission(PERMISSIONS.NGO_ACCESS.REVOKE),
  controller.revokeNgoAccess.bind(controller),
);

// ngo.lifetime sits in the SUPER_ADMIN scope only (see ROLE_SCOPES_MAP), so
// this endpoint is SUPER_ADMIN-only through the permission key alone.
router.post(
  "/ngo/lifetime-access",
  protectedRoute,
  requirePermission(PERMISSIONS.NGO_ACCESS.LIFETIME),
  controller.grantLifetimeAccess.bind(controller),
);

export { router };
