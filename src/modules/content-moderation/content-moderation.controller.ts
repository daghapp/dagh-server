import { Request, Response } from "express";
import { ok, fail } from "../../helpers/response.js";
import * as svc from "./content-moderation.service.js";

export class ContentModerationController {
  async create(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    const { kind, title, body, mediaUrls } = req.body ?? {};
    if (!body) return fail(res, 400, "body required");
    try {
      const row = await svc.createPost(userId, { kind, title, body, mediaUrls });
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }

  async get(req: Request, res: Response) {
    const row = await svc.getPost(req.params.id as string);
    if (!row) return fail(res, 404, "Not found");
    return ok(res, row);
  }

  async listApproved(req: Request, res: Response) {
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const data = await svc.listApproved(limit, offset);
    return ok(res, data);
  }

  async appeal(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    const { reason } = req.body ?? {};
    if (!reason) return fail(res, 400, "reason required");
    try {
      const row = await svc.createAppeal(req.params.id as string, userId, reason);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }

  async adminQueue(req: Request, res: Response) {
    const status = (req.query.status as string) ?? "FLAGGED";
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const data = await svc.listQueue(status, limit, offset);
    return ok(res, data);
  }

  async adminDecide(req: Request, res: Response) {
    const adminId = req.user?.id;
    if (!adminId) return fail(res, 401, "Unauthorized");
    const { approve, reason } = req.body ?? {};
    if (typeof approve !== "boolean") return fail(res, 400, "approve boolean required");
    try {
      const row = await svc.decidePost(req.params.id as string, adminId, approve, reason);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }

  async adminDecideAppeal(req: Request, res: Response) {
    const adminId = req.user?.id;
    if (!adminId) return fail(res, 401, "Unauthorized");
    const { approve, note } = req.body ?? {};
    if (typeof approve !== "boolean") return fail(res, 400, "approve boolean required");
    try {
      const row = await svc.decideAppeal(req.params.appealId as string, adminId, approve, note);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
}
