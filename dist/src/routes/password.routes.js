import express from "express";
const router = express.Router();
import { PasswordAuthController } from "../Modules/authentication/password-auth.controller.js";
import { validate } from "../middleware/validation.js";
import protectedRoute from "../middleware/protected.js";
import { loginSchema, registrationSchema, } from "../validator/password-auth-validator.js";
import { verifyOtpSchema, resendOtpSchema } from "../validator/otp-validator.js";
import { refreshTokenSchema } from "../validator/token-validator.js";
const passwordAuthController = new PasswordAuthController();
/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fullName
 *               - phoneNumber
 *               - gender
 *               - dateOfBirth
 *               - email
 *               - password
 *             properties:
 *               fullName:
 *                 type: string
 *                 minLength: 2
 *                 example: John Doe
 *               phoneNumber:
 *                 type: string
 *                 description: Phone number in E.164 format
 *                 example: +1234567890
 *               gender:
 *                 type: string
 *                 example: MALE
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *                 example: 1990-01-01
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 description: Must contain at least one uppercase, lowercase, number, and special character
 *                 example: Password123!
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Invalid input or user already exists
 */
router.post("/register", validate(registrationSchema), passwordAuthController.register.bind(passwordAuthController));
/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 example: Password123!
 *     responses:
 *       200:
 *         description: Login successful
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
 *                     id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     fullName:
 *                       type: string
 *                     accountType:
 *                       type: string
 *                     accessToken:
 *                       type: string
 *                     refreshToken:
 *                       type: string
 *       400:
 *         description: Invalid credentials
 *       403:
 *         description: Email not verified
 */
router.post("/login", validate(loginSchema), passwordAuthController.login.bind(passwordAuthController));
/**
 * @swagger
 * /auth/verify-otp:
 *   post:
 *     summary: Verify OTP for email verification or password reset
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - code
 *               - purpose
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               code:
 *                 type: string
 *                 minLength: 6
 *                 maxLength: 6
 *                 pattern: '^\d+$'
 *                 description: 6-digit numeric OTP code
 *                 example: "123456"
 *               purpose:
 *                 type: string
 *                 enum: [EMAIL_VERIFICATION, PASSWORD_RESET]
 *                 description: Purpose of the OTP verification
 *                 example: EMAIL_VERIFICATION
 *     responses:
 *       200:
 *         description: OTP verified successfully
 *       400:
 *         description: Invalid OTP or OTP expired
 *       404:
 *         description: User not found
 */
router.post("/verify-otp", validate(verifyOtpSchema), passwordAuthController.verifyOtp.bind(passwordAuthController));
/**
 * @swagger
 * /auth/resend-otp:
 *   post:
 *     summary: Resend OTP for email verification
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *       400:
 *         description: Invalid email or email already verified
 *       404:
 *         description: User not found
 *       429:
 *         description: Too many requests - wait 1 minute
 */
router.post("/resend-otp", validate(resendOtpSchema), passwordAuthController.resendOtp.bind(passwordAuthController));
/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout user and invalidate all refresh tokens
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       401:
 *         description: Not authenticated
 */
router.post("/logout", protectedRoute, passwordAuthController.logout.bind(passwordAuthController));
/**
 * @swagger
 * /auth/refresh-token:
 *   post:
 *     summary: Refresh access token using a valid refresh token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: Valid refresh token obtained during login
 *                 example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *     responses:
 *       200:
 *         description: Token refreshed successfully
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
 *                     accessToken:
 *                       type: string
 *       400:
 *         description: Refresh token is required
 *       401:
 *         description: Invalid or expired refresh token
 *       403:
 *         description: Account is not active
 *       404:
 *         description: User not found
 */
router.post("/refresh-token", validate(refreshTokenSchema), passwordAuthController.newAccessToken.bind(passwordAuthController));
/**
 * @swagger
 * /auth/request-reset-password:
 *   post:
 *     summary: Request password reset OTP for authenticated user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Password reset OTP sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Password reset OTP sent successfully
 *       401:
 *         description: Not authenticated
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
 *                   example: Not authenticated
 *       404:
 *         description: User not found
 *       500:
 *         description: Failed to send password reset OTP
 */
router.post("/request-reset-password", protectedRoute, passwordAuthController.requestResetPassword.bind(passwordAuthController));
/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     summary: Reset password using OTP verification
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - otp
 *               - oldPassword
 *               - newPassword
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               otp:
 *                 type: string
 *                 minLength: 6
 *                 maxLength: 6
 *                 description: 6-digit OTP code sent to email
 *                 example: "123456"
 *               oldPassword:
 *                 type: string
 *                 minLength: 6
 *                 format: password
 *                 example: OldPassword123!
 *               newPassword:
 *                 type: string
 *                 minLength: 6
 *                 format: password
 *                 description: Must contain at least one uppercase, lowercase, number, and special character
 *                 example: NewPassword123!
 *     responses:
 *       200:
 *         description: Password reset successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Password reset successful
 *       400:
 *         description: Invalid OTP, OTP expired, or passwords don't match requirements
 *       401:
 *         description: Not authenticated or incorrect old password
 *       404:
 *         description: User not found
 *       500:
 *         description: Failed to reset password
 */
router.post("/reset-password", protectedRoute, passwordAuthController.resetPassword.bind(passwordAuthController));
export { router };
