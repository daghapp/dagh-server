import express from "express";
import protectedRoute from "../../middleware/protected.js";
import { requirePermission, PERMISSIONS } from "../../middleware/permissions.js";
import { DailyBriefController } from "./daily-brief.controller.js";

const router = express.Router();
const c = new DailyBriefController();

router.post(
  "/generate",
  protectedRoute,
  requirePermission(PERMISSIONS.CONTENT.MODERATE),
  c.generate.bind(c),
);
router.patch(
  "/:id/publish",
  protectedRoute,
  requirePermission(PERMISSIONS.CONTENT.MODERATE),
  c.publish.bind(c),
);

export { router };
