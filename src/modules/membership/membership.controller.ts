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
    const userId = req.user?.id as string;

    try {
      const payload = req.body as SubscribeMembershipSchema;

      const apiUrl = process.env.API_URL || `${req.protocol}://${req.get("host")}`;
      let returnUrl = payload.returnUrl;
      let cancellationUrl = payload.cancellationUrl || payload.returnUrl;

      // Bridge mobile deep links (non-HTTP schemes) to public HTTPS redirect endpoints.
      // Payment providers typically only accept HTTPS redirect URLs, so deep links
      // like "daghapp://payment" are wrapped in an HTTPS bridge that redirects back.
      const bridgeReturnUrl = `${apiUrl}/membership/payment/return?appUrl=${encodeURIComponent(returnUrl)}`;
      const bridgeCancelUrl = `${apiUrl}/membership/payment/cancel?appUrl=${encodeURIComponent(cancellationUrl)}`;

      let returnParsed: URL;
      try {
        returnParsed = new URL(returnUrl);
      } catch {
        return fail(res, 400, { code: "INVALID_RETURN_URL", message: "Invalid returnUrl" });
      }

      let cancelParsed: URL;
      try {
        cancelParsed = new URL(cancellationUrl);
      } catch {
        return fail(res, 400, { code: "INVALID_RETURN_URL", message: "Invalid cancellationUrl" });
      }

      const isReturnBridgeable =
        returnParsed.protocol !== "https:" && returnParsed.protocol !== "http:";
      const isCancelBridgeable =
        cancelParsed.protocol !== "https:" && cancelParsed.protocol !== "http:";

      if (isReturnBridgeable) {
        returnUrl = bridgeReturnUrl;
      }
      if (isCancelBridgeable) {
        cancellationUrl = bridgeCancelUrl;
      }

      // Validate callback URL is a public HTTPS server endpoint
      try {
        const cbParsed = new URL(payload.callbackUrl);
        if (cbParsed.hostname === "localhost" || cbParsed.hostname === "127.0.0.1") {
          return fail(res, 400, {
            code: "INVALID_RETURN_URL",
            message: "callbackUrl must be a public HTTPS server endpoint",
          });
        }
      } catch {
        return fail(res, 400, { code: "INVALID_RETURN_URL", message: "Invalid callbackUrl" });
      }

      console.log("[MEMBERSHIP_SUBSCRIBE]", {
        userId,
        planId: payload.planId,
        returnUrlScheme: returnParsed.protocol,
        returnUrlHost: returnParsed.hostname,
        isReturnBridged: isReturnBridgeable,
        cancellationUrlScheme: cancelParsed.protocol,
        cancellationUrlHost: cancelParsed.hostname,
        isCancelBridged: isCancelBridgeable,
        callbackUrlHost: new URL(payload.callbackUrl).hostname,
      });

      const result = await membershipService.subscribeToPlan(userId, {
        ...payload,
        returnUrl,
        cancellationUrl,
      });

      if (!result.success) {
        const code = result.code || "CHECKOUT_INITIALIZATION_FAILED";
        let status = 422;
        if (code === "INVALID_PLAN_ID" || code === "INVALID_RETURN_URL") status = 400;
        else if (code === "SUBSCRIPTION_ALREADY_ACTIVE") status = 409;
        else if (code === "PAYMENT_PROVIDER_ERROR") status = 502;

        console.log("[MEMBERSHIP_SUBSCRIBE_FAIL]", {
          userId,
          planId: payload.planId,
          code,
          status,
        });
        return fail(res, status, { code, message: result.message });
      }

      const data = result.data as Record<string, unknown> | undefined;
      const checkoutUrl = data?.checkoutUrl as string | null | undefined;
      let checkoutUrlHostname: string | undefined;
      let checkoutUrlProtocol: string | undefined;
      if (checkoutUrl && typeof checkoutUrl === "string") {
        try {
          const parsed = new URL(checkoutUrl);
          checkoutUrlHostname = parsed.hostname;
          checkoutUrlProtocol = parsed.protocol;
        } catch {
          checkoutUrlHostname = "INVALID";
        }
      }

      console.log("[MEMBERSHIP_SUBSCRIBE_OK]", {
        userId,
        planId: payload.planId,
        subscriptionId: data?.subscriptionId,
        status: data?.status,
        hasCheckoutUrl: Boolean(checkoutUrl),
        checkoutUrlProtocol,
        checkoutUrlHostname,
      });

      return ok(res, result.data, result.message);
    } catch (error) {
      console.error("[MEMBERSHIP_SUBSCRIBE_ERROR]", { userId, error });
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

      console.log("[PAYMENT_CALLBACK]", {
        clientReference: Data.ClientReference,
        responseCode: ResponseCode,
        hasData: Boolean(Data),
      });

      await membershipService.handleSubscriptionPaymentCallback(
        Data.ClientReference,
        paymentStatusFromHubtel(ResponseCode),
      );

      console.log("[PAYMENT_CALLBACK_OK]", {
        clientReference: Data.ClientReference,
        responseCode: ResponseCode,
        paymentStatus: paymentStatusFromHubtel(ResponseCode),
      });

      return ok(res, null, "Payment callback handled");
    } catch (error) {
      console.error(`[PAYMENT_CALLBACK_ERROR] ref: ${req.body?.Data?.ClientReference}`, error);
      return fail(res, 500, "Failed to handle payment callback");
    }
  }

  async paymentReturnBridge(req: Request, res: Response) {
    const appUrl = req.query.appUrl as string;
    if (appUrl) {
      try {
        const urlObj = new URL(appUrl);
        for (const [key, value] of Object.entries(req.query)) {
          if (key !== "appUrl" && typeof value === "string") {
            urlObj.searchParams.append(key, value);
          }
        }
        return res.redirect(urlObj.toString());
      } catch (_e) {
        return res.send("Payment complete, but could not redirect back to the app.");
      }
    }
    return res.send("Payment complete.");
  }

  async paymentCancelBridge(req: Request, res: Response) {
    const appUrl = req.query.appUrl as string;
    if (appUrl) {
      try {
        const urlObj = new URL(appUrl);
        for (const [key, value] of Object.entries(req.query)) {
          if (key !== "appUrl" && typeof value === "string") {
            urlObj.searchParams.append(key, value);
          }
        }
        return res.redirect(urlObj.toString());
      } catch (_e) {
        return res.send("Payment cancelled, but could not redirect back to the app.");
      }
    }
    return res.send("Payment cancelled.");
  }
}
