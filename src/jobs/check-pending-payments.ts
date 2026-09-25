import cron from "node-cron";
import { prisma } from "../config/prisma.js";
import {
  PaymentStatus,
  PaymentTargetType,
  VisaRequestStatus,
} from "../../generated/prisma/client.js";
import { getHubtelStatusClient } from "../config/hubtel.js";
import { convertUSDToGHS } from "../helpers/stringHelper.js";
import sendEmail from "../config/resend.config.js";
import { getAccountId } from "../helpers/ledger.js";
// Phase 2.4 — Replace hardcoded amounts (464, 1450, 200) with env-driven pricing config
import { pricing } from "../config/pricing.js";
import { withDistributedLock, tryAcquireWorkItem } from "../helpers/jobLock.js";
import { settleMembershipPayment } from "../services/membership.service.js";
import { SubscriptionStatus } from "../../generated/prisma/client.js";

const JOB_LOCK_TTL_MS = 15 * 60 * 1000;
const ITEM_CLAIM_TTL_MS = 10 * 60 * 1000;

/**
 * Reconciles stale Hubtel payments against the provider.
 *
 * Runs every 5 minutes under a distributed lock so only one instance executes
 * it at a time. Each payment is claimed atomically in Redis so a slow run
 * (longer than the lock TTL) or a crash between runs can't double-process.
 * All DB writes for one payment happen in a single transaction, and ledger
 * entries are guarded so a crashed run doesn't create duplicates.
 */
export const checkPendingPaymentsJob = () => {
  console.log("✓ Pending payments status check cron job initialized (every 5 min)");
  cron.schedule("*/5 * * * *", async () => {
    await withDistributedLock("check-pending-payments", JOB_LOCK_TTL_MS, async () => {
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

        await Promise.all(
          pendingPayments.map(async (payment) => {
            const claimed = await tryAcquireWorkItem(`payment:${payment.id}`, ITEM_CLAIM_TTL_MS);
            if (!claimed) return;

            try {
              const hubtelStatusClient = await getHubtelStatusClient();
              const { data: responseData } = await hubtelStatusClient(
                `?clientReference=${payment.reference}`,
              );

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

              const emailTarget =
                newStatus === "SUCCESS" && payment.targetType === PaymentTargetType.VISA_ON_ARRIVAL
                  ? payment
                  : null;

              await prisma.$transaction(async (tx) => {
                await tx.hubtelDirectReceiveLog.create({
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

                await tx.payment.update({
                  where: { reference: responseData.data.clientReference },
                  data: { status: newStatus },
                });

                // Update tour booking if this payment is linked to one (may not exist for visa payments)
                try {
                  await tx.tour_bookings.update({
                    where: { paymentId: payment.id },
                    data: { paymentStatus: newStatus },
                  });
                } catch {
                  // Not a tour booking — continue to check other target types
                }

                const target = payment.targetType;

                if (newStatus === "SUCCESS") {
                  if (target === PaymentTargetType.VISA_ON_ARRIVAL) {
                    const visaRequest = await tx.visaOnArrivalRequest.findUnique({
                      where: { paymentId: payment.id },
                      select: { packageType: true },
                    });

                    if (!visaRequest)
                      throw new Error("No visa request found with payment id " + payment.id);

                    // Idempotency guard: never double-credit the ledger, even if a
                    // previous run crashed after creating entries.
                    const existingEntries = await tx.ledgerTransaction.findMany({
                      where: { paymentId: payment.id },
                      select: { id: true },
                    });

                    if (visaRequest.packageType === "STANDARD") {
                      // Ledger Split
                      if (existingEntries.length === 0) {
                        await tx.ledgerTransaction.createMany({
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
                      }

                      await tx.visaOnArrivalRequest.update({
                        where: { paymentId: payment.id },
                        data: { status: "READY_FOR_GIS_SUBMISSION" },
                      });
                    }

                    if (visaRequest.packageType === "EXPEDITED") {
                      if (existingEntries.length === 0) {
                        await tx.ledgerTransaction.create({
                          data: {
                            accountId: await getAccountId("Account_DAGh_Revenue"),
                            paymentId: payment.id,
                            amount: pricing.visa.expeditedFacilitationFee,
                            currency: "GHS",
                            type: "CREDIT",
                            description: "Expedited Visa Facilitation Fee",
                          },
                        });
                      }

                      await tx.visaOnArrivalRequest.update({
                        where: { paymentId: payment.id },
                        data: { status: "EXPEDITED_AIRPORT_PAYMENT_PENDING" },
                      });
                    }
                  }
                } else {
                  // Payment failed or refunded
                  if (target === PaymentTargetType.VISA_ON_ARRIVAL) {
                    await tx.visaOnArrivalRequest.update({
                      where: { paymentId: payment.id },
                      data: { status: VisaRequestStatus.PAYMENT_FAILED },
                    });
                  }
                }
              });

              // Membership subscription payment settled via the provider —
              // activate/upgrade the user's subscription idempotently.
              if (
                newStatus === "SUCCESS" &&
                payment.targetType === PaymentTargetType.MEMBERSHIP_SUBSCRIPTION
              ) {
                await settleMembershipPayment(payment);
              } else if (
                newStatus !== "SUCCESS" &&
                payment.targetType === PaymentTargetType.MEMBERSHIP_SUBSCRIPTION
              ) {
                await prisma.userSubscription.updateMany({
                  where: {
                    userId: payment.userId,
                    status: SubscriptionStatus.PAYMENT_PENDING,
                  },
                  data: { status: SubscriptionStatus.PAYMENT_FAILED },
                });
              }

              // Send notification emails after the transaction commits.
              if (emailTarget) {
                const user = await prisma.user.findUnique({
                  where: { id: payment.userId },
                });

                if (user) {
                  const visaRequest = await prisma.visaOnArrivalRequest.findUnique({
                    where: { paymentId: payment.id },
                    select: { packageType: true },
                  });

                  if (visaRequest?.packageType === "EXPEDITED") {
                    await sendEmail({
                      email: user.email,
                      subject: "Visa request payment confirmation",
                      html: `<p>Dear ${user.fullName},</p>
                <p>You are required to pay the statutory $200 USD fee directly to GIS at Kotoka International Airport upon arrival.</p>
                <p>Thank you for choosing our tour!</p>`,
                    });
                  }
                }
              }
            } catch (error) {
              console.error("[Cron Job Error] Failed to check pending payments:", error);
            }
          }),
        );
      } catch (e) {
        console.error("[Cron Job Error] Failed to check pending payments:", e);
      }
    });
  });
};
