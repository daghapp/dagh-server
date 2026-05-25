import cron from "node-cron";
import axios from "axios";
import { prisma } from "../config/prisma";
import { PaymentStatus } from "@prisma/client";
import { UserTourController } from "src/Modules/tour-management/user-tour.controller";
import { hubtelStatusClient } from "src/config";

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
            const {data:responseData } = await hubtelStatusClient(
              `?clientReference=${payment.reference}`
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
     
    if (newStatus === 'SUCCESS')
    await UserTourController.copyItineraryToUserTables(payment.userId, booking.id, payment.targetId);

            console.log(
              `[${new Date().toISOString()}] Payment ${payment.reference} status updated to ${newStatus}`
            );
          } catch (err:any) {
            let message = err?.message ?? "Unknown error"
            console.error(
              `[Cron Job Error] Failed to check status for payment ${payment.reference}:`,
              err?.message 
            );
          }
        })
      );
    } catch (error) {
      console.error("[Cron Job Error] Failed to check pending payments:", error);
    }
  });

  console.log("✓ Pending payments status check cron job initialized");
};