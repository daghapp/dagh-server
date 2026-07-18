import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { VisaApprovalStatus, VisaRequestStatus } from "../../../generated/prisma/client.js";
import { ok, fail } from "../../helpers/response.js";

export class AdminVisaController {
  /**
   * Get visa requests that have paid and are ready for admin processing.
   * Only returns requests currently in:
   *  - READY_FOR_GIS_SUBMISSION
   *  - EXPEDITED_AIRPORT_PAYMENT_PENDING
   */
  async getPaidVisaRequests(req: Request, res: Response) {
    try {
      const requests = await prisma.visaOnArrivalRequest.findMany({
        where: {
          status: {
            in: [
              VisaRequestStatus.READY_FOR_GIS_SUBMISSION,
              VisaRequestStatus.EXPEDITED_AIRPORT_PAYMENT_PENDING,
            ],
          },
        },
        include: {
          user: {
            select: { id: true, fullName: true, email: true },
          },
          visaData: true,
          approval: true,
        },
        orderBy: { createdAt: "desc" },
      });

      return ok(res, requests);
    } catch (e) {
      console.error("Failed to get paid visa requests:", e);
      return fail(res, 500, "Failed to get paid visa requests");
    }
  }

  /**
   * Approve a specific visa request.
   * Body: { requestId: string }
   */
  async approveVisaRequest(req: Request, res: Response) {
    try {
      const { requestId } = req.body as { requestId?: string };

      if (!requestId) {
        return fail(res, 400, "requestId is required");
      }

      const existing = await prisma.visaOnArrivalRequest.findUnique({
        where: { id: requestId },
        include: { approval: true },
      });

      if (!existing) {
        return fail(res, 404, "Visa request not found");
      }

      // Idempotent-ish approval: if already approved, just return current state.
      if (
        existing.status === VisaRequestStatus.APPROVED ||
        existing.approval?.status === VisaApprovalStatus.APPROVED
      ) {
        return ok(res, existing, "Visa request already approved");
      }

      // Create approval record if none exists, otherwise update.
      const approval = await prisma.visaApproval.upsert({
        where: { requestId: existing.id },
        update: {
          status: VisaApprovalStatus.APPROVED,
          approvedBy: req.user?.id ? String(req.user.id) : null,
          approvedAt: new Date(),
        },
        create: {
          requestId: existing.id,
          status: VisaApprovalStatus.APPROVED,
          approvedAt: new Date(),
          approvedBy: req.user?.id ? String(req.user.id) : null,
        },
      });

      // Mark request as approved.
      const updated = await prisma.visaOnArrivalRequest.update({
        where: { id: requestId },
        data: {
          status: VisaRequestStatus.APPROVED,
        },
      });

      return ok(res, { visaRequest: updated, approval }, "Visa request approved");
    } catch (e) {
      console.error("Failed to approve visa request:", e);
      return fail(res, 500, "Failed to approve visa request");
    }
  }
}
