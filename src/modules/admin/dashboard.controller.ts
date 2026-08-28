import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import {
  PaymentStatus,
  VerificationStatus,
  VisaRequestStatus,
} from "../../../generated/prisma/client.js";
import { ok, fail } from "../../helpers/response.js";

const REVIEWABLE_VISA_STATUSES = [
  VisaRequestStatus.PENDING,
  VisaRequestStatus.READY_FOR_GIS_SUBMISSION,
  VisaRequestStatus.EXPEDITED_AIRPORT_PAYMENT_PENDING,
];

function monthBounds(offsetMonths: number): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - offsetMonths, 1);
  const to = new Date(now.getFullYear(), now.getMonth() - offsetMonths + 1, 1);
  return { from, to };
}

export class AdminDashboardController {
  /**
   * GET /admin/dashboard/summary — one round-trip for the console KPI cards.
   */
  async summary(req: Request, res: Response) {
    try {
      const thisMonth = monthBounds(0);
      const lastMonth = monthBounds(1);

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const startOf24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [
        bulkTours,
        customTours,
        pendingVisaRequests,
        totalRevenue,
        thisMonthRevenue,
        lastMonthRevenue,
        pendingReports,
        pendingProfileVerifications,
        failedPaymentsLast24h,
      ] = await Promise.all([
        prisma.tour_packages.count(),
        prisma.tourRequest.count(),
        prisma.visaOnArrivalRequest.count({
          where: { status: { in: REVIEWABLE_VISA_STATUSES } },
        }),
        prisma.payment.aggregate({
          where: { status: PaymentStatus.SUCCESS },
          _sum: { amount: true },
        }),
        prisma.payment.aggregate({
          where: {
            status: PaymentStatus.SUCCESS,
            createdAt: { gte: thisMonth.from, lt: thisMonth.to },
          },
          _sum: { amount: true },
        }),
        prisma.payment.aggregate({
          where: {
            status: PaymentStatus.SUCCESS,
            createdAt: { gte: lastMonth.from, lt: lastMonth.to },
          },
          _sum: { amount: true },
        }),
        prisma.userReport.count({ where: { status: "PENDING" } }),
        prisma.profileVerification.count({
          where: {
            OR: [
              { bioDataStatus: VerificationStatus.PENDING },
              { faceStatus: VerificationStatus.PENDING },
              { documentStatus: VerificationStatus.PENDING },
            ],
          },
        }),
        prisma.payment.count({
          where: { status: PaymentStatus.FAILED, createdAt: { gte: startOf24h } },
        }),
      ]);

      const lastMonthValue = lastMonthRevenue._sum.amount ?? 0;
      const thisMonthValue = thisMonthRevenue._sum.amount ?? 0;
      const momPercent =
        lastMonthValue > 0
          ? ((thisMonthValue - lastMonthValue) / lastMonthValue) * 100
          : thisMonthValue > 0
            ? 100
            : 0;

      return ok(res, {
        tours: {
          total: bulkTours + customTours,
          bulk: bulkTours,
          custom: customTours,
        },
        pendingVisaRequests,
        successfulPaymentsAmount: totalRevenue._sum.amount ?? 0,
        successfulPaymentsMoMPercent: Math.round(momPercent * 10) / 10,
        alerts: {
          pendingVisaRequests,
          pendingReports,
          pendingProfileVerifications,
          failedPaymentsLast24h,
        },
      });
    } catch (error) {
      console.error("Failed to build dashboard summary:", error);
      return fail(res, 500, "Failed to build dashboard summary");
    }
  }
}
