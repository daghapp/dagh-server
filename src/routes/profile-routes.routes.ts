import express from "express";
const router = express.Router();
import { validate } from "../middleware/validation.js";
import protectedRoute from "../middleware/protected.js";
// import { profileSchema, updateProfileSchema } from "../validator/index.js";

import { initProfile } from "../modules/profile-management/profile.init.controller.js";



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
router.post(
  "/init",
  protectedRoute,
  async (req, res) => initProfile(req, res),
);


export  {router};

