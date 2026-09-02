import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";
import { VerificationStatus } from "../../../generated/prisma/client.js";
import type { Prisma } from "../../../generated/prisma/client.js";

const ADMIN_ACTIONS = ["APPROVED", "REJECTED"] as const;

export class AdminProfileController {
  async getAllVerifications(req: Request, res: Response) {
    try {
      const verifications = await prisma.profileVerification.findMany({
        include: {
          userProfile: {
            include: {
              user: {
                select: {
                  id: true,
                  fullName: true,
                  email: true,
                  phoneNumber: true,
                  accountType: true,
                  accountStatus: true,
                  createdAt: true,
                },
              },
            },
          },
        },
        orderBy: { lastUpdatedAt: "desc" },
      });

      const data = verifications.map((v) => ({
        id: v.id,
        isVerified: v.isVerified,
        validationStep: v.validationStep,
        verificationMessage: v.verification_message,
        phoneVerified: v.phone_number_verified,
        ipAddressVerified: v.ip_address_verification,
        bioProfileVerified: v.bio_profile_verification,
        documentVerified: v.document_verification,
        createdAt: v.createdAt,
        faceScanUrl: v.userProfile?.bio_profile_image_url ?? null,
        documentUrls: v.userProfile?.bio_document_urls ?? [],
        documentType: v.userProfile?.bio_document_type ?? null,
        documentNumber: v.userProfile?.bio_document_number ?? null,
        bioData: {
          status: v.bioDataStatus,
          approvedBy: v.bioDataApprovedBy,
          approvedAt: v.bioDataApprovedAt,
          approvalReason: v.bioDataApprovalReason,
          rejectedBy: v.bioDataRejectedBy,
          rejectedAt: v.bioDataRejectedAt,
          rejectionReason: v.bioDataRejectionReason,
        },
        faceVerification: {
          status: v.faceStatus,
          approvedBy: v.faceApprovedBy,
          approvedAt: v.faceApprovedAt,
          approvalReason: v.faceApprovalReason,
          rejectedBy: v.faceRejectedBy,
          rejectedAt: v.faceRejectedAt,
          rejectionReason: v.faceRejectionReason,
        },
        documents: {
          status: v.documentStatus,
          approvedBy: v.documentApprovedBy,
          approvedAt: v.documentApprovedAt,
          approvalReason: v.documentApprovalReason,
          rejectedBy: v.documentRejectedBy,
          rejectedAt: v.documentRejectedAt,
          rejectionReason: v.documentRejectionReason,
        },
        user: v.userProfile?.user ?? null,
        lastUpdatedAt: v.lastUpdatedAt,
      }));

      return ok(res, data);
    } catch (error) {
      console.error("getAllVerifications error:", error);
      return fail(
        res,
        500,
        "Failed to fetch profile verifications",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  async updateBioDataStatus(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const { action, reason } = req.body as {
        action: "APPROVED" | "REJECTED";
        reason?: string;
      };

      if (!ADMIN_ACTIONS.includes(action)) {
        return fail(res, 400, "Invalid action. Must be APPROVED or REJECTED");
      }

      const verification = await prisma.profileVerification.findUnique({
        where: { id },
      });

      if (!verification) {
        return fail(res, 404, "Profile verification not found");
      }

      const adminId = req.user?.id ? String(req.user.id) : null;

      const updateData: Record<string, unknown> = {
        bioDataStatus:
          action === "APPROVED" ? VerificationStatus.APPROVED : VerificationStatus.REJECTED,
        isVerified: action === "APPROVED" ? verification.isVerified : false,
      };

      if (action === "APPROVED") {
        updateData.bioDataApprovedBy = adminId;
        updateData.bioDataApprovedAt = new Date();
        updateData.bioDataApprovalReason = reason ?? null;
        updateData.bioDataRejectedBy = null;
        updateData.bioDataRejectedAt = null;
        updateData.bioDataRejectionReason = null;
      } else {
        updateData.bioDataRejectedBy = adminId;
        updateData.bioDataRejectedAt = new Date();
        updateData.bioDataRejectionReason = reason ?? null;
        updateData.bioDataApprovedBy = null;
        updateData.bioDataApprovedAt = null;
        updateData.bioDataApprovalReason = null;
      }

      const updated = await prisma.profileVerification.update({
        where: { id },
        data: updateData as Prisma.ProfileVerificationUpdateInput,
      });

      return ok(res, updated, `Bio data ${action.toLowerCase()} successfully`);
    } catch (error) {
      console.error("updateBioDataStatus error:", error);
      return fail(res, 500, "Failed to update bio data status");
    }
  }

  async updateFaceStatus(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const { action, reason } = req.body as {
        action: "APPROVED" | "REJECTED";
        reason?: string;
      };

      if (!ADMIN_ACTIONS.includes(action)) {
        return fail(res, 400, "Invalid action. Must be APPROVED or REJECTED");
      }

      const verification = await prisma.profileVerification.findUnique({
        where: { id },
      });

      if (!verification) {
        return fail(res, 404, "Profile verification not found");
      }

      const adminId = req.user?.id ? String(req.user.id) : null;

      const updateData: Record<string, unknown> = {
        faceStatus:
          action === "APPROVED" ? VerificationStatus.APPROVED : VerificationStatus.REJECTED,
        bio_profile_verification: action === "APPROVED",
        isVerified: action === "APPROVED" ? verification.isVerified : false,
      };

      if (action === "APPROVED") {
        updateData.faceApprovedBy = adminId;
        updateData.faceApprovedAt = new Date();
        updateData.faceApprovalReason = reason ?? null;
        updateData.faceRejectedBy = null;
        updateData.faceRejectedAt = null;
        updateData.faceRejectionReason = null;
      } else {
        updateData.faceRejectedBy = adminId;
        updateData.faceRejectedAt = new Date();
        updateData.faceRejectionReason = reason ?? null;
        updateData.faceApprovedBy = null;
        updateData.faceApprovedAt = null;
        updateData.faceApprovalReason = null;
      }

      const updated = await prisma.profileVerification.update({
        where: { id },
        data: updateData as Prisma.ProfileVerificationUpdateInput,
      });

      return ok(res, updated, `Face verification ${action.toLowerCase()} successfully`);
    } catch (error) {
      console.error("updateFaceStatus error:", error);
      return fail(res, 500, "Failed to update face verification status");
    }
  }

  async updateDocumentStatus(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const { action, reason } = req.body as {
        action: "APPROVED" | "REJECTED";
        reason?: string;
      };

      if (!ADMIN_ACTIONS.includes(action)) {
        return fail(res, 400, "Invalid action. Must be APPROVED or REJECTED");
      }

      const verification = await prisma.profileVerification.findUnique({
        where: { id },
      });

      if (!verification) {
        return fail(res, 404, "Profile verification not found");
      }

      const adminId = req.user?.id ? String(req.user.id) : null;

      const updateData: Record<string, unknown> = {
        documentStatus:
          action === "APPROVED" ? VerificationStatus.APPROVED : VerificationStatus.REJECTED,
        document_verification: action === "APPROVED",
        isVerified: action === "APPROVED" ? verification.isVerified : false,
      };

      if (action === "APPROVED") {
        updateData.documentApprovedBy = adminId;
        updateData.documentApprovedAt = new Date();
        updateData.documentApprovalReason = reason ?? null;
        updateData.documentRejectedBy = null;
        updateData.documentRejectedAt = null;
        updateData.documentRejectionReason = null;
      } else {
        updateData.documentRejectedBy = adminId;
        updateData.documentRejectedAt = new Date();
        updateData.documentRejectionReason = reason ?? null;
        updateData.documentApprovedBy = null;
        updateData.documentApprovedAt = null;
        updateData.documentApprovalReason = null;
      }

      const updated = await prisma.profileVerification.update({
        where: { id },
        data: updateData as Prisma.ProfileVerificationUpdateInput,
      });

      return ok(res, updated, `Documents ${action.toLowerCase()} successfully`);
    } catch (error) {
      console.error("updateDocumentStatus error:", error);
      return fail(res, 500, "Failed to update document status");
    }
  }

  async verifyUserFully(req: Request, res: Response) {
    try {
      const id = String(req.params.id);

      const verification = await prisma.profileVerification.findUnique({
        where: { id },
      });

      if (!verification) {
        return fail(res, 404, "Profile verification not found");
      }

      const adminId = req.user?.id ? String(req.user.id) : null;

      const updated = await prisma.profileVerification.update({
        where: { id },
        data: {
          isVerified: true,
          phone_number_verified: true,
          bio_profile_verification: true,
          document_verification: true,
          bioDataStatus: "APPROVED",
          bioDataApprovedBy: adminId,
          bioDataApprovedAt: new Date(),
          faceStatus: "APPROVED",
          faceApprovedBy: adminId,
          faceApprovedAt: new Date(),
          documentStatus: "APPROVED",
          documentApprovedBy: adminId,
          documentApprovedAt: new Date(),
          verification_message: "All verification sections approved",
        },
      });

      return ok(res, updated, "User fully verified successfully");
    } catch (error) {
      console.error("verifyUserFully error:", error);
      return fail(res, 500, "Failed to verify user");
    }
  }
}
