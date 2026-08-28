import { Request, Response } from "express";
import geoip from "geoip-country";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";

export async function verifyJurisdiction(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const { ip } = req.body as { ip: string };

    const lookup = geoip.lookup(ip);
    const countryCode = lookup?.country ?? null;

    const allowed = countryCode
      ? await prisma.allowedCountry.findUnique({ where: { code: countryCode } })
      : null;

    if (!allowed) {
      // Same wipe as POST /auth/logout — invalidates every device for this user.
      await prisma.deviceToken.deleteMany({ where: { userId } });
      return fail(res, 403, "Access from this location is not permitted");
    }

    return ok(res, { country: allowed.code });
  } catch (error) {
    console.error("Jurisdiction check error:", error);
    return fail(res, 500, "Jurisdiction check failed");
  }
}
