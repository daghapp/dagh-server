import express from "express";
import protectedRoute from "../../middleware/protected.js";
import { IdentityVerificationController } from "./identity-verification.controller.js";

const router = express.Router();
const c = new IdentityVerificationController();

router.post("/start", protectedRoute, c.start.bind(c));
router.get("/status", protectedRoute, c.status.bind(c));
router.post("/id", protectedRoute, c.uploadId.bind(c));
router.post("/selfie", protectedRoute, c.uploadSelfie.bind(c));
router.post("/otp/verified", protectedRoute, c.verifyOtp.bind(c));
router.post("/submit", protectedRoute, c.submit.bind(c));
router.post("/appeal", protectedRoute, c.appeal.bind(c));

export { router };
