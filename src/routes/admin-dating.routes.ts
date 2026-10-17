import express from "express";
import protectedRoute from "../middleware/protected.js";
import { requirePermission, PERMISSIONS } from "../middleware/permissions.js";
import {
  listProfiles,
  getProfileStats,
  getProfileDetail,
  approveProfile,
  rejectProfile,
  requestInfo,
  flagProfile,
  bulkReview,
  addNote,
  getDocument,
} from "../modules/dating/admin-dating.controller.js";

// Admin dating moderation (§3.6). Mounted centrally at /admin/dating, so all
// paths below are relative to that prefix.
//
// NOTE: static segments (/profiles/stats, /profiles/bulk) are registered
// before /profiles/:id so Express does not treat them as an :id value.
const router = express.Router();

router.use(protectedRoute);

router.get("/profiles/stats", requirePermission(PERMISSIONS.DATING.VIEW), getProfileStats);
router.patch("/profiles/bulk", requirePermission(PERMISSIONS.DATING.APPROVE), bulkReview);
router.get("/profiles", requirePermission(PERMISSIONS.DATING.VIEW), listProfiles);
router.get("/profiles/:id/document", requirePermission(PERMISSIONS.DATING.VIEW), getDocument);
router.get("/profiles/:id", requirePermission(PERMISSIONS.DATING.VIEW), getProfileDetail);
router.patch(
  "/profiles/:id/approve",
  requirePermission(PERMISSIONS.DATING.APPROVE),
  approveProfile,
);
router.patch("/profiles/:id/reject", requirePermission(PERMISSIONS.DATING.REJECT), rejectProfile);
router.post(
  "/profiles/:id/request-info",
  requirePermission(PERMISSIONS.DATING.APPROVE),
  requestInfo,
);
router.patch("/profiles/:id/flag", requirePermission(PERMISSIONS.DATING.APPROVE), flagProfile);
router.post("/profiles/:id/notes", requirePermission(PERMISSIONS.DATING.APPROVE), addNote);

export { router };
