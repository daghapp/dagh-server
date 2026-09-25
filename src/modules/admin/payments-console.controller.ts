import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { PaymentStatus, PaymentTargetType } from "../../../generated/prisma/client.js";
import { ok, fail, paginated } from "../../helpers/response.js";
import {
  parsePagination,
  parseSearch,
  parseEnum,
  parseDateRange,
  type QueryValue,
} from "../../helpers/admin-query.js";
import { getPaymentControlDetails, setPaymentControlStatus } from "../../config/payments.js";
import { logAdminActivity, AdminEntityType } from "../../helpers/admin-activity.js";
import { updatePaymentControlSchema } from "../../validator/index.js";

const PAYMENT_STATUSES = Object.values(PaymentStatus) as readonly string[];
const TARGET_TYPES = Object.values(PaymentTargetType) as readonly string[];

const toQuery = (req: Request) => req.query as unknown as Record<string, QueryValue>;

export class AdminPaymentsConsoleController {
  /**
   * GET /admin/payments — paginated transaction list with service/status/date filters.
   */
  async list(req: Request, res: Response) {
    try {
      const query = toQuery(req);
      const { page, limit, skip } = parsePagination(query);
      const q = parseSearch(query);
      const status = parseEnum(query, "status", PAYMENT_STATUSES);
      const targetType = parseEnum(query, "targetType", TARGET_TYPES);
      const dateRange = parseDateRange(query);

      const where: Record<string, unknown> = { createdAt: dateRange };
      if (status) where.status = status;
      if (targetType) where.targetType = targetType;
      if (q) {
        where.OR = [
          { reference: { contains: q, mode: "insensitive" } },
          { user: { is: { fullName: { contains: q, mode: "insensitive" } } } },
          { user: { is: { email: { contains: q, mode: "insensitive" } } } },
        ];
      }

      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
          where: where as never,
          select: {
            id: true,
            reference: true,
            description: true,
            targetType: true,
            targetId: true,
            amount: true,
            currency: true,
            status: true,
            method: true,
            provider: true,
            paidAt: true,
            createdAt: true,
            user: { select: { id: true, fullName: true, email: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.payment.count({ where: where as never }),
      ]);

      return paginated(res, payments, total, page, limit);
    } catch (error) {
      console.error("Failed to list payments:", error);
      return fail(res, 500, "Failed to list payments");
    }
  }

  /**
   * GET /admin/payments/stats — revenue / pending / failed / success-rate KPIs.
   */
  async stats(req: Request, res: Response) {
    try {
      const query = toQuery(req);
      const dateRange = parseDateRange(query);
      const where = { createdAt: dateRange };

      const [revenue, successCount, pendingAgg, failedCount] = await Promise.all([
        prisma.payment.aggregate({
          where: { ...where, status: PaymentStatus.SUCCESS },
          _sum: { amount: true },
        }),
        prisma.payment.count({
          where: { ...where, status: PaymentStatus.SUCCESS },
        }),
        prisma.payment.aggregate({
          where: {
            ...where,
            status: { in: [PaymentStatus.PENDING, PaymentStatus.INITIALIZED] },
          },
          _count: true,
          _sum: { amount: true },
        }),
        prisma.payment.count({
          where: { ...where, status: PaymentStatus.FAILED },
        }),
      ]);

      const closed = successCount + failedCount;

      return ok(res, {
        totalRevenue: revenue._sum.amount ?? 0,
        successCount,
        pendingCount: pendingAgg._count,
        pendingAmount: pendingAgg._sum.amount ?? 0,
        failedCount,
        successRate: closed > 0 ? Math.round((successCount / closed) * 1000) / 10 : 0,
      });
    } catch (error) {
      console.error("Failed to compute payment stats:", error);
      return fail(res, 500, "Failed to compute payment stats");
    }
  }

  /**
   * GET /admin/payments/status — current payment system active status and metadata.
   */
  async getControlStatus(_req: Request, res: Response) {
    try {
      const details = await getPaymentControlDetails();
      return ok(res, details);
    } catch (error) {
      console.error("Failed to fetch payment control status:", error);
      return fail(res, 500, "Failed to fetch payment control status");
    }
  }

  /**
   * PATCH /admin/payments/status — enable or disable the payment system.
   */
  async updateControlStatus(req: Request, res: Response) {
    try {
      const parseResult = updatePaymentControlSchema.safeParse(req.body);
      if (!parseResult.success) {
        const errorMsg = parseResult.error.issues?.[0]?.message ?? "Invalid request body";
        return fail(res, 400, errorMsg);
      }

      const { enabled, reason } = parseResult.data;
      const adminId = (req.user as { id?: string })?.id;

      const updatedDetails = await setPaymentControlStatus({
        enabled,
        reason,
        updatedBy: adminId,
      });

      if (adminId) {
        try {
          await logAdminActivity({
            actorId: adminId,
            entityType: AdminEntityType.PAYMENT,
            action: enabled ? "ENABLE_PAYMENTS" : "DISABLE_PAYMENTS",
            note: reason ?? (enabled ? "Payments enabled by admin" : "Payments disabled by admin"),
          });
        } catch (logErr) {
          console.warn("Failed to write admin activity log:", logErr);
        }
      }

      return ok(
        res,
        updatedDetails,
        enabled ? "Payment system enabled successfully" : "Payment system disabled successfully",
      );
    } catch (error) {
      console.error("Failed to update payment control status:", error);
      return fail(res, 500, "Failed to update payment control status");
    }
  }
}
