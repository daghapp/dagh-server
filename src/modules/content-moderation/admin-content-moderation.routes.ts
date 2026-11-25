import express from "express";
import protectedRoute from "../../middleware/protected.js";
import adminAuth from "../../middleware/admin.js";
import { ContentModerationController } from "./content-moderation.controller.js";

const router = express.Router();
const c = new ContentModerationController();

router.get("/queue", protectedRoute, adminAuth, c.adminQueue.bind(c));
router.patch("/posts/:id/decide", protectedRoute, adminAuth, c.adminDecide.bind(c));
router.patch("/appeals/:appealId/decide", protectedRoute, adminAuth, c.adminDecideAppeal.bind(c));

export { router };
