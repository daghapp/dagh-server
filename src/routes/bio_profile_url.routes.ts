import express from "express";
import protectedRoute from "../middleware/protected.js";
import { postBioProfileUrl } from "../Modules/profile-management/profile.bio-url.controller.js";

const router = express.Router();

/**
 * @swagger
 * /profile/bio_profile_url:
 *   post:
 *     summary: Post user's bio profile image URL
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bio_profile_url]
 *             properties:
 *               bio_profile_url:
 *                 type: string
 *                 description: URL for the bio/profile image
 *     responses:
 *       200:
 *         description: Bio profile URL updated successfully
 *       400:
 *         description: bio_profile_url missing
 *       401:
 *         description: Unauthorized
 */
router.post("/bio_profile_url", protectedRoute, postBioProfileUrl);


export { router };

