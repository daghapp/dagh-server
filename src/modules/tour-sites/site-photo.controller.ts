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
  updateSitePhotoCaption,
  deleteSitePhoto,
} from "./site-photo.service.js";
import {
  rejectPhotoSchema,
  listPhotosQuerySchema,
  uploadSitePhotoBodySchema,
  updatePhotoCaptionSchema,
} from "../../validator/site-photo-validator.js";

export class SitePhotoController {
  async uploadPhoto(req: Request, res: Response): Promise<Response> {
    try {
      const siteId = req.params.siteId as string;
      const file = req.file;
      const body = uploadSitePhotoBodySchema.parse(req.body ?? {});
      const caption = body.caption ?? null;

      if (!file && !caption) {
        return fail(res, 400, "Provide an image or a caption");
      }

      const uploaderId = req.user?.id || null;

      const result = await uploadSitePhoto({
        tourSiteId: siteId,
        uploaderId,
        caption,
        ...(file
          ? {
              file: {
                buffer: file.buffer,
                mimetype: file.mimetype,
                size: file.size,
              },
            }
          : {}),
      });

      return created(
        res,
        result,
        "Experience submitted successfully. It will be reviewed by moderators before appearing in the gallery.",
      );
    } catch (error: unknown) {
      const err = error as Error;
      const message = err.message;

      if (message === "SITE_NOT_FOUND") {
        return fail(res, 404, "Tour site not found");
      }
      if (message === "CAPTION_REQUIRED") {
        return fail(res, 400, "Provide an image or a caption");
      }
      if (message === "CAPTION_TOO_LONG") {
        return fail(res, 400, "Caption must be 2000 characters or fewer");
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
      if (message.includes("Invalid") || message.includes("Zod") || message.includes("too_big")) {
        return fail(res, 400, "Invalid request body");
      }

      console.error("[site-photo] upload failed:", error);
      return fail(res, 500, "Upload failed");
    }
  }

  async updatePhoto(req: Request, res: Response): Promise<Response> {
    try {
      const siteId = req.params.siteId as string;
      const photoId = req.params.photoId as string;
      const userId = req.user?.id;

      if (!userId) {
        return fail(res, 401, "Unauthorized");
      }

      const body = updatePhotoCaptionSchema.parse(req.body ?? {});
      const result = await updateSitePhotoCaption({
        photoId,
        tourSiteId: siteId,
        userId,
        caption: body.caption,
      });

      return ok(
        res,
        result,
        "Experience updated successfully. It will be reviewed by moderators again.",
      );
    } catch (error: unknown) {
      const err = error as Error;
      const message = err.message;

      if (message === "PHOTO_NOT_FOUND") {
        return fail(res, 404, "Experience not found");
      }
      if (message === "NOT_OWNER") {
        return fail(res, 403, "You can only edit your own experiences");
      }
      if (message === "CAPTION_REQUIRED") {
        return fail(res, 400, "Caption cannot be empty");
      }
      if (message.includes("Invalid") || message.includes("Zod") || message.includes("too_big")) {
        return fail(res, 400, "Invalid request body");
      }

      console.error("[site-photo] update failed:", error);
      return fail(res, 500, "Failed to update experience");
    }
  }

  async deletePhoto(req: Request, res: Response): Promise<Response> {
    try {
      const siteId = req.params.siteId as string;
      const photoId = req.params.photoId as string;
      const userId = req.user?.id;

      if (!userId) {
        return fail(res, 401, "Unauthorized");
      }

      const result = await deleteSitePhoto({
        photoId,
        tourSiteId: siteId,
        userId,
        isAdmin: req.user?.accountType === "ADMIN",
      });

      return ok(res, result, "Experience deleted successfully");
    } catch (error: unknown) {
      const err = error as Error;
      const message = err.message;

      if (message === "PHOTO_NOT_FOUND") {
        return fail(res, 404, "Experience not found");
      }
      if (message === "NOT_OWNER") {
        return fail(res, 403, "You can only delete your own experiences");
      }

      console.error("[site-photo] delete failed:", error);
      return fail(res, 500, "Failed to delete experience");
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
