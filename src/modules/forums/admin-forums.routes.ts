import express from "express";
import protectedRoute from "../../middleware/protected.js";
import adminAuth from "../../middleware/admin.js";
import { ForumsController } from "./forums.controller.js";

const router = express.Router();
const c = new ForumsController();

router.get("/pending-threads", protectedRoute, adminAuth, c.adminPendingThreads.bind(c));
router.get("/pending-comments", protectedRoute, adminAuth, c.adminPendingComments.bind(c));
router.patch("/threads/:id/decide", protectedRoute, adminAuth, c.adminDecideThread.bind(c));
router.patch("/comments/:id/decide", protectedRoute, adminAuth, c.adminDecideComment.bind(c));

export { router };
