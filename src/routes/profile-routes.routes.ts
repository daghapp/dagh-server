import express from "express";
const router = express.Router();
import { validate } from "../middleware/validation.js";
import protectedRoute from "../middleware/protected.js";
// import { profileSchema, updateProfileSchema } from "../validator/index.js";

// import { ProfileController } from "../Modules/profile-managemnt/profile.controller.js";
import { ProfilePhoneVerificationController } from "../Modules/profile-managemnt/profile.phone-verification.controller.js";
import {
  sendPhoneOtpSchema,
  verifyPhoneOtpSchema,
} from "../validator/profile-phone-verification-validator.js";

// const profileController = new ProfileController();
const profilePhoneVerificationController = new ProfilePhoneVerificationController();
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
  profilePhoneVerificationController.sendOtpForPhone.bind(
    profilePhoneVerificationController,
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
  profilePhoneVerificationController.verifyOtpForPhone.bind(
    profilePhoneVerificationController,
  ),
);

export  {router};

