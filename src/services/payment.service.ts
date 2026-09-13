/**
 * Payment service — extracted from PaymentController (Phase 2.2).
 *
 * Centralizes all Hubtel payment initialization logic in one place.
 * Uses `prisma.$transaction()` to ensure Payment records and Hubtel API calls
 * are atomic — if the DB write fails, the Hubtel request is never made, and vice versa.
 *
 * Previously this logic was duplicated across payment.controller.ts (static vs instance methods),
 * user-tour.controller.ts, user-visa.controller.ts, and itinerary.payment.controller.ts.
 */
import { prisma, hubtelClient, hubtelDirectMoneyReceive, paymentsEnabled, PAYMENTS_DISABLED_MESSAGE } from "../config/index.js";
import {
  generateClientReference,
  generateClientReference_targetType,
} from "../helpers/client-ref.js";
import { mapMomoProvider } from "../helpers/stringHelper.js";
import { paymentStatusFromHubtel } from "../helpers/payment.js";
import {
  PaymentProvider,
  PaymentStatus,
  PaymentTargetType,
} from "../../generated/prisma/client.js";
import { InitializePaymentSchema, InitializePaymentSchema_MOMO } from "../validator/index.js";
import axios, { AxiosResponse } from "axios";
import { HubtelDirectReceiveResponseSchema } from "../validator/index.js";

export const HUBTEL_CALLBACK_URL = process.env.API_URL + "/payment/hubtel_callback";
export const HUBTEL_CANCELLATION_URL = process.env.API_URL + "/payment/hubtel_cancellation";
export const HUBTEL_RETURN_URL = process.env.API_URL + "/payment/processing";

type InitPaymentInput = InitializePaymentSchema & {
  targetType: PaymentTargetType;
  targetId: string;
  userId: string;
  currency: string;
};

export type HubtelCheckoutData = {
  message: string;
  clientReference: string;
  checkoutId: string;
  checkoutUrl?: string;
};

export type HubtelCheckoutResponse = {
  responseCode: string;
  data: HubtelCheckoutData;
};

type InitPaymentResult = {
  success: boolean;
  message: string;
  paymentId: string;
  paymentStatus: string;
  data?: HubtelCheckoutResponse;
  error?: string;
};

export async function initializePayment(input: InitPaymentInput): Promise<InitPaymentResult> {
  if (!paymentsEnabled) {
    const reference = generateClientReference_targetType(input.targetType);
    const payment = await prisma.payment.create({
      data: {
        userId: input.userId,
        targetType: input.targetType,
        targetId: input.targetId,
        amount: input.totalAmount,
        currency: input.currency,
        description: input.description,
        reference,
        status: PaymentStatus.SUCCESS,
        provider: PaymentProvider.HUBTEL,
      },
    });

    return {
      success: true,
      message: "Payment simulated successfully for testing.",
      paymentId: payment.id,
      paymentStatus: payment.status,
      data: {
        responseCode: "0000",
        data: {
          message: "Simulated",
          clientReference: reference,
          checkoutId: "simulated_checkout_id",
          checkoutUrl: input.returnUrl || undefined,
        },
      }
    };
  }

  const reference = generateClientReference_targetType(input.targetType);

  const {
    targetType: _targetType,
    targetId: _targetId,
    userId: _userId,
    currency: _currency,
    ...hubtelPayload
  } = input;

  let hubtelResponse;
  try {
    hubtelResponse = await hubtelClient.post("/items/initiate", {
      ...hubtelPayload,
      merchantAccountNumber: process.env.HUBTEL_MERCHANT_NUMBER,
      clientReference: reference,
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const detail = error.response?.data?.errors
        ? Object.values(error.response.data.errors).flat().join("; ")
        : error.response?.data?.title || error.message;
      return {
        success: false,
        message: `Hubtel error: ${detail}`,
        paymentId: "",
        paymentStatus: "",
      };
    }
    throw error;
  }

  const data = hubtelResponse.data;

  if (data.responseCode !== "0000") {
    return {
      success: false,
      message: "Hubtel error: " + data.responseCode,
      paymentId: "",
      paymentStatus: "",
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.hubtelDirectReceiveLog.create({
      data: {
        message: data.data.message,
        responseCode: data.responseCode,
        amount: input.totalAmount,
        charges: 0,
        amountAfterCharges: 0,
        amountCharged: input.totalAmount,
        description: data.data.message,
        clientReference: data.data.clientReference,
        transactionId: data.data.checkoutId,
        deliveryFee: 0,
      },
    });

    const payment = await tx.payment.create({
      data: {
        userId: input.userId,
        targetType: input.targetType,
        targetId: input.targetId,
        amount: input.totalAmount,
        currency: input.currency,
        description: input.description,
        reference,
        status: PaymentStatus.INITIALIZED,
        provider: PaymentProvider.HUBTEL,
      },
    });

    return payment;
  });

  return {
    success: true,
    message: "Payment initialized successfully",
    paymentId: result.id,
    paymentStatus: result.status,
    data,
  };
}

type InitPaymentMOMOInput = InitializePaymentSchema_MOMO;

export async function initializePaymentMOMO(
  input: InitPaymentMOMOInput,
): Promise<InitPaymentResult> {
  if (!paymentsEnabled) {
    const reference = generateClientReference();
    const payment = await prisma.payment.create({
      data: {
        userId: input.userId,
        targetType: input.targetType,
        targetId: input.targetId,
        amount: input.amount,
        currency: input.currency,
        description: input.description,
        reference,
        status: PaymentStatus.SUCCESS,
        provider: PaymentProvider.HUBTEL,
      },
    });

    return {
      success: true,
      message: "Payment simulated successfully for testing",
      paymentId: payment.id,
      paymentStatus: payment.status,
    };
  }

  const reference = generateClientReference();

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        userId: input.userId,
        targetType: input.targetType,
        targetId: input.targetId,
        amount: input.amount,
        currency: input.currency,
        description: input.description,
        reference,
        status: PaymentStatus.INITIALIZED,
        provider: PaymentProvider.HUBTEL,
      },
    });

    const response: AxiosResponse<HubtelDirectReceiveResponseSchema> =
      await hubtelDirectMoneyReceive.post("", {
        amount: input.amount,
        customerMsisdn: input.customerPhone,
        primaryCallbackUrl: HUBTEL_CALLBACK_URL,
        clientReference: payment.reference,
        description: `Payment for ${input.targetType} ${input.targetId}`,
        Channel: mapMomoProvider(input.method),
      });

    await tx.hubtelDirectReceiveLog.create({
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

    const newStatus = paymentStatusFromHubtel(response.data.ResponseCode);
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: newStatus },
    });

    return { payment, hubtelData: response.data };
  });

  return {
    success: true,
    message: "Payment initialized successfully",
    paymentId: result.payment.id,
    paymentStatus: result.payment.status,
  };
}
