// ───────────────
// SITE PHOTO VALIDATOR (§4) — validation for community photo uploads
// Pure functions + Zod schemas for site photo upload and moderation.
// ───────────────

import { z } from "zod";

export interface PhotoUploadConstraints {
  maxBytes: number;
  minWidth: number;
  minHeight: number;
  allowedMimeTypes: string[];
}

export const PHOTO_UPLOAD_CONSTRAINTS: PhotoUploadConstraints = {
  maxBytes: 10 * 1024 * 1024, // 10MB
  minWidth: 800,
  minHeight: 600,
  allowedMimeTypes: ["image/jpeg", "image/jpg", "image/png"],
};

export const CAPTION_MAX_LENGTH = 2000;

export type PhotoUploadErrorCode =
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FORMAT"
  | "RESOLUTION_TOO_LOW"
  | "CAPTION_REQUIRED"
  | "CAPTION_TOO_LONG";

export function validatePhotoUpload(input: {
  sizeBytes: number;
  mimeType: string;
  width: number;
  height: number;
}): { ok: true } | { ok: false; code: PhotoUploadErrorCode; message: string } {
  if (input.sizeBytes > PHOTO_UPLOAD_CONSTRAINTS.maxBytes) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: "Image must be smaller than 10MB",
    };
  }

  if (!PHOTO_UPLOAD_CONSTRAINTS.allowedMimeTypes.includes(input.mimeType)) {
    return {
      ok: false,
      code: "UNSUPPORTED_FORMAT",
      message: "Image must be in JPEG or PNG format",
    };
  }

  if (
    input.width < PHOTO_UPLOAD_CONSTRAINTS.minWidth ||
    input.height < PHOTO_UPLOAD_CONSTRAINTS.minHeight
  ) {
    return {
      ok: false,
      code: "RESOLUTION_TOO_LOW",
      message: "Image must be at least 800x600 pixels",
    };
  }

  return { ok: true };
}

export const rejectPhotoSchema = z.object({
  rejectReason: z.string().trim().min(5).max(500),
});

export const uploadSitePhotoBodySchema = z.object({
  caption: z.string().trim().max(CAPTION_MAX_LENGTH).optional(),
});

export const updatePhotoCaptionSchema = z.object({
  caption: z.string().trim().min(1).max(CAPTION_MAX_LENGTH),
});

export const listPhotosQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
});

export function normalizeCaption(caption?: string | null): string | null {
  const trimmed = caption?.trim();
  return trimmed ? trimmed : null;
}

export type RejectPhotoInput = z.infer<typeof rejectPhotoSchema>;
export type UploadSitePhotoBodyInput = z.infer<typeof uploadSitePhotoBodySchema>;
export type UpdatePhotoCaptionInput = z.infer<typeof updatePhotoCaptionSchema>;
export type ListPhotosQueryInput = z.infer<typeof listPhotosQuerySchema>;
