import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";
import type { Ethnicity } from "../../../generated/prisma/enums.js";
import { indexDatingProfile } from "../../services/dating-search.service.js";

/**
 * Update the authenticated user's own account profile fields:
 * fullName, gender, dateOfBirth, ethnicity.
 */
export async function updateOwnProfile(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;
    if (!userId) {
      return fail(res, 401, "Unauthorized");
    }

    const { fullName, gender, dateOfBirth, ethnicity } = req.body as {
      fullName?: string;
      gender?: string;
      dateOfBirth?: Date;
      ethnicity?: Ethnicity;
    };

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        fullName: fullName ?? undefined,
        gender: gender ?? undefined,
        dateOfBirth: dateOfBirth ?? undefined,
        ethnicity: ethnicity ?? undefined,
      },
      select: {
        id: true,
        fullName: true,
        gender: true,
        dateOfBirth: true,
        ethnicity: true,
      },
    });

    void indexDatingProfile(userId);

    return ok(res, updated, "Profile updated successfully.");
  } catch (error) {
    console.error("[updateOwnProfile]", error);
    return fail(res, 500, "Failed to update profile.");
  }
}
