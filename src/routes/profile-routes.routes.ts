import express from "express";
const router = express.Router();
import { validate } from "../middleware/validation.js";
import protectedRoute from "src/middleware/protected.js";
import { profileSchema, updateProfileSchema } from "../validator/index.js";

import { ProfileController } from "../Modules/profile-managemnt/profile.controller.js";

const profileController = new ProfileController();

/**
 * @swagger
 * /profile:
 *   get:
 *     summary: Get authenticated user's profile
 *     description: Retrieves the profile information of the currently authenticated user
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
 *               description: User profile data
 *       401:
 *         description: Unauthorized - User not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Unauthorized access
 *       404:
 *         description: Profile not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Profile not found
 *       500:
 *         description: Failed to fetch profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Failed to fetch profile
 *                 error:
 *                   type: string
 */
router.get(
  "/profile",
  protectedRoute,
  profileController.getProfile.bind(profileController),
);

/**
 * @swagger
 * /profile:
 *   post:
 *     summary: Create a new user profile
 *     description: Creates a new profile for a user. A user can only have one profile.
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
 *                 description: Unique identifier of the user
 *                 example: user123456
 *               firstName:
 *                 type: string
 *                 description: User's first name
 *                 example: John
 *               lastName:
 *                 type: string
 *                 description: User's last name
 *                 example: Doe
 *               phoneNumber:
 *                 type: string
 *                 description: User's phone number
 *                 example: +1234567890
 *               address:
 *                 type: string
 *                 description: User's address
 *                 example: 123 Main Street, City
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *                 description: User's date of birth
 *                 example: 1990-01-15
 *     responses:
 *       201:
 *         description: Profile created successfully
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
 *                   description: Created profile data
 *       400:
 *         description: Profile already exists or invalid request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Unable to create profile for this user
 *       401:
 *         description: Unauthorized - User not authenticated
 *       500:
 *         description: Registration failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Registration failed
 *                 error:
 *                   type: string
 */
router.post(
  "/profile",
  protectedRoute,
  validate(profileSchema),
  profileController.createOrUpdateProfile.bind(profileController),
);

/**
 * @swagger
 * /profile:
 *   put:
 *     summary: Update authenticated user's profile
 *     description: Updates the profile information of the currently authenticated user
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
 *               firstName:
 *                 type: string
 *                 description: User's first name
 *                 example: John
 *               lastName:
 *                 type: string
 *                 description: User's last name
 *                 example: Doe
 *               phoneNumber:
 *                 type: string
 *                 description: User's phone number
 *                 example: +1234567890
 *               address:
 *                 type: string
 *                 description: User's address
 *                 example: 456 Oak Avenue, New City
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *                 description: User's date of birth
 *                 example: 1990-01-15
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
 *                   description: Updated profile data
 *       401:
 *         description: Unauthorized - User not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Unauthorized access
 *       500:
 *         description: Failed to update profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Failed to update profile
 *                 error:
 *                   type: string
 */
router.put(
  "/profile",
  protectedRoute,
  validate(updateProfileSchema),
  profileController.updateProfile.bind(profileController),
);

/**
 * @swagger
 * /profile:
 *   delete:
 *     summary: Delete authenticated user's profile
 *     description: Permanently deletes the profile of the currently authenticated user
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
 *         description: Unauthorized - User not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Unauthorized access
 *       500:
 *         description: Failed to delete profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Failed to delete profile
 *                 error:
 *                   type: string
 */
router.delete(
  "/profile",
  protectedRoute,
  profileController.deleteProfile.bind(profileController),
);

/**
 * @swagger
 * /profile/{userId}:
 *   get:
 *     summary: Get profile by user ID
 *     description: Retrieves a specific user's profile by their user ID (admin or specific use case)
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique identifier of the user
 *         example: user123456
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: User profile data
 *       401:
 *         description: Unauthorized - User not authenticated
 *       404:
 *         description: Profile not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Profile not found
 *       500:
 *         description: Failed to fetch profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Failed to fetch profile
 *                 error:
 *                   type: string
 */
router.get(
  "/profile/:userId",
  protectedRoute,
  profileController.getProfileByUserId.bind(profileController),
);

export  {router};
