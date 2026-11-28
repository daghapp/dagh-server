import { Request, Response } from "express";
import { ok, fail } from "../../helpers/response.js";
import * as svc from "./listings.service.js";

export class ListingsController {
  async create(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    const data = req.body ?? {};
    if (!data.title || !data.description || !data.priceGhs || !data.region)
      return fail(res, 400, "title, description, priceGhs, region required");
    try {
      const row = await svc.createListing(userId, data);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
  async submit(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    try {
      const row = await svc.submitForVerification(req.params.id as string, userId);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
  async requestVerification(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    try {
      const row = await svc.requestVerification(req.params.id as string, userId);
      return ok(res, row, "Verification requested");
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }

  async list(req: Request, res: Response) {
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);
    const data = await svc.listListings(
      {
        region: req.query.region as string,
        type: req.query.type as string,
        status: req.query.status as string,
      },
      limit,
      offset,
    );
    return ok(res, data);
  }
  async get(req: Request, res: Response) {
    const row = await svc.getListing(req.params.id as string);
    if (!row) return fail(res, 404, "Not found");
    return ok(res, row);
  }
  async adminQueue(req: Request, res: Response) {
    const status = (req.query.status as string) ?? "PENDING_VERIFICATION";
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const data = await svc.adminQueue(status, limit, offset);
    return ok(res, data);
  }
  async adminDecide(req: Request, res: Response) {
    const adminId = req.user?.id;
    if (!adminId) return fail(res, 401, "Unauthorized");
    const { approve } = req.body ?? {};
    if (typeof approve !== "boolean") return fail(res, 400, "approve boolean required");
    try {
      const row = await svc.adminDecide(req.params.id as string, adminId, approve);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
  async issueBadge(req: Request, res: Response) {
    const adminId = req.user?.id;
    if (!adminId) return fail(res, 401, "Unauthorized");
    const { badge } = req.body ?? {};
    if (!badge) return fail(res, 400, "badge required");
    try {
      const row = await svc.issueBadge(req.params.id as string, adminId, badge);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
  async createSearchRequest(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    const { listingId, query, searchType } = req.body ?? {};
    if (!query || !searchType) return fail(res, 400, "query and searchType required");
    try {
      const row = await svc.createSearchRequest(userId, { listingId, query, searchType });
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
  async listSearchRequests(req: Request, res: Response) {
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const data = await svc.listSearchRequests(limit, offset);
    return ok(res, data);
  }
  async updateSearchRequest(req: Request, res: Response) {
    const { status, resultRef } = req.body ?? {};
    if (!status) return fail(res, 400, "status required");
    try {
      const row = await svc.updateSearchRequest(req.params.id as string, status, resultRef);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
}
