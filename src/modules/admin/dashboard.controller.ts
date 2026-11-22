import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { PaymentStatus, VerificationStatus } from "../../../generated/prisma/client.js";
import { ok, fail } from "../../helpers/response.js";
import { isPaymentsEnabled } from "../../config/payments.js";

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
        totalRevenue,
        thisMonthRevenue,
        lastMonthRevenue,
        pendingReports,
        pendingProfileVerifications,
        failedPaymentsLast24h,
        totalUsers,
        activeDestinations,
        successfulPayments,
        activeSubscriptions,
        suspendedUsers,
        pendingUserApprovals,
        ngoAccessRequests,
        datingProfilesInReview,
        thisMonthUsers,
        lastMonthUsers,
        recentActivity,
        maintenanceWindow,
      ] = await Promise.all([
        prisma.tour_packages.count(),
        prisma.tourRequest.count(),
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
        prisma.user.count({ where: { isDeleted: false } }),
        prisma.tour_packages.count({ where: { status: "published" } }),
        prisma.payment.count({ where: { status: PaymentStatus.SUCCESS } }),
        prisma.userSubscription.count({ where: { status: "ACTIVE" } }),
        prisma.user.count({ where: { accountStatus: "SUSPENDED", isDeleted: false } }),
        prisma.user.count({ where: { accountStatus: "PENDING", isDeleted: false } }),
        prisma.ngoAccessRequest.count({ where: { status: "PENDING" } }),
        prisma.datingApplication.count({ where: { status: "PENDING" } }),
        prisma.user.count({
          where: { createdAt: { gte: thisMonth.from, lt: thisMonth.to }, isDeleted: false },
        }),
        prisma.user.count({
          where: { createdAt: { gte: lastMonth.from, lt: lastMonth.to }, isDeleted: false },
        }),
        prisma.adminActivityLog.findMany({
          include: { actor: { select: { id: true, fullName: true, email: true } } },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
        prisma.maintenanceWindow.findFirst({
          where: { active: true },
          orderBy: { startedAt: "desc" },
          select: { modules: true, message: true },
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

      const usersMoMPercent =
        lastMonthUsers > 0
          ? ((thisMonthUsers - lastMonthUsers) / lastMonthUsers) * 100
          : thisMonthUsers > 0
            ? 100
            : 0;

      const paymentsEnabled = await isPaymentsEnabled().catch(() => true);
      const maintenanceModules = Array.isArray(maintenanceWindow?.modules)
        ? (maintenanceWindow.modules as string[])
        : [];

      return ok(res, {
        tours: {
          total: bulkTours + customTours,
          bulk: bulkTours,
          custom: customTours,
        },
        pendingVisaRequests: 0,
        successfulPaymentsAmount: totalRevenue._sum.amount ?? 0,
        successfulPaymentsMoMPercent: Math.round(momPercent * 10) / 10,
        alerts: {
          pendingVisaRequests: 0,
          pendingReports,
          pendingProfileVerifications,
          failedPaymentsLast24h,
        },
        // §3.3 KPI cards.
        kpis: {
          totalUsers,
          activeDestinations,
          successfulPayments,
          activeSubscriptions,
          pendingVerifications: pendingProfileVerifications,
          suspendedUsers,
          ngoAccessRequests,
          datingProfilesInReview,
        },
        trends: {
          paymentsMoMPercent: Math.round(momPercent * 10) / 10,
          usersMoMPercent: Math.round(usersMoMPercent * 10) / 10,
          registrationsThisMonth: thisMonthUsers,
        },
        moduleStatus: {
          payments: paymentsEnabled ? "operational" : "maintenance",
          maintenance: maintenanceModules,
        },
        actionCounts: {
          pendingApprovals: pendingUserApprovals,
          failedPaymentsLast24h,
          pendingReports,
          pendingNgoRequests: ngoAccessRequests,
        },
        recentActivity,
      });
    } catch (error) {
      console.error("Failed to build dashboard summary:", error);
      return fail(res, 500, "Failed to build dashboard summary");
    }
  }

  /**
   * GET /admin/dashboard/charts?range=3m|6m|1y — registrations + payment-status
   * series for the dashboard charts.
   */
  async charts(req: Request, res: Response) {
    try {
      const range = req.query.range === "1y" ? 12 : req.query.range === "6m" ? 6 : 3;
      const months: { key: string; from: Date; to: Date }[] = [];
      const now = new Date();
      for (let i = range - 1; i >= 0; i--) {
        const from = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const to = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        months.push({
          key: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}`,
          from,
          to,
        });
      }
      const series = await Promise.all(
        months.map(async (m) => {
          const [registrations, success, failed, pending] = await Promise.all([
            prisma.user.count({ where: { createdAt: { gte: m.from, lt: m.to } } }),
            prisma.payment.count({
              where: { status: PaymentStatus.SUCCESS, createdAt: { gte: m.from, lt: m.to } },
            }),
            prisma.payment.count({
              where: { status: PaymentStatus.FAILED, createdAt: { gte: m.from, lt: m.to } },
            }),
            prisma.payment.count({
              where: { status: PaymentStatus.PENDING, createdAt: { gte: m.from, lt: m.to } },
            }),
          ]);
          return { month: m.key, registrations, payments: { success, failed, pending } };
        }),
      );
      return ok(res, { range: req.query.range ?? "3m", series });
    } catch (error) {
      console.error("Failed to build dashboard charts:", error);
      return fail(res, 500, "Failed to build dashboard charts");
    }
  }

  /**
   * GET /admin/dashboard/recent-activity?limit= — latest admin activity rows.
   */
  async recentActivity(req: Request, res: Response) {
    try {
      const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) || "20", 10)));
      const rows = await prisma.adminActivityLog.findMany({
        include: { actor: { select: { id: true, fullName: true, email: true } } },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return ok(res, rows);
    } catch (error) {
      console.error("Failed to load recent activity:", error);
      return fail(res, 500, "Failed to load recent activity");
    }
  }

  /**
   * GET /admin/users/verified — paginated list of verified users with their
   * names/contact details, plus a verified count and overall total.
   */
  async verifiedUsers(req: Request, res: Response) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
      const skip = (page - 1) * limit;

      const [verifications, verifiedCount, totalUsers] = await Promise.all([
        prisma.profileVerification.findMany({
          where: { isVerified: true },
          include: {
            userProfile: {
              include: {
                user: {
                  select: {
                    id: true,
                    fullName: true,
                    email: true,
                    phoneNumber: true,
                    accountStatus: true,
                    createdAt: true,
                  },
                },
              },
            },
          },
          orderBy: { lastUpdatedAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.profileVerification.count({ where: { isVerified: true } }),
        prisma.user.count(),
      ]);

      const data = verifications.map((v) => ({
        id: v.id,
        isVerified: v.isVerified,
        verifiedAt: v.lastUpdatedAt,
        phoneVerified: v.phone_number_verified,
        ipAddressVerified: v.ip_address_verification,
        bioProfileVerified: v.bio_profile_verification,
        documentVerified: v.document_verification,
        user: v.userProfile?.user ?? null,
      }));

      return ok(res, {
        data,
        pagination: {
          total: verifiedCount,
          page,
          limit,
          totalPages: Math.ceil(verifiedCount / limit),
        },
        counts: {
          verifiedUsers: verifiedCount,
          totalUsers,
        },
      });
    } catch (error) {
      console.error("Failed to list verified users:", error);
      return fail(res, 500, "Failed to list verified users");
    }
  }
}
