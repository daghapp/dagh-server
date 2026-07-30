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
 *     description: Free plans activate immediately. Paid plans initialize a Hubtel checkout and are activated on payment callback.
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
 *               returnUrl:
 *                 type: string
 *                 format: uri
 *               callbackUrl:
 *                 type: string
 *                 format: uri
 *               cancellationUrl:
 *                 type: string
 *                 format: uri
 *     responses:
 *       200:
 *         description: Plan activated or payment initialized
 *       400:
 *         description: Invalid input or plan not found
 *       401:
 *         description: Unauthorized
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
 *                     tierCode:
 *                       type: string
 *                     plan:
 *                       type: object
 *                       nullable: true
 *                     memberCode:
 *                       type: string
 *                       nullable: true
 *                     startDate:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     endDate:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     status:
 *                       type: string
 *                     autoRenew:
 *                       type: boolean
 *       401:
 *         description: Unauthorized
 */
router.get("/my-subscription", protectedRoute, controller.getMySubscription.bind(controller));

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
 *     tags: [Membership]
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

export { router };
