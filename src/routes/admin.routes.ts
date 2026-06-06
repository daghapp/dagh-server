import express from "express";
import { AuthAdminController } from "../Modules/authentication/auth-admin.controller.js";
import protectedRoute from "../middleware/protected.js";
import { AdminVisaController } from "../Modules/visa-management/admin-visa.controller.js";

const router = express.Router();
const authAdminController = new AuthAdminController();
const adminVisaController = new AdminVisaController();


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
  authAdminController.suspendUser.bind(authAdminController),
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
  authAdminController.reactivateUser.bind(authAdminController),
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
  authAdminController.deleteUser.bind(authAdminController),
);

/**
 * @swagger
 * /admin/visa-requests/paid:
 *   get:
 *     summary: Get paid visa requests ready for admin processing
 *     tags: [Admin - Visa]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of paid visa requests
 */
router.get(
  "/visa-requests/paid",
  protectedRoute,
  adminVisaController.getPaidVisaRequests.bind(adminVisaController),
);

/**
 * @swagger
 * /admin/visa-requests/approve:
 *   post:
 *     summary: Approve a visa request
 *     tags: [Admin - Visa]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               requestId:
 *                 type: string
 *                 format: uuid
 *             required: [requestId]
 *     responses:
 *       200:
 *         description: Visa request approved
 */
router.post(
  "/visa-requests/approve",
  protectedRoute,
  adminVisaController.approveVisaRequest.bind(adminVisaController),
);

export { router };

