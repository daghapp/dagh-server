import express from "express";
const router = express.Router();
import { validate } from "../middleware/validation.js";
import protectedRoute from "../middleware/protected.js";
// import { profileSchema, updateProfileSchema } from "../validator/index.js";

import { ProfileVerificationController } from "../Modules/profile-managemnt/profile.verification.controller.js";
import { initProfile } from "../Modules/profile-managemnt/profile.init.controller.js";

import {
  sendPhoneOtpSchema,
  verifyPhoneOtpSchema,
} from "../validator/profile-phone-verification-validator.js";



const profileVerificationController = new ProfileVerificationController();



/**
 * @swagger
 * /profile/phone/send-otp:
 *   post:
 *     summary: Send OTP to user's phone number
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: Optional override (if omitted, uses phone from profile)
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *       400:
 *         description: Phone number missing
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/phone/send-otp",
  protectedRoute,
  validate(sendPhoneOtpSchema),
  profileVerificationController.sendPhoneOtpForVerification.bind(
    profileVerificationController,
  ),
);


/**
 * @swagger
 * /profile/phone/verify-otp:
 *   post:
 *     summary: Verify OTP code
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: Optional override (if omitted, uses phone from profile)
 *               code:
 *                 type: string
 *                 description: 6-digit OTP code
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: Phone number verified successfully
 *       400:
 *         description: Invalid OTP or phone number missing
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/phone/verify-otp",
  protectedRoute,
  validate(verifyPhoneOtpSchema),
  profileVerificationController.verifyPhoneOtpForVerification.bind(
    profileVerificationController,
  ),
);

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

