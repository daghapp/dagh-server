import express from "express";
const router = express.Router();

import { PasswordAuthController } from "../Modules/authentication/password-auth.controller";
import { validate } from "../middleware/validation";
import protectedRoute from "../middleware/protected";
import {
  loginSchema,
  registrationSchema,
} from "../validator/password-auth-validator";
import { verifyOtpSchema, resendOtpSchema } from "../validator/otp-validator";
import { refreshTokenSchema } from "../validator/token-validator";


const passwordAuthController = new PasswordAuthController();
router.post(
  "/register",
  validate(registrationSchema),
  passwordAuthController.register.bind(passwordAuthController),
);
router.post(
  "/login",
  validate(loginSchema),
  passwordAuthController.login.bind(passwordAuthController),
);
router.post(
  "/verify-otp",
  validate(verifyOtpSchema),
  passwordAuthController.verifyOtp.bind(passwordAuthController),
);
router.post(
  "/resend-otp",
  validate(resendOtpSchema),
  passwordAuthController.resendOtp.bind(passwordAuthController),
);
router.post(
  "/logout",
  protectedRoute,
  passwordAuthController.logout.bind(passwordAuthController),
);
router.post(
  "/refresh-token",
  validate(refreshTokenSchema),
  passwordAuthController.newAccessToken.bind(passwordAuthController),
);

export { router };
