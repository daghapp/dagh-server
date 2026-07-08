import { Request, Response } from "express";
import { prisma } from "../../config/index.js";

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
        isVerified: v.isVerifided,
        validationStep: v.validationStep,
        verificationMessage: v.verification_message,
        phoneVerified: v.phone_number_verified,
        ipAddressVerified: v.ip_address_verification,
        bioProfileVerified: v.bio_profile_verification,
        documentVerified: v.document_verificaiton,
        createdAt: v.createdAt,
        faceScanUrl: v.userProfile?.bio_profile_image_url ?? null,
        documentUrls: v.userProfile?.bio_document_urls ?? [],
        documentType: v.userProfile?.bio_document_type ?? null,
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

      return res.status(200).json({ success: true, data });
    } catch (error) {
      console.error("getAllVerifications error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch profile verifications",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async updateBioDataStatus(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const { action, reason } = req.body as {
        action: string;
        reason?: string;
      };

      if (!ADMIN_ACTIONS.includes(action as any)) {
        return res.status(400).json({
          success: false,
          message: "Invalid action. Must be APPROVED or REJECTED",
        });
      }

      const verification = await prisma.profileVerification.findUnique({
        where: { id },
      });

      if (!verification) {
        return res.status(404).json({
          success: false,
          message: "Profile verification not found",
        });
      }

      const adminId = req.user?.id ? String(req.user.id) : null;

      const updateData: any = {
        bioDataStatus: action,
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
        data: updateData,
      });

      return res.status(200).json({
        success: true,
        message: `Bio data ${action.toLowerCase()} successfully`,
        data: updated,
      });
    } catch (error) {
      console.error("updateBioDataStatus error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update bio data status",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async updateFaceStatus(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const { action, reason } = req.body as {
        action: string;
        reason?: string;
      };

      if (!ADMIN_ACTIONS.includes(action as any)) {
        return res.status(400).json({
          success: false,
          message: "Invalid action. Must be APPROVED or REJECTED",
        });
      }

      const verification = await prisma.profileVerification.findUnique({
        where: { id },
      });

      if (!verification) {
        return res.status(404).json({
          success: false,
          message: "Profile verification not found",
        });
      }

      const adminId = req.user?.id ? String(req.user.id) : null;

      const updateData: any = {
        faceStatus: action,
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
        data: updateData,
      });

      return res.status(200).json({
        success: true,
        message: `Face verification ${action.toLowerCase()} successfully`,
        data: updated,
      });
    } catch (error) {
      console.error("updateFaceStatus error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update face verification status",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async updateDocumentStatus(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const { action, reason } = req.body as {
        action: string;
        reason?: string;
      };

      if (!ADMIN_ACTIONS.includes(action as any)) {
        return res.status(400).json({
          success: false,
          message: "Invalid action. Must be APPROVED or REJECTED",
        });
      }

      const verification = await prisma.profileVerification.findUnique({
        where: { id },
      });

      if (!verification) {
        return res.status(404).json({
          success: false,
          message: "Profile verification not found",
        });
      }

      const adminId = req.user?.id ? String(req.user.id) : null;

      const updateData: any = {
        documentStatus: action,
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
        data: updateData,
      });

      return res.status(200).json({
        success: true,
        message: `Documents ${action.toLowerCase()} successfully`,
        data: updated,
      });
    } catch (error) {
      console.error("updateDocumentStatus error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update document status",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async verifyUserFully(req: Request, res: Response) {
    try {
      const id = String(req.params.id);

      const verification = await prisma.profileVerification.findUnique({
        where: { id },
      });

      if (!verification) {
        return res.status(404).json({
          success: false,
          message: "Profile verification not found",
        });
      }

      const adminId = req.user?.id ? String(req.user.id) : null;

      const updated = await prisma.profileVerification.update({
        where: { id },
        data: {
          isVerifided: true,
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

      return res.status(200).json({
        success: true,
        message: "User fully verified successfully",
        data: updated,
      });
    } catch (error) {
      console.error("verifyUserFully error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to verify user",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}
