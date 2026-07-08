import express from "express";
import protectedRoute from "../middleware/protected.js";
import requireAdmin from "../middleware/admin.js";
import { AdminProfileController } from "../Modules/profile-management/admin-profile.controller.js";

const router = express.Router();
const adminProfileController = new AdminProfileController();

/**
 * @swagger
 * /admin/profile-verifications:
 *   get:
 *     summary: Get all profile verification requests
 *     description: Retrieve all user profile verification requests with approval status for each section
 *     tags: [Admin - Profile Verification]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of profile verification requests
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
 *                       isVerified:
 *                         type: boolean
 *                       bioData:
 *                         type: object
 *                         properties:
 *                           status:
 *                             type: string
 *                             enum: [PENDING, APPROVED, REJECTED]
 *                       faceVerification:
 *                         type: object
 *                         properties:
 *                           status:
 *                             type: string
 *                             enum: [PENDING, APPROVED, REJECTED]
 *                       documents:
 *                         type: object
 *                         properties:
 *                           status:
 *                             type: string
 *                             enum: [PENDING, APPROVED, REJECTED]
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
 *       500:
 *         description: Server error
 */
router.get(
  "/profile-verifications",
  protectedRoute,
  requireAdmin,
  adminProfileController.getAllVerifications.bind(adminProfileController),
);

/**
 * @swagger
 * /admin/profile-verifications/{id}/bio-data:
 *   patch:
 *     summary: Approve or reject bio data section
 *     tags: [Admin - Profile Verification]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Profile verification ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [APPROVED, REJECTED]
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Bio data status updated
 *       400:
 *         description: Invalid action
 *       404:
 *         description: Verification not found
 */
router.patch(
  "/profile-verifications/:id/bio-data",
  protectedRoute,
  requireAdmin,
  adminProfileController.updateBioDataStatus.bind(adminProfileController),
);

/**
 * @swagger
 * /admin/profile-verifications/{id}/face:
 *   patch:
 *     summary: Approve or reject face verification section
 *     tags: [Admin - Profile Verification]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Profile verification ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [APPROVED, REJECTED]
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Face verification status updated
 *       400:
 *         description: Invalid action
 *       404:
 *         description: Verification not found
 */
router.patch(
  "/profile-verifications/:id/face",
  protectedRoute,
  requireAdmin,
  adminProfileController.updateFaceStatus.bind(adminProfileController),
);

/**
 * @swagger
 * /admin/profile-verifications/{id}/documents:
 *   patch:
 *     summary: Approve or reject documents section (Passport/Ghana Card)
 *     tags: [Admin - Profile Verification]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Profile verification ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [APPROVED, REJECTED]
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Document status updated
 *       400:
 *         description: Invalid action
 *       404:
 *         description: Verification not found
 */
router.patch(
  "/profile-verifications/:id/documents",
  protectedRoute,
  requireAdmin,
  adminProfileController.updateDocumentStatus.bind(adminProfileController),
);

/**
 * @swagger
 * /admin/profile-verifications/{id}/verify:
 *   post:
 *     summary: Fully verify a user (approve all sections at once)
 *     tags: [Admin - Profile Verification]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Profile verification ID
 *     responses:
 *       200:
 *         description: User fully verified
 *       404:
 *         description: Verification not found
 */
router.post(
  "/profile-verifications/:id/verify",
  protectedRoute,
  requireAdmin,
  adminProfileController.verifyUserFully.bind(adminProfileController),
);

export { router };
