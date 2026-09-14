import { Request, Response } from "express";
import { prisma, hubtelClient, hubtelStatusClient, isPaymentsEnabled, PAYMENTS_DISABLED_MESSAGE } from "../../config/index.js";
import { initializePaymentSchema, initializePaymentSchema_momo } from "../../validator/index.js";
import type { SubscriptionPaymentSchema } from "../../validator/index.js";
import { generateClientReference } from "../../helpers/client-ref.js";
import * as paymentService from "../../services/payment.service.js";
import { ok, fail } from "../../helpers/response.js";
import { PaymentTargetType } from "../../../generated/prisma/client.js";

export class PaymentController {
  async initializePayment(req: Request, res: Response) {
    try {
      const user = req.user as { id: string; email: string } | undefined;
      if (!user) {
        return fail(res, 401, "Unauthorized");
      }

      const body = req.body;
      const payload = initializePaymentSchema.parse(body);
      const result = await paymentService.initializePayment({
        totalAmount: payload.totalAmount,
        description: payload.description,
        returnUrl: payload.returnUrl,
        callbackUrl: payload.callbackUrl,
        cancellationUrl: payload.cancellationUrl,
        targetType: (body.targetType as PaymentTargetType) ?? PaymentTargetType.TOUR_BOOKING,
        targetId: body.targetId ?? "",
        userId: user.id,
        currency: body.currency ?? "GHS",
      });

      if (!result.success) {
        return fail(res, 503, result.message);
      }

      return ok(res, null as never, result.message);
    } catch (error) {
      console.error("Payment initialization error:", error);
      return fail(res, 500, "Payment initialization failed");
    }
  }

  async initializePayment_MOMO(req: Request, res: Response) {
    try {
      const user = req.user as { id: string; email: string } | undefined;
      if (!user) {
        return fail(res, 401, "Unauthorized");
      }
      const payload = initializePaymentSchema_momo.parse(req.body);
      const result = await paymentService.initializePaymentMOMO(payload);

      if (!result.success) {
        return fail(res, 503, result.message);
      }

      return ok(res, result.data, result.message);
    } catch (error) {
      console.error("Payment initialization error:", error);
      return fail(res, 500, "Payment initialization failed");
    }
  }

  async subscriptionPayment(req: Request, res: Response) {
    try {
      if (!(await isPaymentsEnabled())) {
        return fail(res, 503, PAYMENTS_DISABLED_MESSAGE);
      }

      const user = req.user as { id: string; email: string } | undefined;
      if (!user) {
        return fail(res, 401, "Unauthorized");
      }

      const payload = req.body as SubscriptionPaymentSchema;
      const reference = generateClientReference();

      const hubtelResponse = await hubtelClient.post("/invoice/create", {
        ...payload,
        merchantAccountNumber: process.env.HUBTEL_MERCHANT_NUMBER,
        clientReference: reference,
      });

      const data = hubtelResponse.data;

      if (!data || !data.invoiceId) {
        return fail(res, 400, "Failed to create subscription invoice", data);
      }

      const totalAmount = (payload as SubscriptionPaymentSchema).items.reduce(
        (sum: number, item: { quantity: number; unitPrice: number }) =>
          sum + item.quantity * item.unitPrice,
        0,
      );

      await prisma.$transaction(async (tx) => {
        const subscription = await tx.userSubscription.upsert({
          where: { userId: user.id },
          update: { autoRenew: true, startDate: new Date() },
          create: { userId: user.id, autoRenew: true, startDate: new Date() },
        });

        await tx.billingHistory.create({
          data: {
            subscriptionId: subscription.id,
            amount: totalAmount,
            currency: "GHS",
            paymentReference: data.invoiceId,
          },
        });
      });

      return ok(res, data, "Subscription invoice created successfully");
    } catch (error) {
      console.error("Subscription payment error:", error);
      return fail(res, 500, "Subscription payment failed");
    }
  }

  async verifyPayment(req: Request, res: Response) {
    try {
      const { reference } = req.params as { reference: string };

      const hubtelResponse = await hubtelClient.get(`/items/status/${reference}`);
      const data = hubtelResponse.data;

      if (!data) {
        return fail(res, 400, "Unable to verify payment");
      }

      let status: "SUCCESS" | "FAILED" | "PENDING" = "PENDING";
      if (data.status === "Paid") status = "SUCCESS";
      if (data.status === "Failed") status = "FAILED";

      await prisma.payment.update({ where: { reference }, data: { status } });

      return ok(res, data, "Payment verified");
    } catch (error) {
      console.error("Verify payment error:", error);
      return fail(res, 500, "Payment verification failed");
    }
  }

  async checkTransactionStatus(req: Request, res: Response) {
    try {
      const { posSalesId } = req.params as { posSalesId: string };

      const hubtelResponse = await hubtelStatusClient.get(`/transactions/${posSalesId}/status`);
      const data = hubtelResponse.data;

      if (!data) {
        return fail(res, 400, "Unable to check transaction status");
      }

      let status: "SUCCESS" | "FAILED" | "PENDING" = "PENDING";
      if (data.responseCode === "0000" || data.status?.toLowerCase() === "success") {
        status = "SUCCESS";
      } else if (data.responseCode === "0001" || data.status?.toLowerCase() === "failed") {
        status = "FAILED";
      }

      const payment = await prisma.payment.findFirst({
        where: { OR: [{ reference: posSalesId }, { providerReference: posSalesId }] },
      });

      if (payment) {
        await prisma.payment.update({ where: { id: payment.id }, data: { status } });
      }

      return ok(
        res,
        {
          ...data,
          internalStatus: status,
          paymentRecord: payment ? { id: payment.id, status } : null,
        },
        "Transaction status retrieved",
      );
    } catch (error) {
      console.error("Transaction status check error:", error);
      return fail(res, 500, "Transaction status check failed");
    }
  }
}
