import { Request, Response } from "express";
import { prisma, hubtelClient, hubtelStatusClient } from "../../config/index.js";
import { InitializePaymentSchema, SubscribtionPaymentSchema } from "../../validator/index.js";
import { generateClientReference } from "../../helpers/client-ref.js";

export class PaymentController {

//initializes a payment by sending a request to Hubtel and storing the payment details in the database
  async initializePayment(req: Request, res: Response) {
    try {
      const user = req.user as any;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const payload = req.body as InitializePaymentSchema;
      const reference = generateClientReference()


      const hubtelResponse = await hubtelClient.post(
        "/items/initiate",
         {...payload,
          merchantAccountNumber: process.env.HUBTEL_MERCHANT_NUMBER,
          clientReference: reference,

        }
      );
      console.log(hubtelResponse.data, "Hubtel response data") // Debug log for Hubtel response

      const data = hubtelResponse.data;

      if (!data || !data.data || !data.data.checkoutId) {
        return res.status(400).json({
          success: false,
          message: "Invalid response from Hubtel",
          data,
        });
      }

      const paymentData = data.data;

      await prisma.payment.create({
        data: {
          userId: user.id,
          amount: payload.totalAmount,
          description: payload.description,
          status: "INITIALIZED",
          paymentReference: paymentData.checkoutId,
          clientReference: reference,
        },
      });

      return res.status(200).json({
        success: true,
        message: "Payment initialized successfully",
        data: paymentData,
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
//handles subscription payments by creating an invoice with Hubtel and recording the subscription details in the database
  async subscriptionPayment(req: Request, res: Response) {
    try {
      const user = req.user as any;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const payload = req.body as SubscribtionPaymentSchema;
      const reference = generateClientReference()

      const hubtelResponse = await hubtelClient.post(
        "/invoice/create",
        {...payload,
          merchantAccountNumber: process.env.HUBTEL_MERCHANT_NUMBER,
          clientReference: reference,

        }
      );

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
        0
      );

      await prisma.$transaction(async (tx) => {

        const subscription = await tx.userSubscription.upsert({
          where: { userId: user.id },
          update: {
            autoRenew: true,
            startDate: new Date(),
          },
          create: {
            userId: user.id,
            autoRenew: true,
            startDate: new Date(),
          },
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

      const hubtelResponse = await hubtelClient.get(
        `/items/status/${reference}`
      );

      const data = hubtelResponse.data;

      if (!data) {
        return res.status(400).json({
          success: false,
          message: "Unable to verify payment",
        });
      }

      let status: "SUCCESS" | "FAILED" | "PENDING" = "PENDING";

      if (data.status === "Paid") status = "SUCCESS";
      if (data.status === "Failed") status = "FAILED";

      await prisma.payment.update({
        where: { paymentReference: reference },
        data: { status },
      });

      return res.status(200).json({
        success: true,
        message: "Payment verified",
        data,
      });

    } catch (error: any) {
      console.error("Verify payment error:", error?.response?.data || error);

      return res.status(500).json({
        success: false,
        message: "Payment verification failed",
        error: error?.response?.data || error.message,
      });
    }
  }

  // Check transaction status using Hubtel's dedicated status API
  async checkTransactionStatus(req: Request, res: Response) {
    try {
      const { posSalesId } = req.params as { posSalesId: string };

      // Call Hubtel transaction status API
      const hubtelResponse = await hubtelStatusClient.get(
        `/transactions/${posSalesId}/status`
      );

      const data = hubtelResponse.data;

      if (!data) {
        return res.status(400).json({
          success: false,
          message: "Unable to check transaction status",
        });
      }

      // Map Hubtel status to your internal status
      let status: "SUCCESS" | "FAILED" | "PENDING" = "PENDING";
      
      if (data.responseCode === "0000" || data.status?.toLowerCase() === "success") {
        status = "SUCCESS";
      } else if (data.responseCode === "0001" || data.status?.toLowerCase() === "failed") {
        status = "FAILED";
      }

      // Update payment record if found by POS Sales ID
      const payment = await prisma.payment.findFirst({
        where: { 
          OR: [
            { paymentReference: posSalesId },
            { clientReference: posSalesId }
          ]
        },
      });

      if (payment) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status },
        });
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
