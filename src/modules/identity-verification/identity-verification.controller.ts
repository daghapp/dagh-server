import { Request, Response } from "express";
import { ok, fail } from "../../helpers/response.js";
import * as svc from "./identity-verification.service.js";
import { loadAdminRole, hasPermissionKey, PERMISSIONS } from "../../middleware/permissions.js";

export class IdentityVerificationController {
  async start(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    try {
      const row = await svc.startIdentityVerification(userId);
      return ok(res, row, "Verification started");
    } catch (e: any) {
      return fail(res, 500, e?.message ?? "Failed");
    }
  }

  async status(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    const row = await svc.getIdentityStatus(userId);
    return ok(res, row ?? { status: "NOT_STARTED" });
  }

  async uploadId(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    const { type, number, frontUrl, backUrl } = req.body ?? {};
    if (!type || !number || !frontUrl) return fail(res, 400, "type, number and frontUrl required");
    try {
      const row = await svc.saveIdDocument(userId, { type, number, frontUrl, backUrl });
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }

  async uploadSelfie(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    const { selfieUrl } = req.body ?? {};
    if (!selfieUrl) return fail(res, 400, "selfieUrl required");
    try {
      const row = await svc.saveSelfie(userId, selfieUrl);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }

  async sendOtp(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    try {
      const data = await svc.sendIdentityOtp(userId);
      return ok(res, data, "Verification code sent");
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }

  async verifyOtp(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    const { code } = req.body ?? {};
    if (!code || !/^\d{6}$/.test(String(code))) return fail(res, 400, "6-digit code required");
    try {
      const row = await svc.verifyIdentityOtp(userId, String(code));
      return ok(res, row, "Code verified");
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }

  async submit(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    try {
      const row = await svc.submitForReview(userId);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }

  async appeal(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    const { reason, evidenceUrls } = req.body ?? {};
    if (!reason) return fail(res, 400, "reason required");
    try {
      const row = await svc.createAppeal(userId, reason, evidenceUrls);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }

  // Admin
  async adminList(req: Request, res: Response) {
    const status = req.query.status as string | undefined;
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const data = await svc.adminListVerifications(status, limit, offset);
    const role = await loadAdminRole(req);
    const canViewBiometric = role
      ? hasPermissionKey(role, PERMISSIONS.IDENTITY.VIEW_BIOMETRIC)
      : false;
    if (!canViewBiometric) {
      data.rows = data.rows.map((row) => ({
        ...row,
        idFrontUrl: null,
        idBackUrl: null,
        selfieUrl: null,
        idNumberHash: null,
      }));
    }
    return ok(res, data);
  }

  async adminDecide(req: Request, res: Response) {
    const adminId = req.user?.id;
    if (!adminId) return fail(res, 401, "Unauthorized");
    const userId = req.params.userId as string;
    const { approve, reason } = req.body ?? {};
    if (typeof approve !== "boolean") return fail(res, 400, "approve boolean required");
    try {
      const row = await svc.adminDecide(userId, adminId, approve, reason);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }

  async adminDecideAppeal(req: Request, res: Response) {
    const adminId = req.user?.id;
    if (!adminId) return fail(res, 401, "Unauthorized");
    const appealId = req.params.appealId as string;
    const { approve, note } = req.body ?? {};
    if (typeof approve !== "boolean") return fail(res, 400, "approve boolean required");
    try {
      const row = await svc.adminDecideAppeal(appealId, adminId, approve, note);
      return ok(res, row);
    } catch (e: any) {
      return fail(res, 400, e?.message ?? "Failed");
    }
  }
}
