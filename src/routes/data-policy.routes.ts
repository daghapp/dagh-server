import express from "express";
import {
  getDataPolicy,
  adminGetDataPolicy,
  adminUpdateDataPolicy,
} from "../modules/data-policy/data-policy.controller.js";
import protectedRoute from "../middleware/protected.js";
import requireAdmin from "../middleware/admin.js";
import { validate } from "../middleware/validation.js";
import { updateDataPolicySchema } from "../validator/data-policy-validator.js";

const router = express.Router();

// Public: fetch the data policy
router.get("/", getDataPolicy);

// Admin: fetch the full policy record for editing
router.get("/admin/policy", protectedRoute, requireAdmin, adminGetDataPolicy);

// Admin: update the data policy content
router.put(
  "/admin/policy",
  protectedRoute,
  requireAdmin,
  validate(updateDataPolicySchema),
  adminUpdateDataPolicy,
);

export { router };
