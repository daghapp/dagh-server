import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { HUBTEL_CANCELLATION_URL, HUBTEL_RETURN_URL } from "../../services/payment.service.js";
import * as paymentService from "../../services/payment.service.js";
import { PaymentStatus, PaymentTargetType } from "../../../generated/prisma/client.js";
import { getAccountId } from "../../helpers/ledger.js";
import { ok, fail } from "../../helpers/response.js";
import { pricing } from "../../config/pricing.js";

export class ItineraryPaymentController {
  async initiateItineraryPayment(req: Request, res: Response) {
    try {
      const userId = req.user?.id as string;
      const { tourRequestId } = req.params;

      const tourRequest = await prisma.tourRequest.findUnique({
        where: { id: tourRequestId as string },
        select: { id: true, userId: true, durationDays: true },
      });

      if (!tourRequest) {
        return fail(res, 404, "Tour request not found");
      }
      if (tourRequest.userId !== userId) {
        return fail(res, 403, "Forbidden");
      }

      const amount =
        tourRequest.durationDays <= 4
          ? pricing.itinerary.shortItineraryFee
          : pricing.itinerary.longItineraryFee;

      const payment = await paymentService.initializePayment({
        userId,
        targetType: PaymentTargetType.TOUR_REQUEST,
        targetId: tourRequest.id,
        totalAmount: amount,
        currency: "GHS",
        description: `Payment for itinerary - ${tourRequest.id}`,
        callbackUrl: `${process.env.API_URL}/itinerary/payment-callback`,
        returnUrl: HUBTEL_RETURN_URL || "",
        cancellationUrl: HUBTEL_CANCELLATION_URL || "",
      });

      if (!payment.success) {
        return fail(res, 400, payment.message);
      }

      const paymentId = payment.paymentId;

      // Hubtel checkout data lives two levels deep in the raw response, so lift
      // the checkout URL (and its identifiers) to the top level of the response —
      // consistent with the membership checkout flow — so the frontend can
      // immediately redirect the user to the payment page.
      const checkoutData = payment.data?.data;
      const checkoutUrl = checkoutData?.checkoutUrl;

      if (!checkoutUrl || typeof checkoutUrl !== "string" || checkoutUrl.trim() === "") {
        console.error("[initiateItineraryPayment] Hubtel did not return a checkout URL", {
          responseCode: payment.data?.responseCode,
          checkoutId: checkoutData?.checkoutId,
        });
        return fail(
          res,
          502,
          "Payment provider could not create a checkout. Please try again.",
        );
      }

      await prisma.tourRequest.update({
        where: { id: tourRequest.id },
        data: {
          paymentStatus: "PENDING",
          paymentId,
        },
      });

      return ok(
        res,
        {
          tourRequestId: tourRequest.id,
          paymentId,
          checkoutUrl,
          checkoutId: checkoutData?.checkoutId ?? null,
          clientReference: checkoutData?.clientReference ?? null,
          paymentData: payment.data,
        },
        "Payment initiated. Proceed to complete payment to view itinerary.",
      );
    } catch (e) {
      console.error("[initiateItineraryPayment]", e);
      return fail(res, 500, "Failed to initiate payment");
    }
  }

  async handleHubtelPaymentCallback(req: Request, res: Response) {
    try {
      const payload = req.body;
      const { ResponseCode, Status, Data } = payload;

      const rawClientReference = Data?.ClientReference;
      const clientReference: string | undefined =
        typeof rawClientReference === "string"
          ? rawClientReference
          : Array.isArray(rawClientReference)
            ? (rawClientReference[0] as string | undefined)
            : undefined;

      if (!clientReference) {
        return fail(res, 400, "Invalid callback payload");
      }

      const payment = await prisma.payment.findUnique({
        where: { reference: clientReference },
      });

      if (!payment) {
        return fail(res, 404, "Payment not found");
      }

      const tourRequest = await prisma.tourRequest.findUnique({
        where: { paymentId: payment.id },
        include: { user: true },
      });

      if (!tourRequest) {
        return fail(res, 404, "Tour request not found");
      }

      const isSuccess = Status === "SUCCESS" || ResponseCode === "0000";

      if (isSuccess) {
        await prisma.tourRequest.update({
          where: { id: tourRequest.id },
          data: { paymentStatus: "SUCCESS" },
        });

        // keep Payment table in sync with successful Hubtel callback
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.SUCCESS },
        });

        // ledger entry for itinerary payment
        // (mirrors visa callback behavior; uses DAGh revenue account)
        await prisma.ledgerTransaction.create({
          data: {
            accountId: await getAccountId("Account_DAGh_Revenue"),
            paymentId: payment.id,
            amount: typeof Data?.Amount === "number" ? Data.Amount : payment.amount,
            currency: "GHS",
            type: "CREDIT",
            description: "Itinerary Facilitation Fee",
          },
        });

        // log all Hubtel callback data
        await prisma.hubtelDirectReceiveLog.create({
          data: {
            message: Data?.Description,
            responseCode: Data?.responseCode,
            amount: Data?.Amount,
            charges: 0,
            amountAfterCharges: 0,
            amountCharged: Data?.Amount,
            description: Data?.Description,
            clientReference: Data?.ClientReference,
            transactionId: Data?.SalesInvoiceId,
            deliveryFee: 0,
            paymentDetails: Data?.paymentDetails,
          },
        });

        // itinerary generation happens in itinerary.service during getItinerary
        // (to keep callback lightweight and consistent)
        return ok(res, null, "Callback processed successfully");
      }

      await prisma.tourRequest.update({
        where: { id: tourRequest.id },
        data: { paymentStatus: "FAILED" },
      });

      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED },
      });

      // log all Hubtel callback data (failure case)
      await prisma.hubtelDirectReceiveLog.create({
        data: {
          message: Data?.Description,
          responseCode: Data?.responseCode,
          amount: Data?.Amount,
          charges: 0,
          amountAfterCharges: 0,
          amountCharged: Data?.Amount,
          description: Data?.Description,
          clientReference: Data?.ClientReference,
          transactionId: Data?.SalesInvoiceId,
          deliveryFee: 0,
          paymentDetails: Data?.paymentDetails,
        },
      });

      return ok(res, null, "Callback processed successfully");
    } catch (e) {
      console.error("[itinerary payment callback]", e);
      return fail(res, 500, "Failed to handle callback");
    }
  }
}
