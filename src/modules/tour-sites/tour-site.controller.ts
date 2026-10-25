import { Request, Response } from "express";
import { created, fail } from "../../helpers/response.js";
import { createTourSite } from "./tour-site.service.js";
import type { CreateTourSiteInput } from "../../validator/tour-site-validator.js";

// ─────────────────────────────────────────
// ADMIN-CREATED TOUR SITES — controller
//
// Thin HTTP layer over tour-site.service: maps the service's error codes to
// HTTP statuses and shapes the response envelope.
// ─────────────────────────────────────────

const ERROR_STATUS: Record<string, number> = {
  DUPLICATE_SITE_NAME: 409,
};

function mapError(res: Response, error: unknown, context: string): Response {
  const code = error instanceof Error ? error.message : undefined;
  const status = code ? ERROR_STATUS[code] : undefined;
  if (status) {
    return fail(res, status, { code, message: code });
  }
  console.error(`[tour-sites] ${context}:`, error);
  return fail(res, 500, "Internal server error");
}

export class TourSiteController {
  /** POST /tour-sites/admin — add a live tour site directly (admin only). */
  async createSite(req: Request, res: Response) {
    const adminId = req.user?.id;
    if (!adminId) return fail(res, 401, "Unauthenticated");

    try {
      const site = await createTourSite(adminId, req.body as CreateTourSiteInput);
      return created(res, site, "Tour site created");
    } catch (error) {
      return mapError(res, error, "createSite");
    }
  }
}
