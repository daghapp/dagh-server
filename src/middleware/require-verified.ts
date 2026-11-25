import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/index.js";
import { fail } from "../helpers/response.js";

export function requireVerified(action?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    const row = await prisma.identityVerification.findUnique({ where: { userId } });
    if (row?.status !== "APPROVED") {
      return fail(res, 403, "Identity verification required", {
        code: "VERIFICATION_REQUIRED",
        action: action ?? null,
        status: row?.status ?? "NOT_STARTED",
      } as any);
    }
    next();
  };
}
