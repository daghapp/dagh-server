import express from "express";
import protectedRoute from "../middleware/protected.js";
import requireAdmin from "../middleware/admin.js";
import { AdminVisaConsoleController } from "../modules/admin/visa-console.controller.js";
import { AdminPaymentsConsoleController } from "../modules/admin/payments-console.controller.js";
import { AdminDashboardController } from "../modules/admin/dashboard.controller.js";
import { AdminPlansConsoleController } from "../modules/admin/plans-console.controller.js";
import { validate } from "../middleware/validation.js";
import { createMembershipPlanSchema } from "../validator/index.js";

const router = express.Router();
const adminVisa = new AdminVisaConsoleController();
const adminPayments = new AdminPaymentsConsoleController();
const adminDashboard = new AdminDashboardController();
const adminPlans = new AdminPlansConsoleController();

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

export { router };
