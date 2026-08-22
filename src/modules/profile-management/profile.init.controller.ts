import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";

export async function initProfile(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;
    if (!userId) {
      return fail(res, 401, "Unauthorized");
    }

    const existing = await prisma.userProfile.findUnique({
      where: { userId },
    });

    if (existing) {
      return ok(res, existing, "Profile initialized successfully.");
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

        // Create related row(s) on init
        profileVerification: {
          create: {
            phone_number_verified: false,
            isVerified: false,
            verification_message: null,
            lastUpdatedAt: new Date(),
            document_verification: false,
            bio_profile_verification: false,
            ip_address_verification: false,
          },
        },
      },
      include: {
        profileVerification: true,
      },
    });

    return ok(res, created, "Profile initialized successfully.");
  } catch (error) {
    console.error("[initProfile]", error);
    return fail(res, 500, "Failed to initialize profile.");
  }
}
