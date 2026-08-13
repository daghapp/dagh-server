import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { VisaApprovalStatus, VisaRequestStatus } from "../../../generated/prisma/client.js";
import { ok, fail, paginated } from "../../helpers/response.js";
import {
  parsePagination,
  parseSearch,
  parseEnum,
  parseDateRange,
  type QueryValue,
} from "../../helpers/admin-query.js";
import { AdminEntityType } from "../../helpers/admin-activity.js";

const VISA_STATUSES = Object.values(VisaRequestStatus) as readonly string[];

// Statuses that sit in the "awaiting admin decision" queue.
const REVIEWABLE_STATUSES = [
  VisaRequestStatus.PENDING,
  VisaRequestStatus.READY_FOR_GIS_SUBMISSION,
  VisaRequestStatus.EXPEDITED_AIRPORT_PAYMENT_PENDING,
];

const visaListInclude = {
  user: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
  visaData: {
    select: {
      passport_number: true,
      purpose_of_trip: true,
      date_of_arrival: true,
      date_of_departure: true,
    },
  },
  approval: { select: { status: true, approvedAt: true, notes: true } },
} as const;

const paymentSelect = { id: true, amount: true, status: true } as const;

const toQuery = (req: Request) => req.query as unknown as Record<string, QueryValue>;

export class AdminVisaConsoleController {
  /**
   * GET /admin/visa-requests — paginated, filterable visa queue.
   */
  async list(req: Request, res: Response) {
    try {
      const query = toQuery(req);
      const { page, limit, skip } = parsePagination(query);
      const q = parseSearch(query);
      const status = parseEnum(query, "status", VISA_STATUSES);
      const dateRange = parseDateRange(query);

      const where: Record<string, unknown> = { createdAt: dateRange };
      if (status) where.status = status;
      if (q) {
        where.OR = [
          { visaData: { is: { passport_number: { contains: q, mode: "insensitive" } } } },
          { visaData: { is: { purpose_of_trip: { contains: q, mode: "insensitive" } } } },
          { user: { is: { fullName: { contains: q, mode: "insensitive" } } } },
          { user: { is: { email: { contains: q, mode: "insensitive" } } } },
        ];
      }

      const [requests, total] = await Promise.all([
        prisma.visaOnArrivalRequest.findMany({
          where: where as never,
          include: visaListInclude,
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.visaOnArrivalRequest.count({ where: where as never }),
      ]);

      const paymentIds = requests.map((r) => r.paymentId).filter((id): id is string => Boolean(id));
      const payments = paymentIds.length
        ? await prisma.payment.findMany({
            where: { id: { in: paymentIds } },
            select: paymentSelect,
          })
        : [];
      const paymentMap = new Map(payments.map((p) => [p.id, p]));

      const data = requests.map((r) => ({
        ...r,
        payment: r.paymentId ? (paymentMap.get(r.paymentId) ?? null) : null,
      }));

      return paginated(res, data, total, page, limit);
    } catch (error) {
      console.error("Failed to list visa requests:", error);
      return fail(res, 500, "Failed to list visa requests");
    }
  }

  /**
   * GET /admin/visa-requests/stats — KPI counters for the queue screen.
   */
  async stats(req: Request, res: Response) {
    try {
      const dateRange = parseDateRange(toQuery(req));
      const where = { createdAt: dateRange };

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const [total, pendingReview, rejected, approvedToday] = await Promise.all([
        prisma.visaOnArrivalRequest.count({ where }),
        prisma.visaOnArrivalRequest.count({
          where: { ...where, status: { in: REVIEWABLE_STATUSES } },
        }),
        prisma.visaOnArrivalRequest.count({
          where: { ...where, status: VisaRequestStatus.REJECTED },
        }),
        prisma.visaOnArrivalRequest.count({
          where: {
            ...where,
            status: VisaRequestStatus.APPROVED,
            approval: { approvedAt: { gte: startOfToday } },
          },
        }),
      ]);

      return ok(res, {
        total,
        pendingReview,
        rejected,
        approvedToday,
        rejectionRate: total > 0 ? Math.round((rejected / total) * 1000) / 10 : 0,
      });
    } catch (error) {
      console.error("Failed to compute visa stats:", error);
      return fail(res, 500, "Failed to compute visa stats");
    }
  }

  /**
   * GET /admin/visa-requests/:id — full detail incl. user, docs, payment,
   * approval and the admin activity trail for the request.
   */
  async detail(req: Request, res: Response) {
    try {
      const requestId = req.params.id as string;

      const request = await prisma.visaOnArrivalRequest.findUnique({
        where: { id: requestId },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              phoneNumber: true,
              dateOfBirth: true,
              createdAt: true,
            },
          },
          visaData: true,
          approval: true,
        },
      });

      if (!request) {
        return fail(res, 404, "Visa request not found");
      }

      const [payment, activityLogs] = await Promise.all([
        request.paymentId
          ? prisma.payment.findUnique({ where: { id: request.paymentId } })
          : Promise.resolve(null),
        prisma.adminActivityLog.findMany({
          where: { entityType: AdminEntityType.VISA_REQUEST, entityId: requestId },
          include: { actor: { select: { id: true, fullName: true, email: true } } },
          orderBy: { createdAt: "desc" },
        }),
      ]);

      return ok(res, { ...request, payment, activityLogs });
    } catch (error) {
      console.error("Failed to fetch visa request:", error);
      return fail(res, 500, "Failed to fetch visa request");
    }
  }

  /**
   * POST /admin/visa-requests/:id/approve — idempotent.
   */
  async approve(req: Request, res: Response) {
    try {
      const requestId = req.params.id as string;
      const note = (req.body as { note?: string })?.note?.trim() || undefined;
      const actorId = req.user?.id as string;

      const existing = await prisma.visaOnArrivalRequest.findUnique({
        where: { id: requestId },
        include: { approval: true },
      });

      if (!existing) {
        return fail(res, 404, "Visa request not found");
      }

      if (
        existing.status === VisaRequestStatus.APPROVED ||
        existing.approval?.status === VisaApprovalStatus.APPROVED
      ) {
        return ok(res, existing, "Visa request already approved");
      }

      const result = await prisma.$transaction(async (tx) => {
        const approval = await tx.visaApproval.upsert({
          where: { requestId: existing.id },
          update: {
            status: VisaApprovalStatus.APPROVED,
            approvedBy: actorId,
            approvedAt: new Date(),
            notes: note ?? undefined,
          },
          create: {
            requestId: existing.id,
            status: VisaApprovalStatus.APPROVED,
            approvedAt: new Date(),
            approvedBy: actorId,
            notes: note ?? null,
          },
        });

        const request = await tx.visaOnArrivalRequest.update({
          where: { id: requestId },
          data: { status: VisaRequestStatus.APPROVED },
        });

        await tx.adminActivityLog.create({
          data: {
            actorId,
            entityType: AdminEntityType.VISA_REQUEST,
            entityId: requestId,
            action: "APPROVED",
            note,
          },
        });

        return { request, approval };
      });

      return ok(res, result, "Visa request approved");
    } catch (error) {
      console.error("Failed to approve visa request:", error);
      return fail(res, 500, "Failed to approve visa request");
    }
  }

  /**
   * POST /admin/visa-requests/:id/reject — idempotent.
   */
  async reject(req: Request, res: Response) {
    try {
      const requestId = req.params.id as string;
      const note = (req.body as { note?: string })?.note?.trim() || undefined;
      const actorId = req.user?.id as string;

      const existing = await prisma.visaOnArrivalRequest.findUnique({
        where: { id: requestId },
        include: { approval: true },
      });

      if (!existing) {
        return fail(res, 404, "Visa request not found");
      }

      if (
        existing.status === VisaRequestStatus.REJECTED ||
        existing.approval?.status === VisaApprovalStatus.REJECTED
      ) {
        return ok(res, existing, "Visa request already rejected");
      }

      const result = await prisma.$transaction(async (tx) => {
        const approval = await tx.visaApproval.upsert({
          where: { requestId: existing.id },
          update: {
            status: VisaApprovalStatus.REJECTED,
            approvedBy: actorId,
            approvedAt: new Date(),
            notes: note ?? undefined,
          },
          create: {
            requestId: existing.id,
            status: VisaApprovalStatus.REJECTED,
            approvedAt: new Date(),
            approvedBy: actorId,
            notes: note ?? null,
          },
        });

        const request = await tx.visaOnArrivalRequest.update({
          where: { id: requestId },
          data: { status: VisaRequestStatus.REJECTED },
        });

        await tx.adminActivityLog.create({
          data: {
            actorId,
            entityType: AdminEntityType.VISA_REQUEST,
            entityId: requestId,
            action: "REJECTED",
            note,
          },
        });

        return { request, approval };
      });

      return ok(res, result, "Visa request rejected");
    } catch (error) {
      console.error("Failed to reject visa request:", error);
      return fail(res, 500, "Failed to reject visa request");
    }
  }
}
