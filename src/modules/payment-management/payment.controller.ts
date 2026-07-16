import { Request, Response } from "express";
import { prisma, hubtelClient, hubtelStatusClient } from "../../config/index.js";
import { initializePaymentSchema_momo, SubscriptionPaymentSchema } from "../../validator/index.js";
import { generateClientReference } from "../../helpers/client-ref.js";
import { PaymentStatus } from "../../../generated/prisma/client.js";
import * as paymentService from "../../services/payment.service.js";

export class PaymentController {
  async initializePayment(req: Request, res: Response) {
    try {
      const user = req.user as any;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const payload = req.body as any;
      const result = await paymentService.initializePayment({
        ...payload,
        targetType: payload.targetType ?? ("TOUR_BOOKING" as any),
        targetId: payload.targetId ?? "",
        userId: user.id,
        currency: payload.currency ?? "GHS",
      });

      return res.status(200).json({
        success: result.success,
        message: result.message,
      });
    } catch (error: any) {
      console.error("Payment initialization error:", error?.response?.data || error);
      return res.status(500).json({
        success: false,
        message: "Payment initialization failed",
        error: error?.response?.data || error.message,
      });
    }
  }

  async initializePayment_MOMO(req: Request, res: Response) {
    try {
      const user = req.user as any;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const payload = initializePaymentSchema_momo.parse(req.body);
      const result = await paymentService.initializePaymentMOMO(payload);

      return res.status(200).json({
        success: result.success,
        message: result.message,
        data: result.data,
      });
    } catch (error: any) {
      console.error("Payment initialization error:", error?.response?.data || error);
      return res.status(500).json({
        success: false,
        message: "Payment initialization failed",
        error: error?.response?.data || error.message,
      });
    }
  }

  async subscriptionPayment(req: Request, res: Response) {
    try {
      const user = req.user as any;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
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
        return res.status(400).json({
          success: false,
          message: "Failed to create subscription invoice",
          data,
        });
      }

      const totalAmount = payload.items.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice,
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

      return res.status(200).json({
        success: true,
        message: "Subscription invoice created successfully",
        data,
      });
    } catch (error: any) {
      console.error("Subscription payment error:", error?.response?.data || error);
      return res.status(500).json({
        success: false,
        message: "Subscription payment failed",
        error: error?.response?.data || error.message,
      });
    }
  }

  async verifyPayment(req: Request, res: Response) {
    try {
      const { reference } = req.params as { reference: string };

      const hubtelResponse = await hubtelClient.get(`/items/status/${reference}`);
      const data = hubtelResponse.data;

      if (!data) {
        return res.status(400).json({ success: false, message: "Unable to verify payment" });
      }

      let status: "SUCCESS" | "FAILED" | "PENDING" = "PENDING";
      if (data.status === "Paid") status = "SUCCESS";
      if (data.status === "Failed") status = "FAILED";

      await prisma.payment.update({ where: { reference }, data: { status } });

      return res.status(200).json({ success: true, message: "Payment verified", data });
    } catch (error: any) {
      console.error("Verify payment error:", error?.response?.data || error);
      return res.status(500).json({
        success: false,
        message: "Payment verification failed",
        error: error?.response?.data || error.message,
      });
    }
  }

  async checkTransactionStatus(req: Request, res: Response) {
    try {
      const { posSalesId } = req.params as { posSalesId: string };

      const hubtelResponse = await hubtelStatusClient.get(`/transactions/${posSalesId}/status`);
      const data = hubtelResponse.data;

      if (!data) {
        return res
          .status(400)
          .json({ success: false, message: "Unable to check transaction status" });
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

      return res.status(200).json({
        success: true,
        message: "Transaction status retrieved",
        data: {
          ...data,
          internalStatus: status,
          paymentRecord: payment ? { id: payment.id, status } : null,
        },
      });
    } catch (error: any) {
      console.error("Transaction status check error:", error?.response?.data || error);
      return res.status(500).json({
        success: false,
        message: "Transaction status check failed",
        error: error?.response?.data || error.message,
      });
    }
  }
}
