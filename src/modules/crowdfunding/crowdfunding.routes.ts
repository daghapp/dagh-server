import express from "express";
import protectedRoute from "../../middleware/protected.js";
import { CrowdfundingController } from "./crowdfunding.controller.js";
import { requireVerified } from "../../middleware/require-verified.js";

const router = express.Router();
const c = new CrowdfundingController();

router.get("/campaigns", c.list.bind(c));
router.get("/campaigns/:id", c.get.bind(c));
router.post("/campaigns", protectedRoute, requireVerified("fundraise"), c.createCampaign.bind(c));
router.post(
  "/campaigns/:id/publish",
  protectedRoute,
  requireVerified("fundraise"),
  c.publish.bind(c),
);
router.post("/campaigns/:id/contribute", protectedRoute, c.contribute.bind(c));
router.get("/campaigns/:id/contributions", c.contributions.bind(c));
router.post("/payment/webhooks/crowdfunding", c.webhook.bind(c));
router.post("/payment/webhooks/stripe", c.stripeWebhook.bind(c));
router.post("/payment/webhooks/paypal", c.paypalWebhook.bind(c));

export { router };
