import express from "express";
import protectedRoute from "../middleware/protected.js";
import { validate } from "../middleware/validation.js";
import { ProfileVerificationController } from "../modules/profile-management/profile.verification.controller.js";
import {
  sendPhoneOtpSchema,
  verifyPhoneOtpSchema,
} from "../validator/profile-phone-verification-validator.js";
import { postBioDocumentSchema } from "../validator/profile-bio-document-validator.js";
import { postBioProfileUrl } from "../modules/profile-management/profile.bio-url.controller.js";
import { postBioDocument } from "../modules/profile-management/profile-bio-document.controller.js";
import { initProfile } from "../modules/profile-management/profile.init.controller.js";
import {
  getVerificationStatus,
  getValidationStepStatus,
} from "../modules/profile-management/profile.validation-step.controller.js";
import rateLimit from "express-rate-limit";

const router = express.Router();

const otpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: { code: "OTP_RATE_LIMITED", message: "Too many attempts" } },
  standardHeaders: true,
  legacyHeaders: false,
});

const profileVerificationController = new ProfileVerificationController();

/**
 * @swagger
 * tags:
 *   name: Verification
 *   description: Verification endpoints
 */

/**
 * @swagger
 * /verification/phone/send-otp:
 *   post:
 *     summary: Send OTP to the authenticated user's email
 *     description: |
 *       Sends a 6-digit OTP code to the user's registered email address.
 *       The code expires in 10 minutes. Resending invalidates all previous active codes.
 *       The phone number is normalized and stored on the user's profile for verification records.
 *     tags: [Verification]
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
 *                 description: Optional phone number to store on the profile (E.164 or digits). If omitted, uses phone already on the profile.
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     challengeId:
 *                       type: string
 *                       format: uuid
 *                       description: Unique challenge ID required for verification
 *                     phoneNumber:
 *                       type: string
 *                       description: Normalized phone number
 *                     expiresAt:
 *                       type: string
 *                       format: date-time
 *                     resendAvailableAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Phone number missing or invalid
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Too many OTP requests
 */
router.post(
  "/phone/send-otp",
  otpRateLimiter,
  protectedRoute,
  validate(sendPhoneOtpSchema),
  profileVerificationController.sendPhoneOtpForVerification.bind(profileVerificationController),
);

/**
 * @swagger
 * /verification/phone/verify-otp:
 *   post:
 *     summary: Verify OTP code
 *     tags: [Verification]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [challengeId, code]
 *             properties:
 *               challengeId:
 *                 type: string
 *                 format: uuid
 *                 description: Challenge ID from send-otp response
 *               code:
 *                 type: string
 *                 description: 6-digit OTP code
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: Phone number verified successfully
 *       400:
 *         description: Invalid or expired OTP
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: object
 *                   properties:
 *                     code:
 *                       type: string
 *                       enum: [OTP_INVALID, OTP_EXPIRED]
 *                     message:
 *                       type: string
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Challenge not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: object
 *                   properties:
 *                     code:
 *                       type: string
 *                       enum: [OTP_CHALLENGE_NOT_FOUND]
 *                     message:
 *                       type: string
 *       409:
 *         description: Phone already verified
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: object
 *                   properties:
 *                     code:
 *                       type: string
 *                       enum: [PHONE_ALREADY_VERIFIED]
 *                     message:
 *                       type: string
 *       429:
 *         description: Too many OTP attempts
 */
router.post(
  "/phone/verify-otp",
  otpRateLimiter,
  protectedRoute,
  validate(verifyPhoneOtpSchema),
  profileVerificationController.verifyPhoneOtpForVerification.bind(profileVerificationController),
);

/**
 * @swagger
 * /verification/status:
 *   get:
 *     summary: Get the full verification status for the authenticated user
 *     tags: [Verification]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Verification status for every step (phone, profile image, documents)
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
 *                     verificationProfileExists:
 *                       type: boolean
 *                       description: Whether a UserProfile record exists (required for verification)
 *                     datingProfileExists:
 *                       type: boolean
 *                       description: Whether a DatingProfile exists (separate from verification)
 *                     isVerified:
 *                       type: boolean
 *                       description: True only when ALL required steps are verified
 *                     currentStep:
 *                       type: string
 *                       enum: [PHONE_NUMBER_VERIFICATION, PROFILE_IMAGE_VERIFICATION, DOCUMENT_VERIFICATION]
 *                     verificationMessage:
 *                       type: string
 *                       nullable: true
 *                     steps:
 *                       type: object
 *                       description: Status per step
 *                       additionalProperties:
 *                         type: object
 *                         properties:
 *                           status:
 *                             type: string
 *                             enum: [PENDING, VERIFIED, REJECTED]
 *                           verificationMessage:
 *                             type: string
 *                             nullable: true
 *                     completedSteps:
 *                       type: array
 *                       items:
 *                         type: string
 *       401:
 *         description: Unauthorized
 */
router.get("/status", protectedRoute, getVerificationStatus);

/**
 * @swagger
 * /verification/bio_profile_url:
 *   post:
 *     summary: Post user's bio profile image URL
 *     tags: [Verification]
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

/**
 * @swagger
 * /verification/bio_document_urls:
 *   post:
 *     summary: Post user's bio document URLs and type
 *     tags: [Verification]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bio_document_urls]
 *             properties:
 *               bio_document_urls:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uri
 *               bio_document_type:
 *                 type: string
 *                 enum: [PASSPORT, GHANA_CARD]
 *                 nullable: true
 *                 description: Type of bio document (optional)
 *               bio_document_number:
 *                 type: string
 *                 description: Unique ID number printed on the card (Ghana Card or passport number). Must be globally unique — the same number cannot verify a second account.
 *     responses:
 *       200:
 *         description: Bio documents updated successfully
 *       400:
 *         description: Invalid payload
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: Document number already used to verify another account
 */
router.post("/bio_document_urls", protectedRoute, validate(postBioDocumentSchema), postBioDocument);

/**
 * @swagger
 * /verification/init:
 *   post:
 *     summary: Initialize user profile for verification flow
 *     tags: [Verification]
 *     security:

 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile initialized (or already existed)
 *       401:
 *         description: Unauthorized
 */
router.post("/init", protectedRoute, async (req, res) => initProfile(req, res));

/**
 * @swagger
 * /verification/validation-step/status:
 *   get:
 *     summary: Get the current validation step status
 *     tags: [Verification]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: step
 *         schema:
 *           type: string
 *           enum: [PHONE_NUMBER_VERIFICATION, PROFILE_IMAGE_VERIFICATION, DOCUMENT_VERIFICATION]
 *         description: Optional specific step to query. If omitted, returns the inferred current step.
 *     responses:
 *       200:
 *         description: Current validation step retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     current_step:
 *                       type: string
 *                       enum: [PHONE_NUMBER_VERIFICATION, PROFILE_IMAGE_VERIFICATION, DOCUMENT_VERIFICATION]
 *                     status:
 *                       type: string
 *                       enum: [PENDING, VERIFIED, REJECTED]
 *                     verification_message:
 *                       type: string
 *                       nullable: true
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Profile not found
 */
router.get("/validation-step/status", protectedRoute, getValidationStepStatus);

export { router };
