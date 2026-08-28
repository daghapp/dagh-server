import express from "express";
const router = express.Router();
import protectedRoute from "../middleware/protected.js";
// import { profileSchema, updateProfileSchema } from "../validator/index.js";

import { initProfile } from "../modules/profile-management/profile.init.controller.js";
import { updateOwnProfile } from "../modules/profile-management/profile.update.controller.js";
import { validate } from "../middleware/validation.js";
import { profileSettingsSchema } from "../validator/profile-settings-validator.js";

// ─────────────────────────────────────────
// POST /profile/init
// ─────────────────────────────────────────

/**
 * @swagger
 * /profile/init:
 *   post:
 *     summary: Initialize user profile
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile initialized (or already existed)
 *       401:
 *         description: Unauthorized
 */
router.post("/init", protectedRoute, async (req, res) => initProfile(req, res));

// ─────────────────────────────────────────
// PATCH /profile
// ─────────────────────────────────────────

/**
 * @swagger
 * /profile:
 *   patch:
 *     summary: Update the authenticated user's account profile (fullName, gender, dateOfBirth, ethnicity)
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullName:
 *                 type: string
 *                 minLength: 2
 *               gender:
 *                 type: string
 *                 enum: [MALE, FEMALE, OTHER]
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *               ethnicity:
 *                 type: string
 *                 enum: [African, Asian, Black_African_American, Caribbean, Caucassian_White, Hispanic_Latino, Middle_Eastern, Mixed, Native_American_Indigenous, Pacific_Islander, Other]
 *     responses:
 *       200:
 *         description: Profile updated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.patch("/", protectedRoute, validate(profileSettingsSchema), updateOwnProfile);

export { router };
