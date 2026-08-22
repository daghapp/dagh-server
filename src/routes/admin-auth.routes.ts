import express from "express";
import { AdminAuthController } from "../modules/authentication/admin-auth.controller.js";
import { validate } from "../middleware/validation.js";
import { adminRegistrationSchema } from "../validator/admin-auth-validator.js";

const router = express.Router();
const adminAuthController = new AdminAuthController();

/**
 * @swagger
 * /admin/auth/register:
 *   post:
 *     summary: Register a new admin (Admin Gateway)
 *     description: Creates an ACTIVE admin account with department and role. Optionally restricted to an official email domain when ADMIN_OFFICIAL_EMAIL_DOMAIN is set.
 *     tags: [Admin - Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fullName
 *               - email
 *               - password
 *               - department
 *               - role
 *             properties:
 *               fullName:
 *                 type: string
 *                 minLength: 2
 *                 example: Ama Mensah
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Official email address
 *                 example: ama@dagh.app
 *               phoneNumber:
 *                 type: string
 *                 description: Phone number in E.164 format (optional)
 *                 pattern: ^\+[1-9]\d{1,14}$
 *                 example: +233201234567
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 description: Must contain at least one uppercase, lowercase, number, and special character
 *                 example: Password123!
 *               department:
 *                 type: string
 *                 enum: [DIASPORA_AFFAIRS, OPERATIONS, VISA, TOURS, FINANCE, LEGAL, MARKETING, MODERATION, CUSTOMER_SUPPORT, IT_SUPPORT]
 *                 example: DIASPORA_AFFAIRS
 *               role:
 *                 type: string
 *                 enum: [SUPER_ADMIN, ADMIN, VISA_OFFICER, TOUR_MANAGER, FINANCE, SUPPORT, MODERATOR]
 *                 example: ADMIN
 *     responses:
 *       201:
 *         description: Admin registered successfully
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
 *                       format: uuid
 *                     fullName:
 *                       type: string
 *                       example: Ama Mensah
 *                     email:
 *                       type: string
 *                       example: ama@dagh.app
 *                     accountType:
 *                       type: string
 *                       example: ADMIN
 *                     accountStatus:
 *                       type: string
 *                       example: ACTIVE
 *                     adminProfile:
 *                       type: object
 *                       properties:
 *                         department:
 *                           type: string
 *                           example: DIASPORA_AFFAIRS
 *                         role:
 *                           type: string
 *                           example: ADMIN
 *       400:
 *         description: Invalid input or account already exists
 *       403:
 *         description: Email domain not allowed for admin registration
 *       500:
 *         description: Server error
 */
router.post(
  "/auth/register",
  validate(adminRegistrationSchema),
  adminAuthController.register.bind(adminAuthController),
);

export { router };
