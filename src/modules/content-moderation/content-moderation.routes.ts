import express from "express";
import protectedRoute from "../../middleware/protected.js";
import { requireVerified } from "../../middleware/require-verified.js";
import { ContentModerationController } from "./content-moderation.controller.js";

const router = express.Router();
const c = new ContentModerationController();

router.post("/posts", protectedRoute, requireVerified("post"), c.create.bind(c));
router.get("/posts", protectedRoute, c.listApproved.bind(c));
router.get("/posts/:id", protectedRoute, c.get.bind(c));
router.post("/posts/:id/appeal", protectedRoute, c.appeal.bind(c));

export { router };
