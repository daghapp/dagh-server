import { Request, Response } from "express";
import { ok, fail } from "../../helpers/response.js";
import * as svc from "./daily-brief.service.js";

export class DailyBriefController {
  async latest(req: Request, res: Response) {
    const row = await svc.getLatest();
    if (!row) return fail(res, 404, "No brief");
    return ok(res, row);
  }
  async byDate(req: Request, res: Response) {
    const row = await svc.getByDate(req.params.date as string);
    if (!row) return fail(res, 404, "Not found");
    return ok(res, row);
  }
  async list(req: Request, res: Response) {
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);
    const data = await svc.listBriefs(limit, offset);
    return ok(res, data);
  }
  async generate(req: Request, res: Response) {
    const date = req.body?.date;
    const row = await svc.runDailyBrief(date ? new Date(date) : undefined);
    return ok(res, row);
  }
  async publish(req: Request, res: Response) {
    try {
      const row = await svc.publishBrief(req.params.id as string);
      return ok(res, row, "Brief published");
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
}
