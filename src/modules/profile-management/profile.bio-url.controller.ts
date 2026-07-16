import { Request, Response } from "express";
import { prisma } from "../../config/index.js";

export async function postBioProfileUrl(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized", data: null });
    }

    const bio_profile_url = (req.body as any)?.bio_profile_url as string | undefined;
    if (!bio_profile_url || typeof bio_profile_url !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "bio_profile_url is required", data: null });
    }

    const updated = await prisma.userProfile.update({
      where: { userId },
      data: {
        bio_profile_image_url: bio_profile_url,
        bio_profile_image_uploaded_at: new Date(),
      },
    });

    return res.status(200).json({
      success: true,
      message: "Bio profile URL updated successfully.",
      data: {
        bio_profile_image_url: updated.bio_profile_image_url,
        bio_profile_image_uploaded_at: updated.bio_profile_image_uploaded_at,
      },
    });
  } catch (error) {
    console.error("[postBioProfileUrl]", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update bio profile URL.",
      data: null,
    });
  }
}
