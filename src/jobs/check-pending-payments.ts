import cron from "node-cron";
import axios from "axios";
import { prisma } from "../config/prisma.js";
import {
  PaymentStatus,
  PaymentTargetType,
  VisaApprovalStatus,
  VisaRequestStatus,
} from "../../generated/prisma/client.js";
import { UserTourController } from "../Modules/tour-management/user-tour.controller.js";
import { hubtelStatusClient } from "../config/index.js";
import { UserVisaController } from "../Modules/visa-management/user-visa.controller.js";
import { convertUSDToGHS } from "../helpers/stringHelper.js";
import sendEmail from "../config/resend.config.js";

export const checkPendingPaymentsJob = () => {
  // Run every minute
  cron.schedule("* * * * *", async () => {
    try {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

      // Find all payments still pending and older than 30 minutes
      const pendingPayments = await prisma.payment.findMany({
        where: {
          status: PaymentStatus.PENDING,
          createdAt: { lte: thirtyMinutesAgo },
        },
      });

      if (pendingPayments.length === 0) return;

      // Run status checks in parallel
      await Promise.all(
        pendingPayments.map(async (payment) => {
          try {
            const { data: responseData } = await hubtelStatusClient(
              `?clientReference=${payment.reference}`,
            );

            const log = await prisma.hubtelDirectReceiveLog.create({
              data: {
                message: responseData.message,
                responseCode: responseData.responseCode,
                amount: responseData.data.amount,
                charges: responseData.data.charges,
                amountAfterCharges: responseData.data.amountAfterCharges,
                amountCharged: responseData.data.amountAfterCharges, // or responseData.data.amountCharged if provided
                description: responseData.data.status,
                clientReference: responseData.data.clientReference,
                transactionId: responseData.data.transactionId,
                externalTransactionId: responseData.data.externalTransactionId,
                orderId: null, // not present in status check response
                deliveryFee: responseData.data.deliveryFee ?? 0.0,
              },
            });

            // Update Payment status based on responseCode
            let newStatus: "SUCCESS" | "FAILED" | "PENDING";
            switch (responseData.data.status) {
              case "Paid":
                newStatus = "SUCCESS";
                break;
              case "Unpaid":
                newStatus = "PENDING";
                break;
              case "Refunded":
              default:
                newStatus = "FAILED";
                break;
            }

            await prisma.payment.update({
              where: { reference: responseData.data.clientReference },
              data: { status: newStatus },
            });

            const booking = await prisma.tour_bookings.update({
              where: { paymentId: payment.id },
              data: { paymentStatus: newStatus },
            });

            const { data } = responseData;
            const target = data.clientReference.split("-")[1];

            const visaRequest = await prisma.visaOnArrivalRequest.findUnique({
              where: { paymentId: payment.id },
              select: { packageType: true },
            });

            if (!visaRequest)
              throw new Error(
                "No visa request found with payment id " + payment.id,
              );

            if (newStatus === "SUCCESS") {
              if (target == PaymentTargetType.VISA_ON_ARRIVAL) {
                if (visaRequest.packageType === "STANDARD") {
                  // Ledger Split
                  await prisma.ledgerTransaction.createMany({
                    data: [
                      {
                        accountId: await UserVisaController.getAccountId(
                          "Account_DAGh_Revenue",
                        ),
                        paymentId: payment.id,
                        amount: 464,
                        currency: "GHS",
                        type: "CREDIT",
                        description: "Visa Facilitation Fee",
                      },
                      {
                        accountId: await UserVisaController.getAccountId(
                          "Account_GIS_Statutory_Reserve",
                        ),
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
                      accountId: await UserVisaController.getAccountId(
                        "Account_DAGh_Revenue",
                      ),
                      paymentId: payment.id,
                      amount: 1450,
                      currency: "GHS",
                      type: "CREDIT",
                      description: "Expedited Visa Facilitation Fee",
                    },
                  });

                  await prisma.visaOnArrivalRequest.update({
                    where: { paymentId: payment.id },
                    data: { status: "EXPEDITED_AIRPORT_PAYMENT_PENDING" },
                  });

                  const user = await prisma.user.findUnique({
                    where: { id: payment.userId },
                  });

                  await sendEmail({
                    email: user?.email as string,
                    subject: "Visa request payment confirmation",
                    html: `<p>Dear ${user?.fullName as string},</p>
              <p>You are required to pay the statutory $200 USD fee directly to GIS at Kotoka International Airport upon arrival.</p>
              <p>Thank you for choosing our tour!</p>`,
                  });
                }

                const log = await prisma.hubtelDirectReceiveLog.create({
                  data: {
                    message: data.data.status,
                    responseCode: responseData.responseCode,
                    amount: data.Amount,
                    charges: 0,
                    amountAfterCharges: data.charges,
                    amountCharged: data.amount,
                    description: data.paymentMethod,
                    clientReference: data.ClientReference,
                    transactionId: data.transactionId,
                    deliveryFee: 0,
                  },
                });
              } else {
                if (target == PaymentTargetType.VISA_ON_ARRIVAL) {
                  await prisma.visaOnArrivalRequest.update({
                    where: { paymentId: payment.id },
                    data: { status: VisaRequestStatus.PAYMENT_FAILED },
                  });

                  await prisma.payment.update({
                    where: { id: payment.id },
                    data: { status: PaymentStatus.FAILED },
                  });

                  const log = await prisma.hubtelDirectReceiveLog.create({
                    data: {
                      message: data.data.status,
                      responseCode: responseData.responseCode,
                      amount: data.Amount,
                      charges: 0,
                      amountAfterCharges: data.charges,
                      amountCharged: data.amount,
                      description: data.paymentMethod,
                      clientReference: data.ClientReference,
                      transactionId: data.transactionId,
                      deliveryFee: 0,
                    },
                  });
                }
              }
            }
          } catch (error) {
            console.error(
              "[Cron Job Error] Failed to check pending payments:",
              error,
            );
          }
        }),
      );

      console.log("✓ Pending payments status check cron job initialized");
    } catch (e) {
      console.error(
        "[Cron Job Error] Failed to check pending payments:",
        e,
      );
    }
  });
};
