import express from "express";
import protectedRoute from "../middleware/protected.js";
import { getValidationStepStatus } from "../modules/profile-management/profile.validation-step.controller.js";

const router = express.Router();

/**
 * @swagger
 * /verification/validation-step/status:
 *   get:
 *     summary: Get validation status for a validation step (or the current step)
 *     tags: [Verification]


 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: step
 *         required: false
 *         schema:
 *           type: string
 *           enum: [PHONE_NUMBER_VERIFICATION, PROFILE_IMAGE_VERIFICATION, DOCUMENT_VERIFICATION]
 *         description: Validation step to query. If omitted, returns the inferred current step.
 *     responses:
 *       200:
 *         description: Validation step status retrieved
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
 *                     current_step:
 *                       type: string
 *                       enum: [PHONE_NUMBER_VERIFICATION, PROFILE_IMAGE_VERIFICATION, DOCUMENT_VERIFICATION]
 *                     status:
 *                       type: string
 *                       enum: [PENDING, VERIFIED, REJECTED]
 *                       description: PENDING while under review, VERIFIED when approved, REJECTED when an admin rejected the step
 *                     verification_message:
 *                       type: string
 *                       nullable: true
 *                       description: Present when status is REJECTED, containing the admin's rejection reason
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Profile not found
 */
router.get("/validation-step/status", protectedRoute, getValidationStepStatus);

export { router };
