import express from "express";
import { AdminPaymentGatewayController } from "../modules/admin/payment-gateway-console.controller.js";
import protectedRoute from "../middleware/protected.js";
import {
  PAYMENT_GATEWAY_PERMISSIONS,
  requireAdminPermission,
} from "../middleware/admin-permission.js";
import {
  setPaymentProcessingSchema,
  updatePaymentGatewaySettingsSchema,
} from "../validator/payment-gateway-validator.js";
import { validate } from "../middleware/validation.js";

const router = express.Router();
const controller = new AdminPaymentGatewayController();

/**
 * @swagger
 * /admin/settings/payment-gateway:
 *   get:
 *     summary: Get payment gateway configuration
 *     description: >
 *       Returns the stored payment gateway configuration for the calling
 *       administrator. The client secret is write-only: this response contains
 *       only the `hasClientSecret` presence flag and never the value, not even
 *       masked. When no configuration row exists, the response reflects the
 *       HUBTEL_* environment variables with `credentialSource: "environment"`.
 *     tags: [Admin - Payment Gateway]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: "#/components/schemas/SanitizedGatewayConfig" }
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin privileges required
 */
router.get(
  "/settings/payment-gateway",
  protectedRoute,
  requireAdminPermission(PAYMENT_GATEWAY_PERMISSIONS.VIEW),
  controller.getSettings.bind(controller),
);

/**
 * @swagger
 * /admin/settings/payment-gateway:
 *   put:
 *     summary: Update payment gateway credentials or environment
 *     description: >
 *       Partial update. Every field is optional and a blank or omitted
 *       `clientId` / `clientSecret` means "no change" — removing a stored secret
 *       requires the explicit `clearClientSecret: true` flag. Whitespace is
 *       trimmed from the client id before it is stored. Changing the
 *       credentials revokes the recorded verification and automatically disables
 *       payment processing, because leaving money movement enabled against
 *       unverified credentials is unsafe. `connectionStatus` is server-derived
 *       and cannot be set through this endpoint.
 *     tags: [Admin - Payment Gateway]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               clientId: { type: "string", maxLength: 128 }
 *               clientSecret: { type: "string", maxLength: 512, writeOnly: true }
 *               clearClientSecret: { type: boolean }
 *               environment: { type: "string", enum: ["TEST", "LIVE"] }
 *     responses:
 *       200:
 *         description: Updated configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: "#/components/schemas/SanitizedGatewayConfig" }
 *       400:
 *         description: Invalid input, or clearing the last remaining credential
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Insufficient administrator permission
 */
router.put(
  "/settings/payment-gateway",
  protectedRoute,
  requireAdminPermission(PAYMENT_GATEWAY_PERMISSIONS.MANAGE_CREDENTIALS),
  validate(updatePaymentGatewaySettingsSchema),
  controller.updateSettings.bind(controller),
);

/**
 * @swagger
 * /admin/settings/payment-gateway/test:
 *   post:
 *     summary: Test the Hubtel connection
 *     description: >
 *       Verifies credentials with a non-mutating read-only call against Hubtel's
 *       transaction status API. It cannot initiate, capture, or reverse a
 *       payment, and it is safe to retry. A successful test updates
 *       `lastTestedAt` only — it does not change `connectionStatus`; use
 *       `/connect` for that. May be called with unsaved in-flight credentials to
 *       check them before storing. Idempotent.
 *     tags: [Admin - Payment Gateway]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               clientId: { type: "string", writeOnly: true }
 *               clientSecret: { type: "string", writeOnly: true }
 *               environment: { type: "string", enum: ["TEST", "LIVE"] }
 *     responses:
 *       200:
 *         description: Credentials accepted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     success: { type: boolean }
 *                     message: { type: "string" }
 *                     checkedAt: { type: "string", format: date-time }
 *                     retryable: { type: "boolean" }
 *       400:
 *         description: Credentials rejected by Hubtel, or missing locally
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Insufficient administrator permission
 *       503:
 *         description: Hubtel unreachable or timed out (retryable)
 */
router.post(
  "/settings/payment-gateway/test",
  protectedRoute,
  requireAdminPermission(PAYMENT_GATEWAY_PERMISSIONS.TEST_CONNECTION),
  // No route-level `validate()` here: the body is entirely optional (an empty
  // body means "test the stored credentials"), so the controller validates it.
  controller.testConnection.bind(controller),
);

/**
 * @swagger
 * /admin/settings/payment-gateway/connect:
 *   post:
 *     summary: Connect to Hubtel
 *     description: >
 *       Verifies the stored credentials and, only if that verification passes,
 *       marks the gateway connected for the currently selected environment.
 *       The returned status is always the server-derived one; the client must
 *       not assume success optimistically. Disconnecting or invalidating
 *       credentials resets this state.
 *     tags: [Admin - Payment Gateway]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Connected
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     connectionStatus: { type: "string", enum: [CONNECTED] }
 *                     connectedAt: { type: "string", format: date-time, nullable: true }
 *                     environment: { type: "string", enum: [TEST, LIVE] }
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Insufficient administrator permission
 *       502:
 *         description: Verification failed — credentials rejected or provider error
 */
router.post(
  "/settings/payment-gateway/connect",
  protectedRoute,
  requireAdminPermission(PAYMENT_GATEWAY_PERMISSIONS.MANAGE_CONNECTION),
  controller.connect.bind(controller),
);

/**
 * @swagger
 * /admin/settings/payment-gateway/processing:
 *   patch:
 *     summary: Enable or disable payment processing
 *     description: >
 *       Master switch for payment processing. It is rejected with 409 when
 *       enabling while the currently selected environment has no verified
 *       connection. Disabling is always permitted, including while the gateway
 *       is unhealthy, so it remains usable as an operational kill switch.
 *     tags: [Admin - Payment Gateway]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [enabled]
 *             properties:
 *               enabled: { type: boolean }
 *               reason: { type: "string", maxLength: 500 }
 *     responses:
 *       200:
 *         description: Updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     paymentProcessingEnabled: { type: "boolean" }
 *                     effectiveAt: { type: "string", format: date-time }
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Insufficient administrator permission
 *       409:
 *         description: Gateway is not connected for the selected environment
 */
router.patch(
  "/settings/payment-gateway/processing",
  protectedRoute,
  requireAdminPermission(PAYMENT_GATEWAY_PERMISSIONS.MANAGE_PROCESSING),
  validate(setPaymentProcessingSchema),
  controller.setProcessing.bind(controller),
);

export { router };
