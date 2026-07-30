// ─────────────────────────────────────────
// Membership Controller — HTTP handlers
// ─────────────────────────────────────────
// Handles plan listing, plan subscription, subscription retrieval,
// priority support ticketing, and Hubtel payment callbacks.

import { Request, Response } from "express";
import * as membershipService from "../../services/membership.service.js";
import { paymentStatusFromHubtel } from "../../helpers/payment.js";
import { ok, created, fail } from "../../helpers/response.js";
import type { SubscribeMembershipSchema } from "../../validator/index.js";

export class MembershipController {
  // GET /api/membership/plans — returns all active membership tiers
  async getPlans(req: Request, res: Response) {
    try {
      const plans = await membershipService.getMembershipPlans();
      return ok(res, plans);
    } catch (error) {
      console.error("Error fetching membership plans:", error);
      return fail(res, 500, "Failed to fetch membership plans");
    }
  }

  // POST /api/membership/subscribe — subscribe to a plan (free activates immediately, paid initiates checkout)
  async subscribe(req: Request, res: Response) {
    try {
      const userId = req.user?.id as string;
      const payload = req.body as SubscribeMembershipSchema;
      const result = await membershipService.subscribeToPlan(userId, payload);

      if (!result.success) {
        return fail(res, 400, result.message);
      }

      return ok(res, result, result.message);
    } catch (error) {
      console.error("Error subscribing to plan:", error);
      return fail(res, 500, "Failed to subscribe to plan");
    }
  }

  // GET /api/membership/my-subscription — fetch the authenticated user's current subscription
  async getMySubscription(req: Request, res: Response) {
    try {
      const userId = req.user?.id as string;
      const subscription = await membershipService.getUserSubscription(userId);
      return ok(res, subscription);
    } catch (error) {
      console.error("Error fetching subscription:", error);
      return fail(res, 500, "Failed to fetch subscription");
    }
  }

  // POST /api/membership/support — create a priority support ticket (paid tiers only)
  async createPrioritySupport(req: Request, res: Response) {
    try {
      const userId = req.user?.id as string;
      const payload = req.body as { subject: string; message: string };
      const ticket = await membershipService.createPrioritySupportRequest(userId, payload);
      return created(res, ticket, "Support ticket created successfully");
    } catch (error) {
      console.error("Error creating support ticket:", error);
      const message = error instanceof Error ? error.message : "Failed to create support ticket";
      return fail(res, 400, message);
    }
  }

  // POST /api/membership/payment-callback — Hubtel payment callback for subscription payments
  async handlePaymentCallback(req: Request, res: Response) {
    try {
      const { ResponseCode, Data } = req.body;

      if (!Data?.ClientReference) {
        return fail(res, 400, "Missing client reference");
      }

      await membershipService.handleSubscriptionPaymentCallback(
        Data.ClientReference,
        paymentStatusFromHubtel(ResponseCode),
      );

      return ok(res, null, "Payment callback handled");
    } catch (error) {
      console.error(
        `Error handling payment callback (ref: ${req.body?.Data?.ClientReference}):`,
        error,
      );
      return fail(res, 500, "Failed to handle payment callback");
    }
  }
}
