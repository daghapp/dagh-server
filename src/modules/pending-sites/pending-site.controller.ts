import { Request, Response } from "express";
import { ok, created, fail } from "../../helpers/response.js";
import {
  submitPendingSite,
  listPendingSites,
  getMySubmissions,
  approvePendingSite,
  rejectPendingSite,
} from "./pending-site.service.js";
import type { SubmitPendingSiteInput } from "../../validator/pending-site-validator.js";

// ─────────────────────────────────────────
// USER-GENERATED TOUR SITES — controller (§3)
//
// Thin HTTP layer over pending-site.service: builds plain arguments from the
// request, maps the service's error codes to HTTP statuses, and shapes the
// response envelope. All moderation logic lives in the service.
// ─────────────────────────────────────────

// Service error code → HTTP status. Anything unmapped is a bug → 500.
const ERROR_STATUS: Record<string, number> = {
  SITE_NOT_FOUND: 404,
  SITE_NOT_PENDING: 400,
  DUPLICATE_SITE_NAME: 409,
  NAME_CONFLICT: 409,
  INVALID_REJECT_REASON: 400,
  INVALID_STATUS: 400,
};

function mapError(res: Response, error: unknown, context: string): Response {
  const code = error instanceof Error ? error.message : undefined;
  const status = code ? ERROR_STATUS[code] : undefined;
  if (status) {
    return fail(res, status, { code, message: code });
  }
  console.error(`[pending-sites] ${context}:`, error);
  return fail(res, 500, "Internal server error");
}

export class PendingSiteController {
  /** POST /pending-sites — user submits a new tour site for review (§3). */
  async submitSite(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthenticated");

    try {
      const input = req.body as SubmitPendingSiteInput;
      const pendingSite = await submitPendingSite(userId, input);
      return created(res, pendingSite, "Tour site submitted pending admin review");
    } catch (error) {
      return mapError(res, error, "submitSite");
    }
  }

  /** GET /pending-sites/mine — the submitter's own submission history (§3). */
  async mySubmissions(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthenticated");

    try {
      const submissions = await getMySubmissions(userId);
      return ok(res, submissions);
    } catch (error) {
      return mapError(res, error, "mySubmissions");
    }
  }

  /** GET /pending-sites/admin — moderation queue, filterable by status (§3). */
  async listPendingSites(req: Request, res: Response) {
    const adminId = req.user?.id;
    if (!adminId) return fail(res, 401, "Unauthenticated");

    try {
      const { status, page, limit } = req.query as Record<string, string | undefined>;
      const data = await listPendingSites({
        status,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return ok(res, data);
    } catch (error) {
      return mapError(res, error, "listPendingSites");
    }
  }

  /** POST /pending-sites/admin/:siteId/approve — migrate into tour_sites (§3). */
  async approveSite(req: Request, res: Response) {
    const adminId = req.user?.id;
    if (!adminId) return fail(res, 401, "Unauthenticated");

    try {
      const siteId = req.params.siteId as string;
      const result = await approvePendingSite(siteId, adminId);
      return ok(res, result, "Site approved and migrated to production");
    } catch (error) {
      return mapError(res, error, "approveSite");
    }
  }

  /** POST /pending-sites/admin/:siteId/reject — reject with a revision reason (§3). */
  async rejectSite(req: Request, res: Response) {
    const adminId = req.user?.id;
    if (!adminId) return fail(res, 401, "Unauthenticated");

    try {
      const siteId = req.params.siteId as string;
      const { rejectReason } = req.body as { rejectReason?: string };
      const result = await rejectPendingSite(siteId, adminId, rejectReason ?? "");
      return ok(res, result, "Site rejected");
    } catch (error) {
      return mapError(res, error, "rejectSite");
    }
  }
}
