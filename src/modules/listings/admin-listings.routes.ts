import express from "express";
import protectedRoute from "../../middleware/protected.js";
import adminAuth from "../../middleware/admin.js";
import { ListingsController } from "./listings.controller.js";

const router = express.Router();
const c = new ListingsController();

router.get("/queue", protectedRoute, adminAuth, c.adminQueue.bind(c));
router.patch("/:id/decide", protectedRoute, adminAuth, c.adminDecide.bind(c));
router.patch("/:id/badge", protectedRoute, adminAuth, c.issueBadge.bind(c));
router.get("/search-requests", protectedRoute, adminAuth, c.listSearchRequests.bind(c));
router.patch("/search-requests/:id", protectedRoute, adminAuth, c.updateSearchRequest.bind(c));

export { router };
