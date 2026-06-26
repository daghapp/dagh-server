import express from "express";
const router = express.Router();
import { validate } from "../middleware/validation.js";
import protectedRoute from "../middleware/protected.js";
import { profileSchema, updateProfileSchema } from "../validator/index.js";

import { ProfileController } from "../Modules/profile-managemnt/profile.controller.js";
import { ProfilePhoneVerificationController } from "../Modules/profile-managemnt/profile.phone-verification.controller.js";
import {
  sendPhoneOtpSchema,
  verifyPhoneOtpSchema,
} from "../validator/profile-phone-verification-validator.js";

const profileController = new ProfileController();
const profilePhoneVerificationController = new ProfilePhoneVerificationController();


/**
 * @swagger
 * /profile/create:
 *   post:
 *     summary: Create or update a user profile
 *     description: Creates a new user profile or updates existing one for the authenticated user
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *                 format: uuid
 *                 description: Unique identifier for the user
 *                 example: 123e4567-e89b-12d3-a456-426614174000
 *               username:
 *                 type: string
 *                 minLength: 3
 *                 description: Username for the profile
 *                 example: johndoe123
 *               firstName:
 *                 type: string
 *                 minLength: 2
 *                 description: User's first name
 *                 example: John
 *               lastName:
 *                 type: string
 *                 minLength: 2
 *                 description: User's last name
 *                 example: Doe
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *                 description: User's date of birth
 *                 example: 1990-01-15
 *               gender:
 *                 type: string
 *                 enum: [MALE, FEMALE, OTHER]
 *                 description: User's gender
 *                 example: MALE
 *               nationality:
 *                 type: string
 *                 minLength: 2
 *                 description: User's nationality
 *                 example: American
 *               residenceCountry:
 *                 type: string
 *                 minLength: 2
 *                 description: Country of residence
 *                 example: United States
 *               residenceCity:
 *                 type: string
 *                 minLength: 2
 *                 description: City of residence
 *                 example: New York
 *               residenceState:
 *                 type: string
 *                 minLength: 2
 *                 description: State/Province of residence
 *                 example: NY
 *               profilePhotoUrl:
 *                 type: string
 *                 format: uri
 *                 description: URL to profile photo
 *                 example: https://example.com/photos/profile.jpg
 *               profilePhotoUploadedAt:
 *                 type: string
 *                 format: date-time
 *                 description: Timestamp when profile photo was uploaded
 *                 example: 2026-03-04T10:00:00Z
 *               bio:
 *                 type: string
 *                 maxLength: 500
 *                 description: User's biography (max 500 characters)
 *                 example: Travel enthusiast and adventure seeker
 *               languages:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: List of languages spoken by the user
 *                 example: ["English", "Spanish"]
 *     responses:
 *       200:
 *         description: Profile created or updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Profile created successfully
 *                 profile:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     userId:
 *                       type: string
 *                       format: uuid
 *                     username:
 *                       type: string
 *                     firstName:
 *                       type: string
 *                     lastName:
 *                       type: string
 *                     dateOfBirth:
 *                       type: string
 *                       format: date
 *                     gender:
 *                       type: string
 *                       enum: [MALE, FEMALE, OTHER]
 *                     nationality:
 *                       type: string
 *                     residenceCountry:
 *                       type: string
 *                     residenceCity:
 *                       type: string
 *                     residenceState:
 *                       type: string
 *                     profilePhotoUrl:
 *                       type: string
 *                       format: uri
 *                     profilePhotoUploadedAt:
 *                       type: string
 *                       format: date-time
 *                     bio:
 *                       type: string
 *                     languages:
 *                       type: array
 *                       items:
 *                         type: string
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 */
router.post(
  "/create",
  protectedRoute,
  validate(profileSchema),
  profileController.createOrUpdateProfile.bind(profileController),
);



/**
 * @swagger
 * /profile/update:
 *   put:
 *     summary: Update user profile
 *     description: Updates the profile information for the authenticated user
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
 *                 description: Username for the profile
 *                 example: johndoe123
 *               firstName:
 *                 type: string
 *                 minLength: 2
 *                 description: User's first name
 *                 example: John
 *               lastName:
 *                 type: string
 *                 minLength: 2
 *                 description: User's last name
 *                 example: Doe
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *                 description: User's date of birth
 *                 example: 1990-01-15
 *               gender:
 *                 type: string
 *                 enum: [MALE, FEMALE, OTHER]
 *                 description: User's gender
 *                 example: MALE
 *               nationality:
 *                 type: string
 *                 minLength: 2
 *                 description: User's nationality
 *                 example: American
 *               residenceCountry:
 *                 type: string
 *                 minLength: 2
 *                 description: Country of residence
 *                 example: United States
 *               residenceCity:
 *                 type: string
 *                 minLength: 2
 *                 description: City of residence
 *                 example: New York
 *               residenceState:
 *                 type: string
 *                 minLength: 2
 *                 description: State/Province of residence
 *                 example: NY
 *               profilePhotoUrl:
 *                 type: string
 *                 format: uri
 *                 description: URL to profile photo
 *                 example: https://example.com/photos/profile.jpg
 *               bio:
 *                 type: string
 *                 maxLength: 500
 *                 description: User's biography (max 500 characters)
 *                 example: Travel enthusiast and adventure seeker
 *               languages:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: List of languages spoken by the user
 *                 example: ["English", "Spanish"]
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Profile updated successfully
 *                 profile:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     userId:
 *                       type: string
 *                       format: uuid
 *                     username:
 *                       type: string
 *                     firstName:
 *                       type: string
 *                     lastName:
 *                       type: string
 *                     dateOfBirth:
 *                       type: string
 *                       format: date
 *                     gender:
 *                       type: string
 *                       enum: [MALE, FEMALE, OTHER]
 *                     nationality:
 *                       type: string
 *                     residenceCountry:
 *                       type: string
 *                     residenceCity:
 *                       type: string
 *                     residenceState:
 *                       type: string
 *                     profilePhotoUrl:
 *                       type: string
 *                       format: uri
 *                     bio:
 *                       type: string
 *                     languages:
 *                       type: array
 *                       items:
 *                         type: string
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Profile not found
 */
router.put(
  "/update",
  protectedRoute,
  validate(updateProfileSchema),
  profileController.updateProfile.bind(profileController),
);


/**
 * @swagger
 * /profile/delete:
 *   delete:
 *     summary: Delete user profile
 *     description: Deletes the profile of the authenticated user
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Profile deleted successfully
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Profile not found
 */
router.delete(
  "/delete",
  protectedRoute,
  profileController.deleteProfile.bind(profileController),
);


/**
 * @swagger
 * /profile/me:
 *   get:
 *     summary: Get authenticated user's profile
 *     description: Retrieves the profile information for the currently authenticated user
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 profile:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     userId:
 *                       type: string
 *                       format: uuid
 *                     username:
 *                       type: string
 *                     firstName:
 *                       type: string
 *                     lastName:
 *                       type: string
 *                     dateOfBirth:
 *                       type: string
 *                       format: date
 *                     gender:
 *                       type: string
 *                       enum: [MALE, FEMALE, OTHER]
 *                     nationality:
 *                       type: string
 *                     residenceCountry:
 *                       type: string
 *                     residenceCity:
 *                       type: string
 *                     residenceState:
 *                       type: string
 *                     profilePhotoUrl:
 *                       type: string
 *                     profilePhotoUploadedAt:
 *                       type: string
 *                       format: date-time
 *                     bio:
 *                       type: string
 *                     languages:
 *                       type: array
 *                       items:
 *                         type: string
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Profile not found
 */
router.get(
  "/me",
  protectedRoute,
  profileController.getProfile.bind(profileController),
);


/**
 * @swagger
 * /profile/{userId}:
 *   get:
 *     summary: Get user profile by user ID
 *     description: Retrieves the profile information for a specific user
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The unique identifier of the user
 *         example: 123e4567-e89b-12d3-a456-426614174000
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 profile:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     userId:
 *                       type: string
 *                       format: uuid
 *                     username:
 *                       type: string
 *                     firstName:
 *                       type: string
 *                     lastName:
 *                       type: string
 *                     dateOfBirth:
 *                       type: string
 *                       format: date
 *                     gender:
 *                       type: string
 *                       enum: [MALE, FEMALE, OTHER]
 *                     nationality:
 *                       type: string
 *                     residenceCountry:
 *                       type: string
 *                     residenceCity:
 *                       type: string
 *                     residenceState:
 *                       type: string
 *                     profilePhotoUrl:
 *                       type: string
 *                     profilePhotoUploadedAt:
 *                       type: string
 *                       format: date-time
 *                     bio:
 *                       type: string
 *                     languages:
 *                       type: array
 *                       items:
 *                         type: string
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Profile not found
 */
router.get(
  "/:userId",
  protectedRoute,
  profileController.getProfileByUserId.bind(profileController),
);

/**
 * @swagger
 * tags:
 *   name: ProfilePhoneVerification
 *   description: OTP phone verification for profile
 */

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

