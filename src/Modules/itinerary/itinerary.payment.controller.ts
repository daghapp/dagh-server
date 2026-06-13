import { Request, Response } from "express";
import { prisma, hubtelClient } from "../../config/index.js";
import {
  HUBTEL_CALLBACK_URL,
  HUBTEL_CANCELLATION_URL,
  HUBTEL_RETURN_URL,
  PaymentController,
} from "../payment-management/payment.controller.js";
import {
  PaymentStatus,
  PaymentTargetType,
} from "../../../generated/prisma/client.js";
import { randomUUID } from "crypto";
import sendEmail from "../../config/resend.config.js";

export class ItineraryPaymentController {
  async initiateItineraryPayment(req: Request, res: Response) {
    try {
      const userId = req.user?.id as string;
      const { tourRequestId } = req.params;

      const tourRequest = await prisma.tourRequest.findUnique({
        where: { id: tourRequestId as string},
        select: { id: true, userId: true, durationDays: true },
      });

      if (!tourRequest) {
        return res.status(404).json({ success: false, message: "Tour request not found" });
      }
      if (tourRequest.userId !== userId) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }

      const amount = tourRequest.durationDays <= 4 ? 350 : 500;

      const payment: any = await PaymentController.initializePayment({
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
        return res.status(400).json({ success: false, message: payment.message });
      }

      // PaymentController.initializePayment returns { paymentId } (string) but TS types are unstable in this repo.
      // Extract a guaranteed string for Prisma.
      const rawPaymentIdFromPaymentId = (payment as any).paymentId;
      const rawPaymentIdFromId = (payment as any).id;

      const rawPaymentId: unknown = rawPaymentIdFromPaymentId ?? rawPaymentIdFromId;

      let paymentId: string;
      if (typeof rawPaymentId === "string") {
        paymentId = rawPaymentId;
      } else if (Array.isArray(rawPaymentId) && typeof rawPaymentId[0] === "string") {
        paymentId = rawPaymentId[0];
      } else {
        return res.status(400).json({
          success: false,
          message: "Failed to get paymentId from payment initialization response",
        });
      }

      await prisma.tourRequest.update({
        where: { id: tourRequest.id },
        data: {
          paymentStatus: "PENDING",
          paymentId,
        },
      });

      return res.status(200).json({
        success: true,
        message: "Payment initiated. Proceed to complete payment to view itinerary.",
        tourRequestId: tourRequest.id,
        paymentId,
        paymentData: (payment as any).data,
      });
    } catch (e) {
      console.error("[initiateItineraryPayment]", e);
      return res.status(500).json({ success: false, message: "Failed to initiate payment" });
    }
  }

  async handleHubtelPaymentCallback(req: Request, res: Response) {
    try {
      const payload = req.body;
      const { ResponseCode, Status, Data } = payload as any;

      const rawClientReference = Data?.ClientReference;
      const clientReference: string | undefined =
        typeof rawClientReference === "string"
          ? rawClientReference
          : Array.isArray(rawClientReference)
            ? (rawClientReference[0] as string | undefined)
            : undefined;

      if (!clientReference) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid callback payload" });
      }

      const payment = await prisma.payment.findUnique({
        where: { reference: clientReference },
      });

      if (!payment) {
        return res.status(404).json({ success: false, message: "Payment not found" });
      }

      const tourRequest = await prisma.tourRequest.findUnique({
        where: { paymentId: payment.id },
        include: { user: true },
      });

      if (!tourRequest) {
        return res.status(404).json({ success: false, message: "Tour request not found" });
      }

      const isSuccess = Status === "SUCCESS" || ResponseCode === "0000";

      if (isSuccess) {
        await prisma.tourRequest.update({
          where: { id: tourRequest.id },
          data: { paymentStatus: "SUCCESS" },
        });

        // itinerary generation happens in itinerary.service during getItinerary
        // (to keep callback lightweight and consistent)
        return res.json({ success: true });
      }

      await prisma.tourRequest.update({
        where: { id: tourRequest.id },
        data: { paymentStatus: "FAILED" },
      });

      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED },
      });

      return res.json({ success: true });
    } catch (e) {
      console.error("[itinerary payment callback]", e);
      return res.status(500).json({ success: false, message: "Failed to handle callback" });
    }
  }
}
