import { Request, Response } from "express";
import { prisma } from "../../config/index.js";

export async function initProfile(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized", data: null });
    }

    const existing = await prisma.userProfile.findUnique({
      where: { userId },
    });

    if (existing) {
      return res.status(200).json({
        success: true,
        message: "Profile initialized successfully.",
        data: existing,
      });
    }

    const created = await prisma.userProfile.create({
      data: {
        userId,
        profileUrl: null,
        phoneNumber: null,
        bio_profile_image_url: null,
        bio_profile_image_uploaded_at: null,
        bio_document_urls: [],
        bio_document_type: null,
        bio_document_uploaded_at: null,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Profile initialized successfully.",
      data: created,
    });
  } catch (error) {
    console.error("[initProfile]", error);
    return res.status(500).json({
      success: false,
      message: "Failed to initialize profile.",
      data: null,
    });
  }
}

