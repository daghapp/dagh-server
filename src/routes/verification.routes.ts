import express from "express";
import protectedRoute from "../middleware/protected.js";
import { validate } from "../middleware/validation.js";
import { ProfileVerificationController } from "../Modules/profile-managemnt/profile.verification.controller.js";
import {
  sendPhoneOtpSchema,
  verifyPhoneOtpSchema,
} from "../validator/profile-phone-verification-validator.js";
import { postBioDocumentSchema } from "../validator/profile-bio-document-validator.js";
import { postBioProfileUrl } from "../Modules/profile-managemnt/profile.bio-url.controller.js";
import { postBioDocument } from "../Modules/profile-managemnt/profile-bio-document.controller.js";
import { initProfile } from "../Modules/profile-managemnt/profile.init.controller.js";

const router = express.Router();


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
 *     summary: Send OTP to user's phone number
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
router.post(
  "/bio_profile_url",
  protectedRoute,
  postBioProfileUrl,
);

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
 *     responses:
 *       200:
 *         description: Bio documents updated successfully
 *       400:
 *         description: Invalid payload
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/bio_document_urls",
  protectedRoute,
  validate(postBioDocumentSchema),
  postBioDocument,
);

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
router.post(
  "/init",
  protectedRoute,
  async (req, res) => initProfile(req, res),
);


export { router };

