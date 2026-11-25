import { Request, Response } from "express";
import { ok, fail } from "../../helpers/response.js";
import * as svc from "./webinars.service.js";
import { requireVerified } from "../../middleware/require-verified.js";

export class WebinarsController {
  async create(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    const data = req.body ?? {};
    if (!data.title || !data.startTime) return fail(res, 400, "title and startTime required");
    try {
      const row = await svc.createWebinar(userId, data);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
  async list(req: Request, res: Response) {
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);
    const data = await svc.listWebinars(limit, offset);
    return ok(res, data);
  }
  async get(req: Request, res: Response) {
    const row = await svc.getWebinar(req.params.id as string);
    if (!row) return fail(res, 404, "Not found");
    return ok(res, row);
  }
  async register(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    try {
      const row = await svc.register(req.params.id as string, userId);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
  async paidRegister(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    const { paymentRef } = req.body ?? {};
    if (!paymentRef) return fail(res, 400, "paymentRef required");
    try {
      const row = await svc.paidRegister(req.params.id as string, userId, paymentRef);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
  async join(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    try {
      const data = await svc.join(req.params.id as string, userId);
      return ok(res, data);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
  async uploadRecording(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    const { recordingUrl } = req.body ?? {};
    if (!recordingUrl) return fail(res, 400, "recordingUrl required");
    try {
      const row = await svc.uploadRecording(req.params.id as string, userId, recordingUrl);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
  async getRecording(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    try {
      const url = await svc.getRecording(req.params.id as string, userId);
      return ok(res, { recordingUrl: url });
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
}
