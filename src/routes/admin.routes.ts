import express, { NextFunction, Request, Response } from "express";
import { AuthAdminController } from "../modules/authentication/auth-admin.controller.js";
import protectedRoute from "../middleware/protected.js";
import { requirePermission, PERMISSIONS } from "../middleware/permissions.js";
import {
  listReports,
  resolveReport,
  suspendReportedUser,
} from "../modules/dating/admin-moderation.controller.js";

const router = express.Router();
const authAdminController = new AuthAdminController();

/**
 * @swagger
 * /admin/users:
 *   get:
 *     summary: Get all users
 *     description: Retrieve a list of all users in the system (admin only)
 *     tags: [Admin - User Management]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully retrieved all users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                         example: 123e4567-e89b-12d3-a456-426614174000
 *                       fullName:
 *                         type: string
 *                         example: John Doe
 *                       email:
 *                         type: string
 *                         format: email
 *                         example: john@example.com
 *                       phoneNumber:
 *                         type: string
 *                         example: +1234567890
 *                       accountType:
 *                         type: string
 *                         enum: [USER, ADMIN]
 *                         example: USER
 *                       accountStatus:
 *                         type: string
 *                         enum: [ACTIVE, SUSPENDED, DELETED]
 *                         example: ACTIVE
 *                       authProvider:
 *                         type: string
 *                         enum: [LOCAL, GOOGLE, FACEBOOK]
 *                         example: LOCAL
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                         example: 2026-01-15T10:00:00Z
 *                       lastLoginAt:
 *                         type: string
 *                         format: date-time
 *                         example: 2026-03-09T08:30:00Z
 *       403:
 *         description: Access denied - Admin privileges required
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Access denied
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Failed to fetch users
 *                 error:
 *                   type: string
 */
router.get(
  "/users",
  protectedRoute,
  requirePermission(PERMISSIONS.USERS.VIEW),
  authAdminController.getAllUsers.bind(authAdminController),
);

/**
 * @swagger
 * /admin/users/{userId}/promote:
 *   patch:
 *     summary: Promote user to admin
 *     description: Promote a regular user to admin role (admin only)
 *     tags: [Admin - User Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the user to promote
 *         example: 123e4567-e89b-12d3-a456-426614174000
 *     responses:
 *       200:
 *         description: User successfully promoted to admin
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: User promoted to admin
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     fullName:
 *                       type: string
 *                       example: John Doe
 *                     email:
 *                       type: string
 *                       format: email
 *                       example: john@example.com
 *                     accountType:
 *                       type: string
 *                       example: ADMIN
 *       400:
 *         description: User is already an admin
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: User is already an admin
 *       403:
 *         description: Access denied - Admin privileges required
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.patch(
  "/users/:userId/promote",
  protectedRoute,
  requirePermission(PERMISSIONS.USERS.EDIT),
  authAdminController.promoteToAdmin.bind(authAdminController),
);

/**
 * @swagger
 * /admin/users/{userId}/demote:
 *   patch:
 *     summary: Demote admin to user
 *     description: Demote an admin user back to regular user role (admin only)
 *     tags: [Admin - User Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the admin to demote
 *         example: 123e4567-e89b-12d3-a456-426614174000
 *     responses:
 *       200:
 *         description: Admin successfully demoted to user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Admin demoted to user
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     fullName:
 *                       type: string
 *                       example: John Doe
 *                     email:
 *                       type: string
 *                       format: email
 *                       example: john@example.com
 *                     accountType:
 *                       type: string
 *                       example: USER
 *       400:
 *         description: User is already a regular user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: User is already a regular user
 *       403:
 *         description: Access denied - Admin privileges required
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.patch(
  "/users/:userId/demote",
  protectedRoute,
  requirePermission(PERMISSIONS.USERS.EDIT),
  authAdminController.demoteToUser.bind(authAdminController),
);

/**
 * @swagger
 * /admin/users/{userId}/suspend:
 *   patch:
 *     summary: Suspend user account
 *     description: Suspend a user's account (admin only)
 *     tags: [Admin - User Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the user to suspend
 *         example: 123e4567-e89b-12d3-a456-426614174000
 *     responses:
 *       200:
 *         description: User successfully suspended
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: User suspended successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     fullName:
 *                       type: string
 *                       example: John Doe
 *                     email:
 *                       type: string
 *                       format: email
 *                       example: john@example.com
 *                     accountStatus:
 *                       type: string
 *                       example: SUSPENDED
 *       400:
 *         description: User is already suspended
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: User is already suspended
 *       403:
 *         description: Access denied - Admin privileges required
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.patch(
  "/users/:userId/suspend",
  protectedRoute,
  requirePermission(PERMISSIONS.USERS.SUSPEND),
  authAdminController.suspendUser.bind(authAdminController),
);

/**
 * @swagger
 * /admin/users/{userId}/terminate:
 *   patch:
 *     summary: Terminate user
 *     tags: [Admin - User Management]
 *     security:
 *       - bearerAuth: []
 */
router.patch(
  "/users/:userId/terminate",
  protectedRoute,
  requirePermission(PERMISSIONS.USERS.TERMINATE),
  authAdminController.terminateUser.bind(authAdminController),
);

/**
 * @swagger
 * /admin/users/{userId}/reactivate:
 *   patch:
 *     summary: Reactivate user account
 *     description: Reactivate a suspended user account (admin only)
 *     tags: [Admin - User Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the user to reactivate
 *         example: 123e4567-e89b-12d3-a456-426614174000
 *     responses:
 *       200:
 *         description: User successfully reactivated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: User reactivated successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     fullName:
 *                       type: string
 *                       example: John Doe
 *                     email:
 *                       type: string
 *                       format: email
 *                       example: john@example.com
 *                     accountStatus:
 *                       type: string
 *                       example: ACTIVE
 *       400:
 *         description: User is already active
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: User is already active
 *       403:
 *         description: Access denied - Admin privileges required
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.patch(
  "/users/:userId/reactivate",
  protectedRoute,
  requirePermission(PERMISSIONS.USERS.EDIT),
  authAdminController.reactivateUser.bind(authAdminController),
);

/**
 * @swagger
 * /admin/users/{userId}/approve:
 *   patch:
 *     summary: Approve pending user
 *     tags: [Admin - User Management]
 *     security:
 *       - bearerAuth: []
 */
router.patch(
  "/users/:userId/approve",
  protectedRoute,
  requirePermission(PERMISSIONS.USERS.APPROVE),
  authAdminController.approveUser.bind(authAdminController),
);

/**
 * @swagger
 * /admin/users/{userId}/reject:
 *   patch:
 *     summary: Reject pending user
 *     tags: [Admin - User Management]
 *     security:
 *       - bearerAuth: []
 */
router.patch(
  "/users/:userId/reject",
  protectedRoute,
  requirePermission(PERMISSIONS.USERS.REJECT),
  authAdminController.rejectUser.bind(authAdminController),
);

/**
 * @swagger
 * /admin/users/{userId}:
 *   delete:
 *     summary: Delete user account
 *     description: Permanently delete a user account from the system (admin only)
 *     tags: [Admin - User Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the user to delete
 *         example: 123e4567-e89b-12d3-a456-426614174000
 *     responses:
 *       200:
 *         description: User successfully deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: User deleted successfully
 *       403:
 *         description: Access denied - Admin privileges required
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Access denied
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: User not found
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Failed to delete user
 */
router.delete(
  "/users/:userId",
  protectedRoute,
  requirePermission(PERMISSIONS.USERS.DELETE),
  authAdminController.deleteUser.bind(authAdminController),
);

/**
 * Reserved single-segment user paths that live on other admin routers.
 * GET /admin/users/verified is registered in admin-console.routes.ts, which is
 * mounted AFTER this router — a plain GET /users/:userId here would swallow it.
 * Fall through to the next router for those segments.
 */
const skipReservedUserIds = (req: Request, _res: Response, next: NextFunction) => {
  if (req.params.userId === "verified") return next("router");
  next();
};

/**
 * @swagger
 * /admin/users/{userId}:
 *   get:
 *     summary: Get user detail (admin)
 *     tags: [Admin - User Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User detail with verification, subscription, warnings, status history and admin profile
 *       404:
 *         description: User not found
 */
router.get(
  "/users/:userId",
  protectedRoute,
  requirePermission(PERMISSIONS.USERS.VIEW),
  skipReservedUserIds,
  authAdminController.getUserDetail.bind(authAdminController),
);

/**
 * @swagger
 * /admin/users/{userId}/role:
 *   patch:
 *     summary: Assign an admin role + department to a user
 *     tags: [Admin - User Management]
 *     security:
 *       - bearerAuth: []
 */
router.patch(
  "/users/:userId/role",
  protectedRoute,
  requirePermission(PERMISSIONS.USERS.EDIT),
  authAdminController.updateUserRole.bind(authAdminController),
);

/**
 * @swagger
 * /admin/users/{userId}/warnings:
 *   post:
 *     summary: Issue a warning to a user (max 2)
 *     tags: [Admin - User Management]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  "/users/:userId/warnings",
  protectedRoute,
  requirePermission(PERMISSIONS.USERS.WARN),
  authAdminController.createWarning.bind(authAdminController),
);

/**
 * @swagger
 * /admin/users/{userId}/warnings:
 *   get:
 *     summary: List a user's warning history
 *     tags: [Admin - User Management]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  "/users/:userId/warnings",
  protectedRoute,
  requirePermission(PERMISSIONS.USERS.VIEW),
  authAdminController.listWarnings.bind(authAdminController),
);

/**
 * @swagger
 * /admin/reports:
 *   get:
 *     summary: List user reports (moderation queue)
 *     tags: [Admin - Moderation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, REVIEWING, RESOLVED, DISMISSED, ALL]
 *           default: ALL
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
 *         description: Paginated list of reports with reporter/target details
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
 *                         format: uuid
 *                       reporter:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           fullName:
 *                             type: string
 *                           email:
 *                             type: string
 *                       target:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           fullName:
 *                             type: string
 *                           email:
 *                             type: string
 *                           accountStatus:
 *                             type: string
 *                       status:
 *                         type: string
 *                         enum: [PENDING, REVIEWING, RESOLVED, DISMISSED]
 *                       resolutionNote:
 *                         type: string
 *                         nullable: true
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *       403:
 *         description: Admin privileges required
 *       500:
 *         description: Internal server error
 */
router.get("/reports", protectedRoute, requirePermission(PERMISSIONS.REPORTS.VIEW), listReports);

/**
 * @swagger
 * /admin/reports/export:
 *   get:
 *     summary: Export the user-report queue as CSV
 *     tags: [Admin - Moderation]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  "/reports/export",
  protectedRoute,
  requirePermission(PERMISSIONS.REPORTS.EXPORT),
  authAdminController.exportReports.bind(authAdminController),
);

/**
 * @swagger
 * /admin/reports/summary:
 *   get:
 *     summary: Report counts by status
 *     tags: [Admin - Moderation]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  "/reports/summary",
  protectedRoute,
  requirePermission(PERMISSIONS.REPORTS.VIEW),
  authAdminController.reportsSummary.bind(authAdminController),
);

/**
 * @swagger
 * /admin/reports/{reportId}:
 *   patch:
 *     summary: Update a report's status (REVIEWING / RESOLVED / DISMISSED)
 *     tags: [Admin - Moderation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reportId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [REVIEWING, RESOLVED, DISMISSED]
 *               resolutionNote:
 *                 type: string
 *     responses:
 *       200:
 *         description: Report updated
 *       404:
 *         description: Report not found
 *       500:
 *         description: Internal server error
 */
router.patch(
  "/reports/:reportId",
  protectedRoute,
  requirePermission(PERMISSIONS.REPORTS.MANAGE),
  resolveReport,
);

/**
 * @swagger
 * /admin/reports/{reportId}/suspend:
 *   post:
 *     summary: Suspend the reported user and resolve the report
 *     tags: [Admin - Moderation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reportId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User suspended and report resolved
 *       404:
 *         description: Report not found
 *       500:
 *         description: Internal server error
 */
router.post(
  "/reports/:reportId/suspend",
  protectedRoute,
  requirePermission(PERMISSIONS.USERS.SUSPEND),
  suspendReportedUser,
);

export { router };
