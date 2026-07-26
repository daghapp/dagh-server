import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";

export async function postBioProfileUrl(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;
    if (!userId) {
      return fail(res, 401, "Unauthorized");
    }

    const bio_profile_url = req.body?.bio_profile_url as string | undefined;
    if (!bio_profile_url || typeof bio_profile_url !== "string") {
      return fail(res, 400, "bio_profile_url is required");
    }

    const updated = await prisma.userProfile.update({
      where: { userId },
      data: {
        bio_profile_image_url: bio_profile_url,
        bio_profile_image_uploaded_at: new Date(),
      },
    });

    return ok(
      res,
      {
        bio_profile_image_url: updated.bio_profile_image_url,
        bio_profile_image_uploaded_at: updated.bio_profile_image_uploaded_at,
      },
      "Bio profile URL updated successfully.",
    );
  } catch (error) {
    console.error("[postBioProfileUrl]", error);
    return fail(res, 500, "Failed to update bio profile URL.");
  }
}
