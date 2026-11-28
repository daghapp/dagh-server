import { Request, Response } from "express";
import { ok, fail } from "../../helpers/response.js";
import * as svc from "./crowdfunding.service.js";
import { requireVerified } from "../../middleware/require-verified.js";
import { verifyStripeSignature, parseStripeEvent } from "../../services/stripe.service.js";
import { verifyPaypalWebhook, parsePaypalEvent } from "../../services/paypal.service.js";

export class CrowdfundingController {
  async createCampaign(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    const data = req.body ?? {};
    if (!data.title || !data.description || !data.goalAmount)
      return fail(res, 400, "title, description, goalAmount required");
    try {
      const row = await svc.createCampaign(userId, data);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
  async publish(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    try {
      const row = await svc.publishCampaign(req.params.id as string, userId);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
  async list(req: Request, res: Response) {
    const status = req.query.status as string | undefined;
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);
    const data = await svc.listCampaigns(status, limit, offset);
    return ok(res, data);
  }
  async get(req: Request, res: Response) {
    const row = await svc.getCampaign(req.params.id as string);
    if (!row) return fail(res, 404, "Not found");
    return ok(res, row);
  }
  async contribute(req: Request, res: Response) {
    const userId = req.user?.id ?? null;
    const { amount, currency, provider, anonymous } = req.body ?? {};
    if (!amount || !provider) return fail(res, 400, "amount and provider required");
    try {
      const data = await svc.initiateContribution(req.params.id as string, userId, {
        amount: Number(amount),
        currency,
        provider,
        anonymous,
      });
      return ok(res, data);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
  async contributions(req: Request, res: Response) {
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const data = await svc.listContributions(req.params.id as string, limit, offset);
    return ok(res, data);
  }
  async webhook(req: Request, res: Response) {
    const { providerRef, success } = req.body ?? {};
    if (!providerRef) return fail(res, 400, "providerRef required");
    await svc.handleWebhook(providerRef, !!success);
    return ok(res, { received: true });
  }

  async stripeWebhook(req: Request, res: Response) {
    const rawBody =
      (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
    const signature = req.headers["stripe-signature"] as string | undefined;
    if (!verifyStripeSignature(rawBody, signature)) {
      return fail(res, 400, "Invalid Stripe signature");
    }
    const { providerRef, success, eventType } = parseStripeEvent(req.body);
    if (providerRef && success) {
      await svc.handleWebhook(providerRef, true);
    }
    return ok(res, { received: true, eventType });
  }

  async paypalWebhook(req: Request, res: Response) {
    const verified = await verifyPaypalWebhook(
      req.headers as Record<string, unknown>,
      req.body ?? {},
    );
    if (!verified) return fail(res, 400, "Invalid PayPal signature");
    const { providerRef, success, eventType } = parsePaypalEvent(req.body);
    if (providerRef && success) {
      await svc.handleWebhook(providerRef, true);
    }
    return ok(res, { received: true, eventType });
  }
}
