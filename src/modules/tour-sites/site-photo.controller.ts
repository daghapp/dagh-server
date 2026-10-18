// ───────────────
// SITE PHOTO CONTROLLER (§4) — thin HTTP layer for site photos
// Maps service error codes to HTTP status, handles multer errors.
// ───────────────

import { Request, Response } from "express";
import { created, fail, ok } from "../../helpers/response.js";
import {
  uploadSitePhoto,
  listApprovedPhotos,
  moderationQueue,
  moderatePhoto,
} from "./site-photo.service.js";
import { rejectPhotoSchema, listPhotosQuerySchema } from "../../validator/site-photo-validator.js";

export class SitePhotoController {
  async uploadPhoto(req: Request, res: Response): Promise<Response> {
    try {
      const siteId = req.params.siteId as string;
      const file = req.file;

      if (!file) {
        return fail(res, 400, "No file uploaded");
      }

      const uploaderId = req.user?.id || null;

      const result = await uploadSitePhoto({
        tourSiteId: siteId,
        uploaderId,
        file: {
          buffer: file.buffer,
          mimetype: file.mimetype,
          size: file.size,
        },
      });

      return created(
        res,
        result,
        "Photo uploaded successfully. It will be reviewed by moderators before appearing in the gallery.",
      );
    } catch (error: unknown) {
      const err = error as Error;
      const message = err.message;

      if (message === "SITE_NOT_FOUND") {
        return fail(res, 404, "Tour site not found");
      }
      if (message === "FILE_TOO_LARGE") {
        return fail(res, 400, "Image must be smaller than 10MB");
      }
      if (message === "UNSUPPORTED_FORMAT") {
        return fail(res, 400, "Image must be in JPEG or PNG format");
      }
      if (message === "RESOLUTION_TOO_LOW") {
        return fail(res, 400, "Image must be at least 800x600 pixels");
      }

      console.error("[site-photo] upload failed:", error);
      return fail(res, 500, "Upload failed");
    }
  }

  async getSitePhotos(req: Request, res: Response): Promise<Response> {
    try {
      const siteId = req.params.siteId as string;
      const query = listPhotosQuerySchema.parse(req.query);
      const result = await listApprovedPhotos(siteId, {
        page: query.page,
        limit: query.limit,
      });
      return ok(res, result);
    } catch (error: unknown) {
      const err = error as Error;
      const message = err.message;

      if (message.includes("Invalid") || message.includes("Zod")) {
        return fail(res, 400, "Invalid query parameters");
      }
      if (message === "SITE_NOT_FOUND") {
        return fail(res, 404, "Tour site not found");
      }

      console.error("[site-photo] get photos failed:", error);
      return fail(res, 500, "Failed to retrieve photos");
    }
  }

  async moderationQueue(req: Request, res: Response): Promise<Response> {
    try {
      const query = listPhotosQuerySchema.parse(req.query);
      const result = await moderationQueue({
        status: query.status,
        page: query.page,
        limit: query.limit,
      });
      return ok(res, result);
    } catch (error: unknown) {
      const err = error as Error;
      const message = err.message;

      if (message.includes("Invalid") || message.includes("Zod")) {
        return fail(res, 400, "Invalid query parameters");
      }

      console.error("[site-photo] moderation queue failed:", error);
      return fail(res, 500, "Failed to retrieve moderation queue");
    }
  }

  async moderatePhoto(req: Request, res: Response): Promise<Response> {
    try {
      const photoId = req.params.photoId as string;
      const decision = req.path.includes("/approve") ? "APPROVED" : "REJECTED";
      const adminId = req.user?.id;

      if (!adminId) {
        return fail(res, 401, "Unauthorized");
      }

      let rejectReason: string | undefined;
      if (decision === "REJECTED") {
        const body = rejectPhotoSchema.parse(req.body);
        rejectReason = body.rejectReason;
      }

      const result = await moderatePhoto(photoId, adminId, decision, rejectReason);
      return ok(res, result, `Photo ${decision.toLowerCase()} successfully`);
    } catch (error: unknown) {
      const err = error as Error;
      const message = err.message;

      if (message.includes("Invalid") || message.includes("Zod")) {
        return fail(res, 400, "Invalid request body");
      }
      if (message === "PHOTO_NOT_FOUND") {
        return fail(res, 404, "Photo not found");
      }
      if (message === "PHOTO_ALREADY_MODERATED") {
        return fail(res, 409, "Photo already moderated");
      }
      if (message === "INVALID_REJECT_REASON") {
        return fail(res, 400, "Invalid reject reason - must be at least 5 characters");
      }

      console.error("[site-photo] moderate photo failed:", error);
      return fail(res, 500, "Failed to moderate photo");
    }
  }
}
