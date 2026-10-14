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
// Imported directly rather than via the config barrel (see note above): the
// barrel re-exports ./hubtel, which would create the same import cycle.
import { getHubtelClient } from "../../config/hubtel.js";
// Imported directly rather than via the config barrel: the barrel re-exports
// ./hubtel, which imports the payment gateway service, which imports
// helpers/admin-activity, so going through it would create an import cycle.
import { GatewayConfigError } from "../../services/payment-gateway-config.service.js";
import { logAdminActivity, AdminEntityType } from "../../helpers/admin-activity.js";
import { notifyAdmins } from "../../helpers/notify-admins.js";
import { updatePaymentControlSchema } from "../../validator/index.js";

const PAYMENT_STATUSES = Object.values(PaymentStatus) as readonly string[];
const TARGET_TYPES = Object.values(PaymentTargetType) as readonly string[];
const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;

const toQuery = (req: Request) => req.query as unknown as Record<string, QueryValue>;

function firstQueryValue(value: QueryValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseAmountFilter(value: QueryValue): number | undefined {
  const raw = firstQueryValue(value);
  if (raw === undefined || raw.trim() === "") return undefined;
  const num = Number(raw);
  return Number.isFinite(num) && num >= 0 ? num : undefined;
}

function parseFlaggedFilter(value: QueryValue): boolean | undefined {
  const raw = firstQueryValue(value)?.toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

/**
 * Shared where-clause for the paginated list and the CSV export so both
 * screens filter identically (§3.8). Invalid values are ignored, matching the
 * admin-query `parseEnum` convention.
 */
function buildPaymentListWhere(query: Record<string, QueryValue>): Record<string, unknown> {
  const q = parseSearch(query);
  const status = parseEnum(query, "status", PAYMENT_STATUSES);
  const targetType = parseEnum(query, "targetType", TARGET_TYPES);
  const dateRange = parseDateRange(query);
  const minAmount = parseAmountFilter(query.minAmount);
  const maxAmount = parseAmountFilter(query.maxAmount);
  const flagged = parseFlaggedFilter(query.flagged);
  const riskRaw = firstQueryValue(query.risk)?.toUpperCase();
  const risk =
    riskRaw && (RISK_LEVELS as readonly string[]).includes(riskRaw) ? riskRaw : undefined;

  const where: Record<string, unknown> = { createdAt: dateRange };
  if (status) where.status = status;
  if (targetType) where.targetType = targetType;
  if (minAmount !== undefined || maxAmount !== undefined) {
    where.amount = {
      ...(minAmount !== undefined ? { gte: minAmount } : {}),
      ...(maxAmount !== undefined ? { lte: maxAmount } : {}),
    };
  }
  if (flagged === true) where.transactionFlags = { some: {} };
  if (flagged === false) where.transactionFlags = { none: {} };
  if (risk) where.paymentRisk = { is: { riskLevel: risk } };
  if (q) {
    where.OR = [
      { reference: { contains: q, mode: "insensitive" } },
      { user: { is: { fullName: { contains: q, mode: "insensitive" } } } },
      { user: { is: { email: { contains: q, mode: "insensitive" } } } },
    ];
  }
  return where;
}

/**
 * Maps a Hubtel `GET /items/status/:reference` payload onto PaymentStatus.
 * Mirrors the user-facing `verifyPayment` mapping (Paid -> SUCCESS,
 * Failed -> FAILED, anything else -> PENDING), with the transaction-status
 * `responseCode` convention ("0000"/"0001") as a fallback when no `status`
 * string is present.
 */
function mapHubtelStatus(data: unknown): PaymentStatus {
  const record = (data ?? {}) as Record<string, unknown>;
  const statusText =
    typeof record.status === "string" ? record.status.toLowerCase() : "";
  if (statusText === "paid" || statusText === "success") return PaymentStatus.SUCCESS;
  if (statusText === "failed" || statusText === "fail") return PaymentStatus.FAILED;
  if (!record.status && record.responseCode === "0000") return PaymentStatus.SUCCESS;
  if (!record.status && record.responseCode === "0001") return PaymentStatus.FAILED;
  return PaymentStatus.PENDING;
}

function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export class AdminPaymentsConsoleController {
  /**
   * GET /admin/payments — paginated transaction list with service/status/date
   * filters plus min/max amount, flagged (has transactionFlags) and risk-level
   * (via paymentRisk) filters. Rows carry the flag count and risk record.
   */
  async list(req: Request, res: Response) {
    try {
      const query = toQuery(req);
      const { page, limit, skip } = parsePagination(query);
      const where = buildPaymentListWhere(query);

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
            refundedAmount: true,
            refundReason: true,
            refundedAt: true,
            user: { select: { id: true, fullName: true, email: true } },
            paymentRisk: true,
            _count: { select: { transactionFlags: true } },
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

      // Last 6 calendar months (oldest first): { month: "YYYY-MM", revenue,
      // successCount, failedCount }. Independent of the from/to filter — it is
      // the trend strip for the payments screen, not the filtered KPI window.
      const now = new Date();
      const buckets = Array.from({ length: 6 }, (_, i) => {
        const start = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
        const end = new Date(now.getFullYear(), now.getMonth() - (5 - i) + 1, 1);
        const month = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
        return { month, start, end };
      });

      const monthlySeries = await Promise.all(
        buckets.map(async ({ month, start, end }) => {
          const range = { gte: start, lt: end };
          const [monthRevenue, monthSuccess, monthFailed] = await Promise.all([
            prisma.payment.aggregate({
              where: { createdAt: range, status: PaymentStatus.SUCCESS },
              _sum: { amount: true },
            }),
            prisma.payment.count({
              where: { createdAt: range, status: PaymentStatus.SUCCESS },
            }),
            prisma.payment.count({
              where: { createdAt: range, status: PaymentStatus.FAILED },
            }),
          ]);
          return {
            month,
            revenue: monthRevenue._sum.amount ?? 0,
            successCount: monthSuccess,
            failedCount: monthFailed,
          };
        }),
      );

      return ok(res, {
        totalRevenue: revenue._sum.amount ?? 0,
        successCount,
        pendingCount: pendingAgg._count,
        pendingAmount: pendingAgg._sum.amount ?? 0,
        failedCount,
        successRate: closed > 0 ? Math.round((successCount / closed) * 1000) / 10 : 0,
        monthlySeries,
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
      // On the gateway path this endpoint is an alias for
      // PATCH /admin/settings/payment-gateway/processing, so it inherits its
      // errors — notably 409 when enabling while the selected environment is
      // unconnected. Preserving the status keeps the legacy endpoint honest
      // instead of reporting an expected guard as a server fault.
      if (error instanceof GatewayConfigError) {
        return fail(res, error.status, { code: error.code, message: error.message });
      }
      console.error("Failed to update payment control status:", error);
      return fail(res, 500, "Failed to update payment control status");
    }
  }

  /**
   * GET /admin/payments/:id — payment detail with payer, flags, risk,
   * audit trail, linked service and provider (defaults to HUBTEL).
   */
  async getById(req: Request, res: Response) {
    try {
      const { id } = req.params as { id: string };
      const payment = await prisma.payment.findUnique({
        where: { id },
        include: {
          user: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
          transactionFlags: { orderBy: { createdAt: "desc" } },
          paymentRisk: true,
        },
      });
      if (!payment) return fail(res, 404, "Payment not found");

      const auditTrail = await prisma.adminActivityLog.findMany({
        where: { entityType: AdminEntityType.PAYMENT, entityId: id },
        orderBy: { createdAt: "desc" },
      });

      const { provider, targetType, targetId, ...rest } = payment;
      return ok(res, {
        ...rest,
        provider: provider ?? "HUBTEL",
        service: { targetType, targetId },
        auditTrail,
      });
    } catch (error) {
      console.error("Failed to fetch payment:", error);
      return fail(res, 500, "Failed to fetch payment");
    }
  }

  /**
   * POST /admin/payments/:id/refund { amount, reason } — partial or full
   * refund against a SUCCESS payment. Cumulative via refundedAmount; status
   * flips to PARTIALLY_REFUNDED then REFUNDED once fully refunded.
   */
  async refund(req: Request, res: Response) {
    try {
      const { id } = req.params as { id: string };
      const { amount, reason } = req.body as { amount?: unknown; reason?: unknown };

      const refundAmount = typeof amount === "number" ? amount : Number(amount);
      if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
        return fail(res, 400, "Refund amount must be a positive number");
      }
      if (typeof reason !== "string" || reason.trim() === "") {
        return fail(res, 400, "Refund reason is required");
      }

      const payment = await prisma.payment.findUnique({ where: { id } });
      if (!payment) return fail(res, 404, "Payment not found");
      if (payment.status !== PaymentStatus.SUCCESS) {
        return fail(res, 400, "Only successful payments can be refunded");
      }

      const previousRefundedAmount = payment.refundedAmount ?? 0;
      const remaining = payment.amount - previousRefundedAmount;
      if (refundAmount > remaining) {
        return fail(res, 400, `Refund amount exceeds refundable balance of ${remaining}`);
      }

      const newRefundedAmount = previousRefundedAmount + refundAmount;
      const newStatus =
        newRefundedAmount >= payment.amount
          ? PaymentStatus.REFUNDED
          : PaymentStatus.PARTIALLY_REFUNDED;

      const updated = await prisma.payment.update({
        where: { id },
        data: {
          refundedAmount: newRefundedAmount,
          refundReason: reason.trim(),
          refundedAt: new Date(),
          status: newStatus,
        },
      });

      const actorId = (req.user as { id?: string })?.id;
      if (actorId) {
        try {
          await logAdminActivity({
            actorId,
            entityType: AdminEntityType.PAYMENT,
            entityId: id,
            action: "REFUND",
            note: reason.trim(),
            metadata: {
              previousRefundedAmount,
              newRefundedAmount,
              refundAmount,
              previousStatus: payment.status,
              newStatus,
            },
          });
        } catch (logErr) {
          console.warn("Failed to write admin activity log:", logErr);
        }
      }

      await notifyAdmins({
        category: "payments",
        message: `Refund of ${refundAmount} ${payment.currency} issued for payment ${payment.reference}`,
        actionUrl: `/admin/payments/${id}`,
        meta: { paymentId: id, refundAmount, newRefundedAmount, newStatus },
      });

      return ok(res, updated, "Refund recorded successfully");
    } catch (error) {
      console.error("Failed to refund payment:", error);
      return fail(res, 500, "Failed to refund payment");
    }
  }

  /**
   * POST /admin/payments/:id/flag { reason } — creates a TransactionFlag and
   * raises the PaymentRisk score (+30, capped at 100).
   */
  async flag(req: Request, res: Response) {
    try {
      const { id } = req.params as { id: string };
      const { reason } = req.body as { reason?: unknown };
      if (typeof reason !== "string" || reason.trim() === "") {
        return fail(res, 400, "Flag reason is required");
      }

      const payment = await prisma.payment.findUnique({ where: { id } });
      if (!payment) return fail(res, 404, "Payment not found");

      const adminId = (req.user as { id?: string })?.id;
      if (!adminId) return fail(res, 401, "Not authenticated");

      const flagRow = await prisma.transactionFlag.create({
        data: { paymentId: id, flaggedBy: adminId, reason: reason.trim() },
      });

      const existing = await prisma.paymentRisk.findUnique({ where: { paymentId: id } });
      const newScore = Math.min(100, (existing?.score ?? 0) + 30);
      const riskLevel = newScore >= 70 ? "HIGH" : newScore >= 40 ? "MEDIUM" : "LOW";
      const previousReasons = Array.isArray(existing?.reasons)
        ? (existing.reasons as string[])
        : [];
      const reasons = [...previousReasons, reason.trim()];
      const risk = await prisma.paymentRisk.upsert({
        where: { paymentId: id },
        update: { score: newScore, riskLevel, reasons },
        create: { paymentId: id, score: newScore, riskLevel, reasons },
      });

      try {
        await logAdminActivity({
          actorId: adminId,
          entityType: AdminEntityType.PAYMENT,
          entityId: id,
          action: "FLAGGED",
          note: reason.trim(),
          metadata: {
            previousScore: existing?.score ?? 0,
            newScore,
            riskLevel,
          },
        });
      } catch (logErr) {
        console.warn("Failed to write admin activity log:", logErr);
      }

      await notifyAdmins({
        category: "payments",
        message: `Payment ${payment.reference} flagged (${riskLevel} risk): ${reason.trim()}`,
        actionUrl: `/admin/payments/${id}`,
        meta: { paymentId: id, riskLevel, newScore },
      });

      return ok(res, { flag: flagRow, paymentRisk: risk }, "Payment flagged");
    } catch (error) {
      console.error("Failed to flag payment:", error);
      return fail(res, 500, "Failed to flag payment");
    }
  }

  /**
   * POST /admin/payments/:id/retry — live Hubtel status check for a FAILED or
   * PENDING payment (same `GET /items/status/:reference` call as the
   * user-facing verifyPayment). The local status follows the gateway result.
   */
  async retry(req: Request, res: Response) {
    try {
      const { id } = req.params as { id: string };
      const payment = await prisma.payment.findUnique({ where: { id } });
      if (!payment) return fail(res, 404, "Payment not found");
      if (payment.status !== PaymentStatus.FAILED && payment.status !== PaymentStatus.PENDING) {
        return fail(res, 400, "Only failed or pending payments can be retried");
      }

      let gateway: unknown;
      try {
        const hubtelClient = await getHubtelClient();
        const hubtelResponse = await hubtelClient.get(`/items/status/${payment.reference}`);
        gateway = hubtelResponse.data;
      } catch (gatewayError) {
        console.error("Payment retry gateway check failed:", gatewayError);
        return fail(res, 502, "Payment gateway unreachable");
      }

      const mapped = mapHubtelStatus(gateway);
      const updated =
        mapped !== payment.status
          ? await prisma.payment.update({ where: { id }, data: { status: mapped } })
          : payment;

      const actorId = (req.user as { id?: string })?.id;
      if (actorId) {
        try {
          await logAdminActivity({
            actorId,
            entityType: AdminEntityType.PAYMENT,
            entityId: id,
            action: "RETRY",
            note: `Gateway re-check for ${payment.reference}`,
            metadata: { previousStatus: payment.status, newStatus: mapped },
          });
        } catch (logErr) {
          console.warn("Failed to write admin activity log:", logErr);
        }
      }

      return ok(res, { payment: updated, gateway }, "Live gateway status retrieved");
    } catch (error) {
      console.error("Failed to retry payment:", error);
      return fail(res, 500, "Failed to retry payment");
    }
  }

  /**
   * GET /admin/payments/export — CSV dump using the same filters as the list.
   */
  async exportCsv(req: Request, res: Response) {
    try {
      const query = toQuery(req);
      const where = buildPaymentListWhere(query);

      const payments = await prisma.payment.findMany({
        where: where as never,
        include: {
          user: { select: { fullName: true, email: true } },
          paymentRisk: true,
          _count: { select: { transactionFlags: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      const header = [
        "id",
        "reference",
        "userName",
        "userEmail",
        "targetType",
        "targetId",
        "amount",
        "currency",
        "status",
        "method",
        "provider",
        "refundedAmount",
        "riskLevel",
        "flagCount",
        "paidAt",
        "createdAt",
      ];
      const lines = payments.map((p) =>
        [
          p.id,
          p.reference,
          p.user?.fullName,
          p.user?.email,
          p.targetType,
          p.targetId,
          p.amount,
          p.currency,
          p.status,
          p.method,
          p.provider,
          p.refundedAmount,
          p.paymentRisk?.riskLevel,
          p._count.transactionFlags,
          p.paidAt,
          p.createdAt,
        ]
          .map(toCsvCell)
          .join(","),
      );

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="payments.csv"');
      return res.send([header.join(","), ...lines].join("\n"));
    } catch (error) {
      console.error("Failed to export payments:", error);
      return fail(res, 500, "Failed to export payments");
    }
  }

  /**
   * GET /admin/payments/:id/receipt — flat JSON receipt for the payment.
   */
  async receipt(req: Request, res: Response) {
    try {
      const { id } = req.params as { id: string };
      const payment = await prisma.payment.findUnique({
        where: { id },
        include: {
          user: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
        },
      });
      if (!payment) return fail(res, 404, "Payment not found");

      return ok(res, {
        reference: payment.reference,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        method: payment.method,
        provider: payment.provider ?? "HUBTEL",
        paidAt: payment.paidAt,
        payer: payment.user,
        description: payment.description,
      });
    } catch (error) {
      console.error("Failed to build payment receipt:", error);
      return fail(res, 500, "Failed to build payment receipt");
    }
  }

  /**
   * POST /admin/payments/:id/verify-gateway — live Hubtel transaction status
   * by reference (same gateway call as retry). Read-only: the local record is
   * not mutated.
   */
  async verifyGateway(req: Request, res: Response) {
    try {
      const { id } = req.params as { id: string };
      const payment = await prisma.payment.findUnique({ where: { id } });
      if (!payment) return fail(res, 404, "Payment not found");

      let gateway: unknown;
      try {
        const hubtelClient = await getHubtelClient();
        const hubtelResponse = await hubtelClient.get(`/items/status/${payment.reference}`);
        gateway = hubtelResponse.data;
      } catch (gatewayError) {
        console.error("Payment gateway verification failed:", gatewayError);
        return fail(res, 502, "Payment gateway unreachable");
      }

      const actorId = (req.user as { id?: string })?.id;
      if (actorId) {
        try {
          await logAdminActivity({
            actorId,
            entityType: AdminEntityType.PAYMENT,
            entityId: id,
            action: "VERIFY_GATEWAY",
            note: `Live gateway check for ${payment.reference}`,
          });
        } catch (logErr) {
          console.warn("Failed to write admin activity log:", logErr);
        }
      }

      return ok(res, { payment, gateway }, "Gateway status retrieved");
    } catch (error) {
      console.error("Failed to verify payment with gateway:", error);
      return fail(res, 500, "Failed to verify payment with gateway");
    }
  }

  /**
   * POST /admin/payments/:id/override { status, reason } — reconciliation
   * escape hatch. Route-guarded to SUPER_ADMIN via the payments.override key.
   */
  async override(req: Request, res: Response) {
    try {
      const { id } = req.params as { id: string };
      const { status, reason } = req.body as { status?: unknown; reason?: unknown };

      if (
        typeof status !== "string" ||
        !(PAYMENT_STATUSES as readonly string[]).includes(status)
      ) {
        return fail(res, 400, "Invalid status");
      }
      if (typeof reason !== "string" || reason.trim() === "") {
        return fail(res, 400, "Override reason is required");
      }

      const payment = await prisma.payment.findUnique({ where: { id } });
      if (!payment) return fail(res, 404, "Payment not found");

      const updated = await prisma.payment.update({
        where: { id },
        data: { status: status as PaymentStatus },
      });

      const actorId = (req.user as { id?: string })?.id;
      if (actorId) {
        try {
          await logAdminActivity({
            actorId,
            entityType: AdminEntityType.PAYMENT,
            entityId: id,
            action: "STATUS_OVERRIDE",
            note: reason.trim(),
            metadata: { previousStatus: payment.status, newStatus: status },
          });
        } catch (logErr) {
          console.warn("Failed to write admin activity log:", logErr);
        }
      }

      await notifyAdmins({
        category: "payments",
        message: `Payment ${payment.reference} status overridden from ${payment.status} to ${status}: ${reason.trim()}`,
        actionUrl: `/admin/payments/${id}`,
        meta: { paymentId: id, previousStatus: payment.status, newStatus: status },
      });

      return ok(res, updated, `Payment status overridden to ${status}`);
    } catch (error) {
      console.error("Failed to override payment status:", error);
      return fail(res, 500, "Failed to override payment status");
    }
  }
}
