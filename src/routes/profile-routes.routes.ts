import express from "express";
const router = express.Router();
import protectedRoute from "../middleware/protected.js";
// import { profileSchema, updateProfileSchema } from "../validator/index.js";

import { initProfile } from "../modules/profile-management/profile.init.controller.js";
import { updateOwnProfile } from "../modules/profile-management/profile.update.controller.js";
import {
  getAccountProfile,
  updateAccountProfile,
} from "../modules/profile-management/account-profile.controller.js";
import { validate } from "../middleware/validation.js";
import { profileSettingsSchema } from "../validator/profile-settings-validator.js";
import { accountProfileSchema } from "../validator/account-profile-validator.js";

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

// ─────────────────────────────────────────
// Login profile — username, first/last name, profile image.
// Distinct from the dating profile. All [Auth] below means Bearer token.
// ─────────────────────────────────────────

/**
 * @swagger
 * /profile/account:
 *   get:
 *     summary: Get the authenticated user's login profile (username, names, profile image)
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current login profile
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
 *                     id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     username:
 *                       type: string
 *                       nullable: true
 *                     firstName:
 *                       type: string
 *                       nullable: true
 *                     lastName:
 *                       type: string
 *                       nullable: true
 *                     fullName:
 *                       type: string
 *                     profileImageUrl:
 *                       type: string
 *                       nullable: true
 *                     phoneNumber:
 *                       type: string
 *                       nullable: true
 *                     gender:
 *                       type: string
 *                       nullable: true
 *                     dateOfBirth:
 *                       type: string
 *                       format: date
 *                       nullable: true
 *                     authProvider:
 *                       type: string
 *                     accountStatus:
 *                       type: string
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Unauthorized
 *   patch:
 *     summary: Update the authenticated user's login profile (username, firstName, lastName, profileImageUrl)
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
 *               username:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 30
 *                 description: Lowercase letters, numbers, and underscores only
 *               firstName:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 120
 *               lastName:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 120
 *               profileImageUrl:
 *                 type: string
 *                 format: uri
 *                 nullable: true
 *                 description: URL from POST /upload (send null to remove the picture)
 *     responses:
 *       200:
 *         description: Profile updated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: Username already taken
 */
router.get("/account", protectedRoute, getAccountProfile);
router.patch("/account", protectedRoute, validate(accountProfileSchema), updateAccountProfile);

export { router };
