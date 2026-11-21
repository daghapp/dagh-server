import { Request, Response } from "express";
import { ok, fail } from "../../helpers/response.js";
import { ensureUserProfile } from "../../helpers/ensure-user-profile.js";

export async function initProfile(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;
    if (!userId) {
      return fail(res, 401, "Unauthorized");
    }

    const profile = await ensureUserProfile(userId);

    return ok(res, profile, "Profile initialized successfully.");
  } catch (error) {
    console.error("[initProfile]", error);
    return fail(res, 500, "Failed to initialize profile.");
  }
}
