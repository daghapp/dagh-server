import express from "express";
const router = express.Router();

import { PasswordAuthController } from "../Modules/authentication/password-auth.controller";
import { validate } from "../middleware/validation";
import {
  loginSchema,
  registrationSchema,
} from "../validator/password-auth-validator";

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

export { router };
