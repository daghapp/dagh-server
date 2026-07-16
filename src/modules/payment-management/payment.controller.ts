import { Request, Response } from "express";
import { prisma, hubtelClient, hubtelStatusClient, hubtelDirectMoneyReceive } from "../../config/index.js";
import { HubtelDirectReceiveResponseSchema, initializePaymentSchema_momo, InitializePaymentSchema_MOMO, SubscribtionPaymentSchema, InitializePaymentSchema } from "../../validator/index.js";
import { generateClientReference, generateClientReference_targetType } from "../../helpers/client-ref.js";
import { mapMomoProvider } from "../../helpers/stringHelper.js";
import { AxiosResponse } from "axios";
import { PaymentProvider, PaymentStatus, PaymentTargetType } from "../../../generated/prisma/client.js";
import { paymentStatusFromHubtel } from "../../helpers/payment.js";

export const HUBTEL_CALLBACK_URL = process.env.API_URL+"/payment/hubtel_callback"
export const HUBTEL_CANCELLATION_URL = process.env.API_URL+"/payment/hubtel_cancellation"
export const HUBTEL_RETURN_URL = process.env.API_URL+"/payment/processing"

export class PaymentController {

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

      return res.status(200).json({
        success: true,
        message: "Payment initialized successfully",
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


  static async initializePayment(paymentPaylod: InitializePaymentSchema&{targetType: PaymentTargetType, targetId:string, userId: string, currency: string}) {
    try {
      const reference = generateClientReference_targetType(paymentPaylod.targetType)

      const hubtelResponse = await hubtelClient.post(
        "/items/initiate",
         {...paymentPaylod,
          merchantAccountNumber: process.env.HUBTEL_MERCHANT_NUMBER,
          clientReference: reference,
        }
      );

      const data = hubtelResponse.data;

      if (data.responseCode != "0000"){
      return {
        success: false,
        message: "Error code from hubtel: "+data.responseCode,
        data: {},
        paymentId: "",
        paymentStatus: "",
      };
      }

    const log = await prisma.hubtelDirectReceiveLog.create({
      data: {
        message: data.data.message,
        responseCode: data.responseCode,
        amount: paymentPaylod.totalAmount,
        charges: 0,
        amountAfterCharges: 0,
        amountCharged: paymentPaylod.totalAmount,
        description: data.data.message,
        clientReference: data.data.clientReference,
        transactionId: data.data.checkoutId,
        deliveryFee: 0,
      },
    });

         const payment = await prisma.payment.create({
    data: {
      userId: paymentPaylod.userId,
      targetType:paymentPaylod.targetType,
      targetId: paymentPaylod.targetId,
      amount: paymentPaylod.totalAmount,
      currency: paymentPaylod.currency,
      description: paymentPaylod.description,
      reference,
      status: PaymentStatus.INITIALIZED,
      provider: PaymentProvider.HUBTEL,
    },
  });

      return {
        success: true,
        message: "Payment initialized successfully",
        paymentId: payment.id,
        paymentStatus: payment.status,
        data: data
      };

    } catch (error: any) {
      console.error("Payment initialization error:", error?.response?.data || error);
      
      return {
        success: false,
        message: "Payment initialization failed",
        error: error?.response?.data || error.message,
        paymentId: "",
        paymentStatus: "",
      };
    }
  } 


  async initializePayment_MOMO(req: Request, res: Response) {
    try {
      const user = req.user as any;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const {  userId,
  targetType,
  targetId,
  amount,
  currency,
  customerPhone,
  description,
  method
} = initializePaymentSchema_momo.parse(req.body);
   const reference = generateClientReference()

   const payment = await prisma.payment.create({
    data: {
      userId,
      targetType,
      targetId,
      amount,
      currency,
      description,
      reference,
      status: PaymentStatus.INITIALIZED,
      provider: PaymentProvider.HUBTEL,
    },
  });
  const response: AxiosResponse<HubtelDirectReceiveResponseSchema> = await hubtelDirectMoneyReceive.post("", {
    amount,
    customerMsisdn: customerPhone,
    clientReference: payment.reference,
    primaryCallbackUrl: HUBTEL_CALLBACK_URL,
    description: `Payment for tour ${targetId}`,
    Channel: mapMomoProvider(method),
    CustomerEmail: user.email,
  });

    const log = await prisma.hubtelDirectReceiveLog.create({
      data: {
        message: response.data.Message,
        responseCode: response.data.ResponseCode,
        amount: response.data.Data.Amount,
        charges: response.data.Data.Charges,
        amountAfterCharges: response.data.Data.AmountAfterCharges,
        amountCharged: response.data.Data.AmountCharged,
        description: response.data.Data.Description,
        clientReference: response.data.Data.ClientReference,
        transactionId: response.data.Data.TransactionId,
        deliveryFee: response.data.Data.DeliveryFee,
      },
    });

        // Map ResponseCode to Payment status
    const newStatus = paymentStatusFromHubtel(response.data.ResponseCode);

    // Update Payment record
    await prisma.payment.update({
      where: { id: payment.id },   // you already have the instance
      data: { status: newStatus },
    });



      return res.status(200).json({
        success: true,
        message: "Payment initialized successfully",
        data: response.data,
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

//initializes a payment by sending a request to Hubtel and storing the payment details in the database
 static async initializePayment_MOMO(payload:InitializePaymentSchema_MOMO) {
    try {
      const {  userId,
  targetType,
  targetId,
  amount,
  currency,
  customerPhone,
  description,
  method,
} = payload;
   const reference = generateClientReference()

   const payment = await prisma.payment.create({
    data: {
      userId,
      targetType,
      targetId,
      amount,
      currency,
      description,
      reference,
      status: PaymentStatus.INITIALIZED,
      provider: PaymentProvider.HUBTEL,
    },
  });
  const response: AxiosResponse<HubtelDirectReceiveResponseSchema> = await hubtelDirectMoneyReceive.post("", {
    amount,
    customerMsisdn: customerPhone,
    primaryCallbackUrl: HUBTEL_CALLBACK_URL,
    clientReference: payment.reference,
    description: `Payment for tour ${targetId}`,
    Channel: mapMomoProvider(method),
  });

    const log = await prisma.hubtelDirectReceiveLog.create({
      data: {
        message: response.data.Message,
        responseCode: response.data.ResponseCode,
        amount: response.data.Data.Amount,
        charges: response.data.Data.Charges,
        amountAfterCharges: response.data.Data.AmountAfterCharges,
        amountCharged: response.data.Data.AmountCharged,
        description: response.data.Data.Description,
        clientReference: response.data.Data.ClientReference,
        transactionId: response.data.Data.TransactionId,
        deliveryFee: response.data.Data.DeliveryFee,
      },
    });

        // Map ResponseCode to Payment status
    const newStatus = paymentStatusFromHubtel(response.data.ResponseCode);

    // Update Payment record
    await prisma.payment.update({
      where: { id: payment.id },   // you already have the instance
      data: { status: newStatus },
    });



      return {
        success: true,
        paymentId: payment.id,
        message: "Payment initialized successfully",
      }

    } catch (error: any) {
      return{
        success: false,
        message: "Payment initialization failed",
        error: error?.response?.data || error.message,
      }
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
        where: { reference: reference },
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
            { reference: posSalesId },
            { providerReference: posSalesId }
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
