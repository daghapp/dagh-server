import express from "express";
import protectedRoute from "../middleware/protected.js";
import requireAdmin from "../middleware/admin.js";
import { AdminVisaConsoleController } from "../modules/admin/visa-console.controller.js";
import { AdminPaymentsConsoleController } from "../modules/admin/payments-console.controller.js";
import { AdminDashboardController } from "../modules/admin/dashboard.controller.js";
import { AdminPlansConsoleController } from "../modules/admin/plans-console.controller.js";
import { AdminAccessGrantsConsoleController } from "../modules/admin/access-grants-console.controller.js";
import { validate } from "../middleware/validation.js";
import {
  createMembershipPlanSchema,
  updatePaymentControlSchema,
  createAccessGrantSchema,
  updateAccessGrantSchema,
  revokeAccessGrantSchema,
} from "../validator/index.js";

const router = express.Router();
const adminVisa = new AdminVisaConsoleController();
const adminPayments = new AdminPaymentsConsoleController();
const adminDashboard = new AdminDashboardController();
const adminPlans = new AdminPlansConsoleController();
const adminAccessGrants = new AdminAccessGrantsConsoleController();

/**
 * @swagger
 * /admin/dashboard/summary:
 *   get:
 *     summary: Dashboard KPI summary
 *     description: One round-trip payload for the console home screen (tours, visa queue, revenue, alerts)
 *     tags: [Admin - Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: KPI summary
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
 *                     tours:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: number
 *                         bulk:
 *                           type: number
 *                         custom:
 *                           type: number
 *                     pendingVisaRequests:
 *                       type: number
 *                     successfulPaymentsAmount:
 *                       type: number
 *                     successfulPaymentsMoMPercent:
 *                       type: number
 *                     alerts:
 *                       type: object
 *                       properties:
 *                         pendingVisaRequests:
 *                           type: number
 *                         pendingReports:
 *                           type: number
 *                         pendingProfileVerifications:
 *                           type: number
 *                         failedPaymentsLast24h:
 *                           type: number
 *       403:
 *         description: Admin privileges required
 */
router.get(
  "/dashboard/summary",
  protectedRoute,
  requireAdmin,
  adminDashboard.summary.bind(adminDashboard),
);

/**
 * @swagger
 * /admin/users/verified:
 *   get:
 *     summary: List verified users with counts
 *     description: Paginated list of verified users (names + contact details) with a verified-user count and overall user total
 *     tags: [Admin - Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Verified users and counts
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
 *                     data:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           isVerified:
 *                             type: boolean
 *                           verifiedAt:
 *                             type: string
 *                             format: date-time
 *                           user:
 *                             type: object
 *                             nullable: true
 *                             properties:
 *                               id:
 *                                 type: string
 *                               fullName:
 *                                 type: string
 *                               email:
 *                                 type: string
 *                               phoneNumber:
 *                                 type: string
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: number
 *                         page:
 *                           type: number
 *                         limit:
 *                           type: number
 *                         totalPages:
 *                           type: number
 *                     counts:
 *                       type: object
 *                       properties:
 *                         verifiedUsers:
 *                           type: number
 *                         totalUsers:
 *                           type: number
 *       403:
 *         description: Admin privileges required
 */
router.get(
  "/users/verified",
  protectedRoute,
  requireAdmin,
  adminDashboard.verifiedUsers.bind(adminDashboard),
);

/**
 * @swagger
 * /admin/visa-requests:
 *   get:
 *     summary: List visa requests (console queue)
 *     description: Paginated, filterable list for the visa management screen
 *     tags: [Admin - Visa]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED, PAYMENT_FAILED, READY_FOR_GIS_SUBMISSION, EXPEDITED_AIRPORT_PAYMENT_PENDING]
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search by passport number, purpose of trip, applicant name or email
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Paginated visa requests
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
 *                       status:
 *                         type: string
 *                       packageType:
 *                         type: string
 *                         enum: [STANDARD, EXPEDITED]
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       user:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           fullName:
 *                             type: string
 *                           email:
 *                             type: string
 *                           phoneNumber:
 *                             type: string
 *                       visaData:
 *                         type: object
 *                         properties:
 *                           passport_number:
 *                             type: string
 *                           purpose_of_trip:
 *                             type: string
 *                           date_of_arrival:
 *                             type: string
 *                             format: date-time
 *                           date_of_departure:
 *                             type: string
 *                             format: date-time
 *                       payment:
 *                         type: object
 *                         nullable: true
 *                         properties:
 *                           id:
 *                             type: string
 *                           amount:
 *                             type: number
 *                           status:
 *                             type: string
 *                       approval:
 *                         type: object
 *                         nullable: true
 *                         properties:
 *                           status:
 *                             type: string
 *                           approvedAt:
 *                             type: string
 *                             format: date-time
 *                           notes:
 *                             type: string
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: number
 *                     page:
 *                       type: number
 *                     limit:
 *                       type: number
 *                     totalPages:
 *                       type: number
 *       403:
 *         description: Admin privileges required
 */
router.get("/visa-requests", protectedRoute, requireAdmin, adminVisa.list.bind(adminVisa));

/**
 * @swagger
 * /admin/visa-requests/stats:
 *   get:
 *     summary: Visa request KPIs
 *     description: Counter stats for the visa queue (total, pending review, approved today, rejection rate)
 *     tags: [Admin - Visa]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Visa stats
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
 *                     total:
 *                       type: number
 *                     pendingReview:
 *                       type: number
 *                     rejected:
 *                       type: number
 *                     approvedToday:
 *                       type: number
 *                     rejectionRate:
 *                       type: number
 *       403:
 *         description: Admin privileges required
 */
router.get("/visa-requests/stats", protectedRoute, requireAdmin, adminVisa.stats.bind(adminVisa));

/**
 * @swagger
 * /admin/visa-requests/{id}:
 *   get:
 *     summary: Visa request detail
 *     description: Full detail including applicant, documents, payment, approval and admin activity trail
 *     tags: [Admin - Visa]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Visa request ID
 *     responses:
 *       200:
 *         description: Visa request detail
 *       403:
 *         description: Admin privileges required
 *       404:
 *         description: Visa request not found
 */
router.get("/visa-requests/:id", protectedRoute, requireAdmin, adminVisa.detail.bind(adminVisa));

/**
 * @swagger
 * /admin/visa-requests/{id}/approve:
 *   post:
 *     summary: Approve a visa request (idempotent)
 *     tags: [Admin - Visa]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               note:
 *                 type: string
 *     responses:
 *       200:
 *         description: Visa request approved
 *       403:
 *         description: Admin privileges required
 *       404:
 *         description: Visa request not found
 */
router.post(
  "/visa-requests/:id/approve",
  protectedRoute,
  requireAdmin,
  adminVisa.approve.bind(adminVisa),
);

/**
 * @swagger
 * /admin/visa-requests/{id}/reject:
 *   post:
 *     summary: Reject a visa request (idempotent)
 *     tags: [Admin - Visa]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               note:
 *                 type: string
 *     responses:
 *       200:
 *         description: Visa request rejected
 *       403:
 *         description: Admin privileges required
 *       404:
 *         description: Visa request not found
 */
router.post(
  "/visa-requests/:id/reject",
  protectedRoute,
  requireAdmin,
  adminVisa.reject.bind(adminVisa),
);

/**
 * @swagger
 * /admin/payments:
 *   get:
 *     summary: List payments (console transactions)
 *     description: Paginated, filterable transaction list for the payments screen
 *     tags: [Admin - Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [INITIALIZED, PENDING, SUCCESS, FAILED]
 *       - in: query
 *         name: targetType
 *         schema:
 *           type: string
 *           enum: [VISA_ON_ARRIVAL, TOUR_BOOKING, TOUR_REQUEST, MEMBERSHIP_SUBSCRIPTION]
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search by payment reference, user name or email
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Paginated payments
 *       403:
 *         description: Admin privileges required
 */
router.get("/payments", protectedRoute, requireAdmin, adminPayments.list.bind(adminPayments));

/**
 * @swagger
 * /admin/payments/stats:
 *   get:
 *     summary: Payment KPIs
 *     description: Revenue, pending, failed and success-rate stats for the payments screen
 *     tags: [Admin - Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Payment stats
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
 *                     totalRevenue:
 *                       type: number
 *                     successCount:
 *                       type: number
 *                     pendingCount:
 *                       type: number
 *                     pendingAmount:
 *                       type: number
 *                     failedCount:
 *                       type: number
 *                     successRate:
 *                       type: number
 *       403:
 *         description: Admin privileges required
 */
router.get(
  "/payments/stats",
  protectedRoute,
  requireAdmin,
  adminPayments.stats.bind(adminPayments),
);

/**
 * @swagger
 * /admin/payments/status:
 *   get:
 *     summary: Payment system control status
 *     description: Returns whether the payment system is currently enabled or disabled, plus updater and reason metadata
 *     tags: [Admin - Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payment system status
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
 *                     enabled:
 *                       type: boolean
 *                     reason:
 *                       type: string
 *                       nullable: true
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *                     updatedBy:
 *                       type: string
 *                       nullable: true
 *       403:
 *         description: Admin privileges required
 */
router.get(
  "/payments/status",
  protectedRoute,
  requireAdmin,
  adminPayments.getControlStatus.bind(adminPayments),
);

/**
 * @swagger
 * /admin/payments/status:
 *   patch:
 *     summary: Toggle payment system availability
 *     description: Enables or disables payment processing (Hubtel checkout & MOMO) across the entire platform
 *     tags: [Admin - Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - enabled
 *             properties:
 *               enabled:
 *                 type: boolean
 *                 description: Set to true to enable payments, false to disable
 *               reason:
 *                 type: string
 *                 description: Optional reason or maintenance notice
 *                 maxLength: 500
 *     responses:
 *       200:
 *         description: Updated payment system status
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
 *                     enabled:
 *                       type: boolean
 *                     reason:
 *                       type: string
 *                       nullable: true
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *                     updatedBy:
 *                       type: string
 *                       nullable: true
 *                 message:
 *                   type: string
 *       400:
 *         description: Invalid request payload
 *       403:
 *         description: Admin privileges required
 */
router.patch(
  "/payments/status",
  protectedRoute,
  requireAdmin,
  validate(updatePaymentControlSchema),
  adminPayments.updateControlStatus.bind(adminPayments),
);

/**
 * @swagger
 * /admin/plans:
 *   get:
 *     summary: List membership plans (console)
 *     tags: [Admin - Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: active
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Optional filter to only active/inactive plans
 *     responses:
 *       200:
 *         description: Membership plans
 *       403:
 *         description: Admin privileges required
 */
router.get("/plans", protectedRoute, requireAdmin, adminPlans.list.bind(adminPlans));

/**
 * @swagger
 * /admin/plans:
 *   post:
 *     summary: Create a membership plan (console)
 *     tags: [Admin - Plans]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name, price, interval]
 *             properties:
 *               code:
 *                 type: string
 *                 enum: [FREE, BASELINE, SENIOR_PIONEER, SANKOFA_SETTLED, BASIC, SILVER, GOLD_INVESTOR, ELITE_AMBASSADOR, FAMILY_PLAN]
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               price:
 *                 type: number
 *               currency:
 *                 type: string
 *                 default: GHS
 *               interval:
 *                 type: string
 *                 enum: [MONTHLY, ANNUAL, BIENNIAL, CUSTOM]
 *               features:
 *                 type: array
 *                 items:
 *                   type: string
 *               isMostPopular:
 *                 type: boolean
 *               isActive:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Plan created
 *       400:
 *         description: Validation error or invalid code/interval
 *       409:
 *         description: Plan already exists
 *       403:
 *         description: Admin privileges required
 */
router.post(
  "/plans",
  protectedRoute,
  requireAdmin,
  validate(createMembershipPlanSchema),
  adminPlans.create.bind(adminPlans),
);

/**
 * @swagger
 * /admin/plans/{id}:
 *   patch:
 *     summary: Update a membership plan (console)
 *     tags: [Admin - Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               price:
 *                 type: number
 *               currency:
 *                 type: string
 *               interval:
 *                 type: string
 *               features:
 *                 type: array
 *                 items:
 *                   type: string
 *               isMostPopular:
 *                 type: boolean
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Plan updated
 *       404:
 *         description: Plan not found
 *       403:
 *         description: Admin privileges required
 */
router.patch("/plans/:id", protectedRoute, requireAdmin, adminPlans.update.bind(adminPlans));

/**
 * @swagger
 * /admin/plans/{id}/toggle:
 *   post:
 *     summary: Activate/deactivate a membership plan (console)
 *     tags: [Admin - Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Plan status updated
 *       404:
 *         description: Plan not found
 *       403:
 *         description: Admin privileges required
 */
router.post("/plans/:id/toggle", protectedRoute, requireAdmin, adminPlans.toggle.bind(adminPlans));

/**
 * @swagger
 * /admin/plans/{id}:
 *   delete:
 *     summary: Delete a membership plan (console)
 *     tags: [Admin - Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Plan deleted
 *       404:
 *         description: Plan not found
 *       403:
 *         description: Admin privileges required
 */
router.delete("/plans/:id", protectedRoute, requireAdmin, adminPlans.remove.bind(adminPlans));

// ─────────────────────────────────────────
// Complimentary access grants (comped membership)
// ─────────────────────────────────────────
// Lets an admin give a named user access to a paid tier without a payment.
// The grant is stored separately from user_subscriptions, so a comp and a real
// subscription coexist rather than overwriting one another, and revoking a comp
// is distinct from a user cancelling. Grants are soft-revoked, never deleted.

/**
 * @swagger
 * /admin/access-grants:
 *   get:
 *     summary: List complimentary access grants (console)
 *     description: >
 *       Lists admin-issued comps. Filter with `status=active|revoked|expired`,
 *       or narrow by `userId` / `tierCode`. `active` means not revoked, already
 *       started, and not past endDate.
 *     tags: [Admin - Access Grants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *       - in: query
 *         name: tierCode
 *         schema:
 *           type: string
 *           enum: [FREE, BASELINE, SENIOR_PIONEER, SANKOFA_SETTLED, BASIC, SILVER, GOLD_INVESTOR, ELITE_AMBASSADOR, FAMILY_PLAN]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, revoked, expired]
 *     responses:
 *       200:
 *         description: Access grants listed
 *       403:
 *         description: Admin privileges required
 */
router.get(
  "/access-grants",
  protectedRoute,
  requireAdmin,
  adminAccessGrants.list.bind(adminAccessGrants),
);

/**
 * @swagger
 * /admin/access-grants:
 *   post:
 *     summary: Comp a user into a paid tier (console)
 *     description: >
 *       Grants a user access to a paid tier without a payment, recording who
 *       approved it and why. Omit `endDate` for a perpetual comp; grants never
 *       auto-renew. Set `includePaidPerks` to true only when the comp should also
 *       confer ranking perks (matching boost, priority support) — leave it false
 *       to waive the fee while keeping the user equivalent to FREE, so comped
 *       users never outrank paying members. Rejected if the user already has an
 *       in-force grant for the same tier.
 *     tags: [Admin - Access Grants]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, tierCode, reason]
 *             properties:
 *               userId: { type: string }
 *               tierCode:
 *                 type: string
 *                 enum: [BASELINE, SENIOR_PIONEER, SANKOFA_SETTLED, BASIC, SILVER, GOLD_INVESTOR, ELITE_AMBASSADOR, FAMILY_PLAN]
 *               includePaidPerks:
 *                 type: boolean
 *                 default: false
 *                 description: Confer matching boost and priority support, not just content access.
 *               reason:
 *                 type: string
 *                 description: Why this comp exists. Kept in the audit trail.
 *               startDate:
 *                 type: string
 *                 format: date-time
 *                 description: Defaults to now. Useful for a comp that starts later.
 *               endDate:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *                 description: Omit or null for a perpetual comp.
 *     responses:
 *       201:
 *         description: Access granted
 *       400:
 *         description: Invalid payload
 *       404:
 *         description: User not found
 *       409:
 *         description: An active grant for this tier already exists
 *       403:
 *         description: Admin privileges required
 */
router.post(
  "/access-grants",
  protectedRoute,
  requireAdmin,
  validate(createAccessGrantSchema),
  adminAccessGrants.create.bind(adminAccessGrants),
);

/**
 * @swagger
 * /admin/access-grants/{id}:
 *   patch:
 *     summary: Amend an access grant (console)
 *     description: >
 *       Updates tier, perks flag, reason, or dates. Setting `endDate` to a past
 *       date is an early revoke that preserves the grant record. Revoked grants
 *       cannot be modified.
 *     tags: [Admin - Access Grants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tierCode:
 *                 type: string
 *                 enum: [BASELINE, SENIOR_PIONEER, SANKOFA_SETTLED, BASIC, SILVER, GOLD_INVESTOR, ELITE_AMBASSADOR, FAMILY_PLAN]
 *               includePaidPerks: { type: boolean }
 *               reason: { type: string }
 *               startDate: { type: string, format: date-time }
 *               endDate: { type: string, format: date-time, nullable: true }
 *     responses:
 *       200:
 *         description: Grant updated
 *       400:
 *         description: Invalid payload or date range
 *       404:
 *         description: Grant not found
 *       409:
 *         description: Grant already revoked
 *       403:
 *         description: Admin privileges required
 */
router.patch(
  "/access-grants/:id",
  protectedRoute,
  requireAdmin,
  validate(updateAccessGrantSchema),
  adminAccessGrants.update.bind(adminAccessGrants),
);

/**
 * @swagger
 * /admin/access-grants/{id}/revoke:
 *   post:
 *     summary: Revoke an access grant (console)
 *     description: >
 *       Soft revoke. The grant row is retained so the decision stays explainable
 *       in the audit trail; the user's access is withdrawn immediately.
 *     tags: [Admin - Access Grants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Optional note recorded against the revocation.
 *     responses:
 *       200:
 *         description: Grant revoked
 *       404:
 *         description: Grant not found
 *       409:
 *         description: Grant already revoked
 *       403:
 *         description: Admin privileges required
 */
router.post(
  "/access-grants/:id/revoke",
  protectedRoute,
  requireAdmin,
  validate(revokeAccessGrantSchema),
  adminAccessGrants.revoke.bind(adminAccessGrants),
);

/**
 * @swagger
 * /admin/users/{userId}/access:
 *   get:
 *     summary: A user's effective access and grant history (console)
 *     description: >
 *       Shows the access the user actually has right now, which record produced
 *       it, and their full grant history — the answer to "why does this person
 *       have access?" without inferring intent from tier codes.
 *     tags: [Admin - Access Grants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Effective access with grant history
 *       404:
 *         description: User not found
 *       403:
 *         description: Admin privileges required
 */
router.get(
  "/users/:userId/access",
  protectedRoute,
  requireAdmin,
  adminAccessGrants.userAccess.bind(adminAccessGrants),
);

export { router };
