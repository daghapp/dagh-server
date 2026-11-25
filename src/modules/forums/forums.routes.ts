import express from "express";
import protectedRoute from "../../middleware/protected.js";
import { ForumsController } from "./forums.controller.js";
import { requireVerified } from "../../middleware/require-verified.js";

const router = express.Router();
const c = new ForumsController();

router.get("/forums", c.listForums.bind(c));
router.post("/forums", protectedRoute, c.createForum.bind(c));
router.get("/forums/:slug/threads", c.listThreads.bind(c));
router.post("/forums/:slug/threads", protectedRoute, requireVerified("post"), c.createThread.bind(c));
router.get("/threads/:id", c.getThread.bind(c));
router.post("/threads/:id/comments", protectedRoute, requireVerified("post"), c.createComment.bind(c));

export { router };
