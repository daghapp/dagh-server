import { Request, Response } from "express";
import { ok, fail } from "../../helpers/response.js";
import * as svc from "./crowdfunding.service.js";

export class AdminCrowdfundingController {
  async listCampaigns(req: Request, res: Response) {
    const status = req.query.status as string | undefined;
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const data = await svc.listCampaigns(status, limit, offset);
    return ok(res, data);
  }

  async getCampaign(req: Request, res: Response) {
    const row = await svc.getCampaign(req.params.id as string);
    if (!row) return fail(res, 404, "Not found");
    return ok(res, row);
  }

  async updateStatus(req: Request, res: Response) {
    const adminId = req.user?.id;
    if (!adminId) return fail(res, 401, "Unauthorized");
    const { status, note } = req.body ?? {};
    if (!status) return fail(res, 400, "status required");
    try {
      const row = await svc.adminUpdateStatus(req.params.id as string, adminId, status, note);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }

  async listContributions(req: Request, res: Response) {
    const status = req.query.status as string | undefined;
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const data = await svc.adminListContributions(limit, offset, status);
    return ok(res, data);
  }
}
