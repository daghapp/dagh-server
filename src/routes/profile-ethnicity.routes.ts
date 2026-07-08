import express from "express";
import protectedRoute from "../middleware/protected.js";
import { setUserEthnicity } from "../Modules/profile-management/profile-ethnicity.controller.js";

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
 *                ethnicity:
 *                  type: string
 *                  enum: [African, Asian, Black_African_American, Caribbean, Caucassian_White, Hispanic_Latino, Middle_Eastern, Mixed, Native_American_Indigenous, Pacific_Islander, Other]

 *     
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

