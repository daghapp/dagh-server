import express from "express";
import protectedRoute from "../../middleware/protected.js";
import adminAuth from "../../middleware/admin.js";
import { IdentityVerificationController } from "./identity-verification.controller.js";

const router = express.Router();
const c = new IdentityVerificationController();

router.get("/", protectedRoute, adminAuth, c.adminList.bind(c));
router.patch("/:userId/decide", protectedRoute, adminAuth, c.adminDecide.bind(c));
router.patch("/appeals/:appealId/decide", protectedRoute, adminAuth, c.adminDecideAppeal.bind(c));

export { router };
