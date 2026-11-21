// ─────────────────────────────────────────
// Membership Routes — mounted at /membership
// ─────────────────────────────────────────

import express from "express";
import { MembershipController } from "../modules/membership/membership.controller.js";
import { validate } from "../middleware/validation.js";
import protectedRoute from "../middleware/protected.js";
import verifyHubtelCallback from "../middleware/hubtel-callback.js";
import { subscribeMembershipSchema, prioritySupportSchema } from "../validator/index.js";

const router = express.Router();
const controller = new MembershipController();

/**
 * @swagger
 * /membership/plans:
 *   get:
 *     summary: List all active membership plans
 *     tags: [Membership]
 *     responses:
 *       200:
 *         description: Membership plans retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       code:
 *                         type: string
 *                       name:
 *                         type: string
 *                       description:
 *                         type: string
 *                       price:
 *                         type: number
 *                       currency:
 *                         type: string
 *                       interval:
 *                         type: string
 *                         enum: [MONTHLY, ANNUAL, BIENNIAL, CUSTOM]
 *                       features:
 *                         type: array
 *                         items:
 *                           type: string
 *                       isMostPopular:
 *                         type: boolean
 *                       isActive:
 *                         type: boolean
 *       500:
 *         description: Failed to fetch membership plans
 */
router.get("/plans", controller.getPlans.bind(controller));

/**
 * @swagger
 * /membership/subscribe:
 *   post:
 *     summary: Subscribe to a membership plan
 *     description: Free plans activate immediately. Paid plans initialize a Hubtel checkout and return a checkoutUrl. Activation happens on payment callback only.
 *     tags: [Membership]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - planId
 *               - returnUrl
 *               - callbackUrl
 *             properties:
 *               planId:
 *                 type: string
 *                 format: uuid
 *                 description: Membership plan ID
 *               returnUrl:
 *                 type: string
 *                 description: |
 *                   URL to redirect after payment. Accepts HTTPS URLs or mobile deep links
 *                   (e.g. "daghapp://payment-complete"). Non-HTTP schemes are automatically
 *                   bridged to a public HTTPS redirect endpoint.
 *               callbackUrl:
 *                 type: string
 *                 format: uri
 *                 description: Public HTTPS server endpoint for payment callback
 *               cancellationUrl:
 *                 type: string
 *                 description: |
 *                   URL to redirect if user cancels. Accepts HTTPS URLs or mobile deep links.
 *                   Optional — defaults to returnUrl when omitted.
 *               platform:
 *                 type: string
 *                 enum: [ios, android, web]
 *                 description: |
 *                   Client platform fallback when X-Client-Platform is unavailable. Paid
 *                   digital memberships on iOS return 403 DIGITAL_PURCHASE_REQUIRES_IAP
 *                   unless the deployment holds Apple's external-purchase entitlement.
 *     parameters:
 *       - in: header
 *         name: X-Client-Platform
 *         required: false
 *         schema:
 *           type: string
 *           enum: [ios, android, web]
 *         description: Preferred way for the app to declare its platform.
 *     responses:
 *       200:
 *         description: Plan activated (free) or checkout initialized (paid)
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   description: Free plan — activated immediately
 *                   properties:
 *                     success:
 *                       type: boolean
 *                     data:
 *                       type: object
 *                       properties:
 *                         subscriptionId:
 *                           type: string
 *                         status:
 *                           type: string
 *                           enum: [ACTIVE]
 *                         checkoutUrl:
 *                           type: string
 *                           nullable: true
 *                           example: null
 *                     message:
 *                       type: string
 *                 - type: object
 *                   description: Paid plan — checkout URL returned
 *                   properties:
 *                     success:
 *                       type: boolean
 *                     data:
 *                       type: object
 *                       properties:
 *                         subscriptionId:
 *                           type: string
 *                         paymentReference:
 *                           type: string
 *                         status:
 *                           type: string
 *                           enum: [PAYMENT_PENDING]
 *                         checkoutUrl:
 *                           type: string
 *                           format: uri
 *                           description: Absolute HTTPS checkout URL
 *                         expiresAt:
 *                           type: string
 *                           format: date-time
 *                     message:
 *                       type: string
 *       400:
 *         description: Invalid plan ID or return URL
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StableError'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: |
 *           Paid digital membership on iOS without Apple's external-purchase
 *           entitlement. Error code: DIGITAL_PURCHASE_REQUIRES_IAP
 *       409:
 *         description: Subscription already active for this plan
 *       422:
 *         description: Checkout initialization failed
 *       502:
 *         description: Payment provider error
 */
router.post(
  "/subscribe",
  protectedRoute,
  validate(subscribeMembershipSchema),
  controller.subscribe.bind(controller),
);

/**
 * @swagger
 * /membership/my-subscription:
 *   get:
 *     summary: Get the authenticated user's current subscription
 *     description: Returns the latest callback-processed status and selected plan. No stale PAYMENT_PENDING after callback activation.
 *     tags: [Membership]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Subscription details retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [ACTIVE, PAYMENT_PENDING, PAYMENT_FAILED, CANCELLED, EXPIRED, SUSPENDED]
 *                     planId:
 *                       type: string
 *                       nullable: true
 *                     tierCode:
 *                       type: string
 *                     accessSource:
 *                       type: string
 *                       enum: [SUBSCRIPTION, GRANT, FREE, FREE_MODE]
 *                     waiveServiceFees:
 *                       type: boolean
 *                       description: True when an admin granted lifetime free access; no service should be charged.
 *                     paymentReference:
 *                       type: string
 *                       nullable: true
 *                       description: Latest payment reference for this subscription
 *                     activatedAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                       description: startDate when status is ACTIVE
 *                     plan:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         id:
 *                           type: string
 *                         name:
 *                           type: string
 *                         interval:
 *                           type: string
 *                     memberCode:
 *                       type: string
 *                       nullable: true
 *                     autoRenew:
 *                       type: boolean
 *       401:
 *         description: Unauthorized
 */
router.get("/my-subscription", protectedRoute, controller.getMySubscription.bind(controller));
router.get("/subscription", protectedRoute, controller.getMySubscription.bind(controller));

/**
 * @swagger
 * /membership/cancel:
 *   post:
 *     summary: Cancel the authenticated user's active subscription
 *     tags: [Membership]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Subscription cancelled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     subscriptionId:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [CANCELLED]
 *                     cancelledAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No subscription found for this user
 *       409:
 *         description: Subscription is not in a cancellable state
 */
router.post("/cancel", protectedRoute, controller.cancelSubscription.bind(controller));

/**
 * @swagger
 * /membership/support:
 *   post:
 *     summary: Create a priority support ticket (paid tiers only)
 *     tags: [Membership]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - subject
 *               - message
 *             properties:
 *               subject:
 *                 type: string
 *                 minLength: 3
 *               message:
 *                 type: string
 *                 minLength: 10
 *     responses:
 *       201:
 *         description: Support ticket created successfully
 *       400:
 *         description: Validation error or free-tier users attempting to create tickets
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/support",
  protectedRoute,
  validate(prioritySupportSchema),
  controller.createPrioritySupport.bind(controller),
);

/**
 * @swagger
 * /membership/payment-callback:
 *   post:
 *     summary: Hubtel payment callback for subscription payments
 *     description: |
 *       Processes payment results from Hubtel. Verifies the provider signature,
 *       activates the subscription on successful payment, and is idempotent
 *       (duplicate callbacks are ignored). Never activates from client success messages alone.
 *     tags: [Membership]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ResponseCode:
 *                 type: string
 *                 description: "Hubtel response code (0000 = success)"
 *               Data:
 *                 type: object
 *                 properties:
 *                   ClientReference:
 *                     type: string
 *                     description: Payment reference matching the subscription
 *     responses:
 *       200:
 *         description: Payment callback handled
 *       400:
 *         description: Missing client reference
 *       500:
 *         description: Failed to handle payment callback
 */
router.post(
  "/payment-callback",
  verifyHubtelCallback,
  controller.handlePaymentCallback.bind(controller),
);

/**
 * @swagger
 * /membership/payment/return:
 *   get:
 *     summary: Payment return bridge for mobile deep links
 *     description: |
 *       HTTPS bridge that receives the payment provider redirect and forwards
 *       the user back to the mobile application via the configured deep link.
 *       Used when the payment provider only accepts HTTPS redirect URLs.
 *     tags: [Membership]
 *     parameters:
 *       - in: query
 *         name: appUrl
 *         required: true
 *         schema:
 *           type: string
 *         description: Application deep link to redirect back to
 *     responses:
 *       302:
 *         description: Redirect to the application deep link
 *       200:
 *         description: Payment complete (no appUrl provided)
 */
router.get("/payment/return", controller.paymentReturnBridge.bind(controller));

/**
 * @swagger
 * /membership/payment/cancel:
 *   get:
 *     summary: Payment cancellation bridge for mobile deep links
 *     description: |
 *       HTTPS bridge that receives the payment provider redirect on cancellation
 *       and forwards the user back to the mobile application via the configured deep link.
 *     tags: [Membership]
 *     parameters:
 *       - in: query
 *         name: appUrl
 *         required: true
 *         schema:
 *           type: string
 *         description: Application deep link to redirect back to on cancellation
 *     responses:
 *       302:
 *         description: Redirect to the application deep link
 *       200:
 *         description: Payment cancelled (no appUrl provided)
 */
router.get("/payment/cancel", controller.paymentCancelBridge.bind(controller));

export { router };
