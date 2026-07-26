import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { HUBTEL_CANCELLATION_URL, HUBTEL_RETURN_URL } from "../../services/payment.service.js";
import * as paymentService from "../../services/payment.service.js";
import {
  PaymentStatus,
  PaymentTargetType,
  VisaRequestStatus,
} from "../../../generated/prisma/client.js";
import { VisaOnArrivalDataSchema } from "../../validator/visaValidation.js";
import { convertUSDToGHS } from "../../helpers/stringHelper.js";
import sendEmail from "../../config/resend.config.js";
import { getAccountId } from "../../helpers/ledger.js";
import { pricing } from "../../config/pricing.js";
import { ok, created, fail } from "../../helpers/response.js";

export class UserVisaController {
  async createVisaRequest(req: Request, res: Response) {
    try {
      const userId = req.user?.id as string;
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        return fail(res, 404, "User not found");
      }

      const applicantData = req.body as VisaOnArrivalDataSchema;

      const visaRequest = await prisma.visaOnArrivalRequest.create({
        data: {
          userId,
          status: "PENDING",
        },
      });

      await prisma.visaOnArrivalData.create({
        data: {
          ...applicantData,
          requestId: visaRequest.id,
        },
      });

      return created(res, visaRequest);
    } catch (err) {
      console.error("failed to create visa request ", err);
      return fail(res, 400, "Failed to create visa request");
    }
  }

  async initiateVisaPayment(req: Request, res: Response) {
    try {
      const { requestId } = req.params;
      const { packageType } = req.body as { packageType: "STANDARD" | "EXPEDITED" };

      const visaRequest = await prisma.visaOnArrivalRequest.findUnique({
        where: { id: requestId as string },
        include: { visaData: true },
      });

      if (!visaRequest) {
        return fail(res, 404, "Visa request not found");
      }

      let totalAmount = 0;
      if (packageType === "STANDARD") {
        const statutoryFeeGHS = await convertUSDToGHS(pricing.visa.statutoryFeeUSD);
        totalAmount = pricing.visa.standardFacilitationFee + statutoryFeeGHS;
      } else if (packageType === "EXPEDITED") {
        totalAmount = pricing.visa.expeditedFacilitationFee;
      }

      const payment = await paymentService.initializePayment({
        userId: visaRequest.userId,
        targetType: PaymentTargetType.VISA_ON_ARRIVAL,
        targetId: visaRequest.id,
        totalAmount: totalAmount,
        currency: "GHS",
        description: `Visa on Arrival - ${packageType}`,
        callbackUrl: `${process.env.API_URL}/visa-request/payment-callback`,
        returnUrl: HUBTEL_RETURN_URL || "",
        cancellationUrl: HUBTEL_CANCELLATION_URL,
      });

      await prisma.visaOnArrivalRequest.update({
        where: { id: requestId as string },
        data: { paymentId: payment.paymentId, packageType },
      });

      return ok(res, { visaRequest, payment });
    } catch (err) {
      console.error("failed to initiate visa payment ", err);
      return fail(res, 400, "Failed to initiate visa payment");
    }
  }

  async handleVisaPaymentCallback(req: Request, res: Response) {
    try {
      const payload = req.body;

      const { Status, Data } = payload;

      const payment = await prisma.payment.findUnique({
        where: { reference: Data.ClientReference },
      });
      if (!payment) return fail(res, 404, "Payment not found");

      const visaRequest = await prisma.visaOnArrivalRequest.findUnique({
        where: { paymentId: payment.id },
        select: { packageType: true },
      });

      if (!visaRequest) {
        return fail(res, 404, "Visa request not found");
      }

      if (Status === "SUCCESS") {
        if (visaRequest.packageType === "STANDARD") {
          await prisma.ledgerTransaction.createMany({
            data: [
              {
                accountId: await getAccountId("Account_DAGh_Revenue"),
                paymentId: payment.id,
                amount: pricing.visa.standardFacilitationFee,
                currency: "GHS",
                type: "CREDIT",
                description: "Visa Facilitation Fee",
              },
              {
                accountId: await getAccountId("Account_GIS_Statutory_Reserve"),
                paymentId: payment.id,
                amount: await convertUSDToGHS(200),
                currency: "GHS",
                type: "CREDIT",
                description: "Statutory GIS Fee Reserve",
              },
            ],
          });

          await prisma.visaOnArrivalRequest.update({
            where: { paymentId: payment.id },
            data: { status: "READY_FOR_GIS_SUBMISSION" },
          });
        }

        if (visaRequest.packageType === "EXPEDITED") {
          await prisma.ledgerTransaction.create({
            data: {
              accountId: await getAccountId("Account_DAGh_Revenue"),
              paymentId: payment.id,
              amount: pricing.visa.expeditedFacilitationFee,
              currency: "GHS",
              type: "CREDIT",
              description: "Expedited Visa Facilitation Fee",
            },
          });

          await prisma.visaOnArrivalRequest.update({
            where: { paymentId: payment.id },
            data: { status: "EXPEDITED_AIRPORT_PAYMENT_PENDING" },
          });

          await sendEmail({
            email: req.user?.email as string,
            subject: "Visa request payment confirmation",
            html: `<p>Dear ${req.user?.fullName as string},</p>
                <p>You are required to pay the statutory $200 USD fee directly to GIS at Kotoka International Airport upon arrival.</p>
                <p>Thank you for choosing our tour!</p>`,
          });
        }

        await prisma.hubtelDirectReceiveLog.create({
          data: {
            message: Data.Description,
            responseCode: Data.responseCode,
            amount: Data.Amount,
            charges: 0,
            amountAfterCharges: 0,
            amountCharged: Data.Amount,
            description: Data.Description,
            clientReference: Data.ClientReference,
            transactionId: Data.SalesInvoiceId,
            deliveryFee: 0,
            paymentDetails: Data.paymentDetails,
          },
        });
      } else {
        await prisma.visaOnArrivalRequest.update({
          where: { paymentId: payment.id },
          data: { status: VisaRequestStatus.PAYMENT_FAILED },
        });

        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.FAILED },
        });

        await prisma.hubtelDirectReceiveLog.create({
          data: {
            message: Data.Description,
            responseCode: Data.responseCode,
            amount: Data.Amount,
            charges: 0,
            amountAfterCharges: 0,
            amountCharged: Data.Amount,
            description: Data.Description,
            clientReference: Data.ClientReference,
            transactionId: Data.SalesInvoiceId,
            deliveryFee: 0,
            paymentDetails: Data.paymentDetails,
          },
        });
      }

      res.json({ success: true });
    } catch (e) {
      console.error("visa callback failed ", e);
      return fail(res, 500, "Failed to handle callback");
    }
  }

  async getVisaRequest(req: Request, res: Response) {
    try {
      const user = req.user?.id as string;
      const visaRequest = await prisma.visaOnArrivalRequest.findMany({
        where: { userId: user },
        include: {
          visaData: true,
        },
      });
      return ok(res, visaRequest);
    } catch (error) {
      console.error("Failed to get visa requests ", error);
      return fail(res, 500, "Failed to get visa request");
    }
  }

  async getVisaStatus(req: Request, res: Response) {
    try {
      const userId = req.user?.id as string;
      const { requestId: visaRequestId } = req.params;
      if (!visaRequestId) return fail(res, 400, "visaRequest id required");

      const visaRequest = await prisma.visaOnArrivalRequest.findFirst({
        where: { userId, id: visaRequestId as string },
        select: { status: true },
      });
      return ok(res, visaRequest);
    } catch (e) {
      console.error("Failed to get visa status ", e);
      return fail(res, 500, "Failed to get visa status");
    }
  }

  async getVisaPricing(req: Request, res: Response) {
    try {
      const visaTypeRaw = req.params.visaType;
      const visaType = Array.isArray(visaTypeRaw) ? visaTypeRaw[0] : visaTypeRaw;

      const visaPricingMap: Record<string, Array<{ key: string; value: number }>> = {
        STANDARD: [
          { key: "Visa Facilitation Fee", value: pricing.visa.standardFacilitationFee },
          { key: "Statutory GIS Fee (USD 200)", value: 0 },
        ],
        EXPEDITED: [
          { key: "Expedited Visa Facilitation Fee", value: pricing.visa.expeditedFacilitationFee },
        ],
      };

      const visaPricing = visaPricingMap[visaType?.toUpperCase()];

      if (!visaPricing) {
        return fail(res, 400, `Pricing not available for visa type: ${visaType}`);
      }

      return ok(res, { visaType: visaType?.toUpperCase(), pricing: visaPricing });
    } catch (error) {
      console.error("Error fetching visa pricing:", error);
      return fail(
        res,
        500,
        "Failed to fetch visa pricing",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }
}
