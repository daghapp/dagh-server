import express from "express";
import protectedRoute from "../middleware/protected.js";
import { getValidationStepStatus } from "../Modules/profile-managemnt/profile.validation-step.controller.js";

const router = express.Router();

/**
 * @swagger
 * /profile/validation-step/status:
 *   get:
 *     summary: Get validation status for a validation step (or the current step)
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: step
 *         required: false
 *         schema:
 *           type: string
 *           enum: [phonenumber_verification, profile_image_validation, document_verification]
 *         description: Validation step to query. If omitted, returns the inferred current step.
 *     responses:
 *       200:
 *         description: Validation step status retrieved
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Profile not found
 */
router.get(
  "/validation-step/status",
  protectedRoute,
  getValidationStepStatus,
);

export { router };

