import { Request, Response } from "express";
import { ok, fail } from "../../helpers/response.js";
import * as svc from "./forums.service.js";
import { requireVerified } from "../../middleware/require-verified.js";

export class ForumsController {
  async listForums(req: Request, res: Response) {
    const rows = await svc.listForums();
    return ok(res, rows);
  }
  async createForum(req: Request, res: Response) {
    if (req.user?.accountType !== "ADMIN") return fail(res, 403, "Admin access required");
    const { slug, name, description } = req.body ?? {};
    if (!slug || !name) return fail(res, 400, "slug and name required");
    try {
      const row = await svc.createForum({ slug, name, description });
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
  async listThreads(req: Request, res: Response) {
    const slug = req.params.slug as string;
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);
    const data = await svc.listThreads(slug, limit, offset);
    return ok(res, data);
  }
  async createThread(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    const slug = req.params.slug as string;
    const { title, body } = req.body ?? {};
    if (!title || !body) return fail(res, 400, "title and body required");
    try {
      const row = await svc.createThread(userId, slug, { title, body });
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
  async getThread(req: Request, res: Response) {
    const row = await svc.getThread(req.params.id as string);
    if (!row) return fail(res, 404, "Not found");
    return ok(res, row);
  }
  async createComment(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    const { body, parentId } = req.body ?? {};
    if (!body) return fail(res, 400, "body required");
    try {
      const row = await svc.createComment(userId, req.params.id as string, body, parentId);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
  async updateThread(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    const { title, body } = req.body ?? {};
    if (title === undefined && body === undefined) return fail(res, 400, "title or body required");
    try {
      const row = await svc.updateThread(
        req.params.id as string,
        userId,
        req.user?.accountType === "ADMIN",
        { title, body },
      );
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }

  async deleteThread(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    try {
      const row = await svc.deleteThread(
        req.params.id as string,
        userId,
        req.user?.accountType === "ADMIN",
      );
      return ok(res, row, "Thread deleted");
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }

  async updateComment(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    const { body } = req.body ?? {};
    if (!body) return fail(res, 400, "body required");
    try {
      const row = await svc.updateComment(
        req.params.id as string,
        userId,
        req.user?.accountType === "ADMIN",
        body,
      );
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }

  async deleteComment(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    try {
      const row = await svc.deleteComment(
        req.params.id as string,
        userId,
        req.user?.accountType === "ADMIN",
      );
      return ok(res, row, "Comment deleted");
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }

  async adminPendingThreads(req: Request, res: Response) {
    const status = (req.query.status as string) ?? "PENDING";
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const data = await svc.listPendingThreads(status, limit, offset);
    return ok(res, data);
  }
  async adminPendingComments(req: Request, res: Response) {
    const status = (req.query.status as string) ?? "PENDING";
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const data = await svc.listPendingComments(status, limit, offset);
    return ok(res, data);
  }
  async adminDecideThread(req: Request, res: Response) {
    const adminId = req.user?.id;
    if (!adminId) return fail(res, 401, "Unauthorized");
    const { approve, reason } = req.body ?? {};
    if (typeof approve !== "boolean") return fail(res, 400, "approve boolean required");
    try {
      const row = await svc.moderateThread(req.params.id as string, adminId, approve, reason);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
  async adminDecideComment(req: Request, res: Response) {
    const adminId = req.user?.id;
    if (!adminId) return fail(res, 401, "Unauthorized");
    const { approve } = req.body ?? {};
    if (typeof approve !== "boolean") return fail(res, 400, "approve boolean required");
    try {
      const row = await svc.moderateComment(req.params.id as string, adminId, approve);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
}
