import express from "express";
import { AdminAuthController } from "../modules/authentication/admin-auth.controller.js";
import { AdminMfaController } from "../modules/authentication/admin-mfa.controller.js";
import { AdminDepartmentsController } from "../modules/authentication/admin-departments.controller.js";
import { validate } from "../middleware/validation.js";
import { adminRegistrationSchema } from "../validator/admin-auth-validator.js";
import protectedRoute from "../middleware/protected.js";
import { requirePermission, PERMISSIONS } from "../middleware/permissions.js";

const router = express.Router();
const adminAuthController = new AdminAuthController();
const adminMfaController = new AdminMfaController();
const adminDepartmentsController = new AdminDepartmentsController();

/**
 * @swagger
 * /admin/auth/register:
 *   post:
 *     summary: Register a new admin (Admin Gateway)
 *     description: Creates a PENDING admin account with department and role. A role must belong to its department (e.g. FINANCE only in FINANCE_AND_COMPLIANCE). The account stays PENDING until approved via User Management. Optionally restricted to an official email domain when ADMIN_OFFICIAL_EMAIL_DOMAIN is set.
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
 *                 enum: [EXECUTIVE_MANAGEMENT, OPERATIONS_AND_MEMBERSHIP, FINANCE_AND_COMPLIANCE, TECHNICAL_SUPPORT]
 *                 example: OPERATIONS_AND_MEMBERSHIP
 *                 description: Department. Each department admits exactly one role — see role.
 *               role:
 *                 type: string
 *                 enum: [SUPER_ADMIN, OPERATIONS, FINANCE, SUPPORT]
 *                 example: OPERATIONS
 *                 description: Role, must belong to the selected department (SUPER_ADMIN=EXECUTIVE_MANAGEMENT, OPERATIONS=OPERATIONS_AND_MEMBERSHIP, FINANCE=FINANCE_AND_COMPLIANCE, SUPPORT=TECHNICAL_SUPPORT).
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
 *                       example: PENDING
 *                     adminProfile:
 *                       type: object
 *                       properties:
 *                         department:
 *                           type: string
 *                           example: OPERATIONS_AND_MEMBERSHIP
 *                         role:
 *                           type: string
 *                           example: OPERATIONS
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

/**
 * @swagger
 * /admin/auth/2fa/verify:
 *   post:
 *     summary: Verify an admin's second factor and receive session tokens
 *     description: Exchanges the short-lived mfaToken from login for real access and refresh tokens. `protectedRoute` rejects mfaTokens, so this exchange is the only way in.
 *     tags: [Admin - Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mfaToken, code]
 *             properties:
 *               mfaToken:
 *                 type: string
 *               code:
 *                 type: string
 *                 description: 6-digit SMS or authenticator code, or a backup code when useBackupCode is true
 *                 example: "123456"
 *               method:
 *                 type: string
 *                 enum: [SMS, TOTP, BACKUP]
 *               useBackupCode:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Verified; session tokens issued
 *       401:
 *         description: Invalid or expired mfaToken, or invalid code
 */
router.post(
  "/auth/2fa/verify",
  adminMfaController.verify.bind(adminMfaController),
);

/**
 * @swagger
 * /admin/auth/2fa/resend:
 *   post:
 *     summary: Resend the admin 2FA SMS code
 *     description: Rate limited to one resend per 30 seconds per admin.
 *     tags: [Admin - Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mfaToken]
 *             properties:
 *               mfaToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Code sent
 *       429:
 *         description: Resend cooldown not elapsed
 */
router.post(
  "/auth/2fa/resend",
  adminMfaController.resend.bind(adminMfaController),
);

/**
 * @swagger
 * /admin/auth/2fa/totp/setup:
 *   post:
 *     summary: Begin authenticator-app enrolment
 *     description: Returns the otpauth URI, a manual entry key, and the shared secret. Nothing is enabled until /totp/verify confirms a code.
 *     tags: [Admin - Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Provisioning material
 *       401:
 *         description: Not authenticated
 */
router.post(
  "/auth/2fa/totp/setup",
  protectedRoute,
  requirePermission(PERMISSIONS.SETTINGS.VIEW),
  adminMfaController.totpSetup.bind(adminMfaController),
);

/**
 * @swagger
 * /admin/auth/2fa/totp/verify:
 *   post:
 *     summary: Confirm the first authenticator code and enable TOTP
 *     tags: [Admin - Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: TOTP enabled
 *       400:
 *         description: Invalid code
 */
router.post(
  "/auth/2fa/totp/verify",
  protectedRoute,
  requirePermission(PERMISSIONS.SETTINGS.VIEW),
  adminMfaController.totpVerify.bind(adminMfaController),
);

/**
 * @swagger
 * /admin/auth/2fa/backup-codes:
 *   post:
 *     summary: Regenerate single-use backup codes
 *     description: Returns ten DAGH-XXXX-XXXX codes in plaintext. This is the only response that ever contains them; the stored column holds hashes.
 *     tags: [Admin - Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: New backup codes
 */
router.post(
  "/auth/2fa/backup-codes",
  protectedRoute,
  requirePermission(PERMISSIONS.SETTINGS.VIEW),
  adminMfaController.generateBackupCodes.bind(adminMfaController),
);

/**
 * @swagger
 * /admin/auth/2fa/backup-codes/verify:
 *   post:
 *     summary: Sign in with a backup code
 *     description: Single use. The code is removed from the admin's stored set once it succeeds.
 *     tags: [Admin - Auth]
 *     responses:
 *       200:
 *         description: Verified; session tokens issued
 *       401:
 *         description: Invalid backup code
 */
router.post(
  "/auth/2fa/backup-codes/verify",
  adminMfaController.verifyBackupCode.bind(adminMfaController),
);

/**
 * @swagger
 * /admin/departments:
 *   get:
 *     summary: Admin departments and roles for registration dropdowns
 *     description: Public and unauthenticated so the sign-up form can populate its selects before an admin account exists. Returns departments, roles and rolesByDepartment (the single role each department admits).
 *     tags: [Admin - Auth]
 *     responses:
 *       200:
 *         description: Departments, roles and the role-per-department mapping
 */
router.get("/departments", adminDepartmentsController.getDepartments.bind(adminDepartmentsController));

export { router };
