import express from "express";
import protectedRoute from "../middleware/protected.js";
import { setUserEthnicity } from "../Modules/profile-managemnt/profile-ethnicity.controller.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Profile
 *   description: Profile update endpoints
 */

/**
 * @swagger
 * /profile/ethnicity:
 *   patch:
 *     summary: Set ethnicity for authenticated user
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ethnicity]
 *             properties:
 *               ethnicity:
 *                 type: string
 *                 enum: [AFRICAN, ASIAN, EUROPEAN, NORTH_AMERICAN, SOUTH_AMERICAN, OCEANIAN, MIDDLE_EASTERN, OTHER]
 *     responses:
 *       200:
 *         description: Ethnicity updated successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.patch("/ethnicity", protectedRoute, setUserEthnicity);

export { router };

