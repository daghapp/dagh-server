import express from "express";
import protectedRoute from "../middleware/protected.js";
import { requirePermission, PERMISSIONS } from "../middleware/permissions.js";
import { AdminPaymentsConsoleController } from "../modules/admin/payments-console.controller.js";

/**
 * Admin payments console router — §3.8 gaps (§3.8 handoff).
 *
 * Mounting is done centrally; this module only builds and exports `router`.
 * Static segments (/stats, /export) are registered BEFORE /:id so they are
 * never swallowed by the param route.
 */
const router = express.Router();
const adminPayments = new AdminPaymentsConsoleController();

router.get(
  "/",
  protectedRoute,
  requirePermission(PERMISSIONS.PAYMENTS.VIEW),
  adminPayments.list.bind(adminPayments),
);

router.get(
  "/stats",
  protectedRoute,
  requirePermission(PERMISSIONS.PAYMENTS.VIEW),
  adminPayments.stats.bind(adminPayments),
);

router.get(
  "/export",
  protectedRoute,
  requirePermission(PERMISSIONS.PAYMENTS.EXPORT),
  adminPayments.exportCsv.bind(adminPayments),
);

router.get(
  "/:id/receipt",
  protectedRoute,
  requirePermission(PERMISSIONS.PAYMENTS.VIEW),
  adminPayments.receipt.bind(adminPayments),
);

router.get(
  "/:id",
  protectedRoute,
  requirePermission(PERMISSIONS.PAYMENTS.VIEW),
  adminPayments.getById.bind(adminPayments),
);

router.post(
  "/:id/refund",
  protectedRoute,
  requirePermission(PERMISSIONS.PAYMENTS.REFUND),
  adminPayments.refund.bind(adminPayments),
);

router.post(
  "/:id/flag",
  protectedRoute,
  requirePermission(PERMISSIONS.PAYMENTS.FLAG),
  adminPayments.flag.bind(adminPayments),
);

router.post(
  "/:id/retry",
  protectedRoute,
  requirePermission(PERMISSIONS.PAYMENTS.RETRY),
  adminPayments.retry.bind(adminPayments),
);

router.post(
  "/:id/verify-gateway",
  protectedRoute,
  requirePermission(PERMISSIONS.PAYMENTS.VIEW),
  adminPayments.verifyGateway.bind(adminPayments),
);

router.post(
  "/:id/override",
  protectedRoute,
  requirePermission(PERMISSIONS.PAYMENTS.OVERRIDE),
  adminPayments.override.bind(adminPayments),
);

export { router };
