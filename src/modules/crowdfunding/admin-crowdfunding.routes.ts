import express from "express";
import protectedRoute from "../../middleware/protected.js";
import { requirePermission, PERMISSIONS } from "../../middleware/permissions.js";
import { AdminCrowdfundingController } from "./admin-crowdfunding.controller.js";

const router = express.Router();
const c = new AdminCrowdfundingController();

router.get(
  "/campaigns",
  protectedRoute,
  requirePermission(PERMISSIONS.FUNDRAISING.VIEW),
  c.listCampaigns.bind(c),
);
router.get(
  "/campaigns/:id",
  protectedRoute,
  requirePermission(PERMISSIONS.FUNDRAISING.VIEW),
  c.getCampaign.bind(c),
);
router.patch(
  "/campaigns/:id/status",
  protectedRoute,
  requirePermission(PERMISSIONS.FUNDRAISING.MANAGE),
  c.updateStatus.bind(c),
);
router.get(
  "/contributions",
  protectedRoute,
  requirePermission(PERMISSIONS.FUNDRAISING.VIEW),
  c.listContributions.bind(c),
);

export { router };
