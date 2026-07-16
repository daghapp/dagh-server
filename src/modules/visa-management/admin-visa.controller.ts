import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { VisaApprovalStatus, VisaRequestStatus } from "../../../generated/prisma/client.js";

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

      return res.status(200).json({ success: true, data: requests });
    } catch (e) {
      console.error("Failed to get paid visa requests:", e);
      return res.status(500).json({
        success: false,
        message: "Failed to get paid visa requests",
        error: e instanceof Error ? e.message : "Unknown error",
      });
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
        return res.status(400).json({
          success: false,
          message: "requestId is required",
        });
      }

      const existing = await prisma.visaOnArrivalRequest.findUnique({
        where: { id: requestId },
        include: { approval: true },
      });

      if (!existing) {
        return res.status(404).json({ success: false, message: "Visa request not found" });
      }

      // Idempotent-ish approval: if already approved, just return current state.
      if (existing.status === VisaRequestStatus.APPROVED || existing.approval?.status === VisaApprovalStatus.APPROVED) {
        return res.status(200).json({
          success: true,
          message: "Visa request already approved",
          data: existing,
        });
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
          approval: {
            // Relation already handled by upsert; this is a no-op if approval exists.
          },
        } as any,
      });

      return res.status(200).json({
        success: true,
        message: "Visa request approved",
        data: { visaRequest: updated, approval },
      });
    } catch (e) {
      console.error("Failed to approve visa request:", e);
      return res.status(500).json({
        success: false,
        message: "Failed to approve visa request",
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }
}

