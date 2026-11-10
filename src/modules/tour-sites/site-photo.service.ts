// ───────────────
// SITE PHOTO SERVICE (§4) — business logic for community photo uploads
// Plain-argument functions for testability. Enforces validation, moderation queue.
// ───────────────

import { prisma } from "../../config/index.js";
import {
  CAPTION_MAX_LENGTH,
  normalizeCaption,
  validatePhotoUpload,
} from "../../validator/site-photo-validator.js";
import { notifyAdmins } from "../../helpers/notify-admins.js";
import type { SitePhoto } from "../../../generated/prisma/client.js";
import { optimizeImageUrl } from "../../helpers/image-url.js";

export interface SitePhotoFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface CloudinaryUploadResult {
  url: string;
  publicId: string;
  width: number;
  height: number;
  sizeBytes: number;
  thumbUrl: string;
}

export interface UploadBufferToCloudinaryOptions {
  folder?: string;
}

// Injectable uploader seam for testing
export const cloudinaryUploader = {
  async uploadBufferToCloudinary(
    buffer: Buffer,
    options: UploadBufferToCloudinaryOptions = {},
  ): Promise<CloudinaryUploadResult> {
    const { v2: cloudinary } = await import("cloudinary");
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: options.folder || "dagh/site-photos",
          resource_type: "image",
          eager: [
            { width: 400, height: 400, crop: "limit", fetch_format: "webp", quality: "auto" },
          ],
          quality: "auto",
          fetch_format: "auto",
        },
        (error, result) => {
          if (error) {
            reject(error);
            return;
          }
          if (!result) {
            reject(new Error("Cloudinary upload failed"));
            return;
          }
          // Compute thumbnail URL - Cloudinary can provide eager transformations
          const thumbUrl = result.eager?.[0]?.secure_url || result.secure_url;
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            width: result.width,
            height: result.height,
            sizeBytes: result.bytes || buffer.length,
            thumbUrl,
          });
        },
      );
      uploadStream.end(buffer);
    });
  },
};

export function setCloudinaryUploaderForTesting(uploader: {
  uploadBufferToCloudinary: (
    buffer: Buffer,
    options?: UploadBufferToCloudinaryOptions,
  ) => Promise<CloudinaryUploadResult>;
}): void {
  cloudinaryUploader.uploadBufferToCloudinary = uploader.uploadBufferToCloudinary;
}

export function resetCloudinaryUploaderForTesting(): void {
  // Will be reset by reassignment if needed in tests
}

export async function uploadSitePhoto({
  tourSiteId,
  uploaderId,
  file,
  caption,
}: {
  tourSiteId: string;
  uploaderId: string | null;
  file?: SitePhotoFile;
  caption?: string | null;
}): Promise<SitePhoto> {
  const tourSite = await prisma.tourSite.findUnique({
    where: { id: tourSiteId },
  });

  if (!tourSite) {
    throw new Error("SITE_NOT_FOUND");
  }

  const normalizedCaption = normalizeCaption(caption);

  if (!file && !normalizedCaption) {
    throw new Error("CAPTION_REQUIRED");
  }

  if (normalizedCaption && normalizedCaption.length > CAPTION_MAX_LENGTH) {
    throw new Error("CAPTION_TOO_LONG");
  }

  let uploadData: {
    url: string | null;
    publicId: string | null;
    thumbUrl: string | null;
    width: number | null;
    height: number | null;
    sizeBytes: number | null;
  } = {
    url: null,
    publicId: null,
    thumbUrl: null,
    width: null,
    height: null,
    sizeBytes: null,
  };

  if (file) {
    const uploadResult = await cloudinaryUploader.uploadBufferToCloudinary(file.buffer);

    const validation = validatePhotoUpload({
      sizeBytes: uploadResult.sizeBytes || file.size,
      mimeType: file.mimetype,
      width: uploadResult.width,
      height: uploadResult.height,
    });

    if (!validation.ok) {
      // Best-effort cleanup of uploaded asset
      try {
        const { v2: cloudinary } = await import("cloudinary");
        await cloudinary.uploader.destroy(uploadResult.publicId);
      } catch (destroyError) {
        console.error("[site-photo] cleanup failed:", destroyError);
      }
      throw new Error(validation.code);
    }

    uploadData = {
      url: uploadResult.url,
      publicId: uploadResult.publicId,
      thumbUrl: uploadResult.thumbUrl,
      width: uploadResult.width,
      height: uploadResult.height,
      sizeBytes: uploadResult.sizeBytes,
    };
  }

  const photo = await prisma.sitePhoto.create({
    data: {
      tourSiteId,
      uploaderId,
      caption: normalizedCaption,
      ...uploadData,
      status: "PENDING",
    },
  });

  // Fire-and-forget admin notification - never fail the upload
  notifyAdmins({
    category: "tours",
    message: file
      ? `New photo submitted for moderation: ${tourSite.name}`
      : `New experience story submitted for moderation: ${tourSite.name}`,
    actionUrl: "/admin/site-photos",
  }).catch((err) => {
    console.error("[site-photo] notifyAdmins failed:", err);
  });

  return photo;
}

async function destroyCloudinaryAsset(publicId: string | null): Promise<void> {
  // Seeded rows point at existing hero images, not assets we own.
  if (!publicId || publicId.startsWith("seed-gallery:")) return;

  try {
    const { v2: cloudinary } = await import("cloudinary");
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error("[site-photo] asset cleanup failed:", error);
  }
}

export async function updateSitePhotoCaption({
  photoId,
  tourSiteId,
  userId,
  caption,
}: {
  photoId: string;
  tourSiteId: string;
  userId: string;
  caption: string;
}): Promise<SitePhoto> {
  const photo = await prisma.sitePhoto.findUnique({
    where: { id: photoId },
  });

  if (!photo || photo.tourSiteId !== tourSiteId) {
    throw new Error("PHOTO_NOT_FOUND");
  }

  if (photo.uploaderId !== userId) {
    throw new Error("NOT_OWNER");
  }

  const normalizedCaption = normalizeCaption(caption);
  if (!normalizedCaption) {
    throw new Error("CAPTION_REQUIRED");
  }

  // Edited experiences go back through moderation so approved text cannot be
  // swapped for unreviewed content.
  return prisma.sitePhoto.update({
    where: { id: photoId },
    data: {
      caption: normalizedCaption,
      status: "PENDING",
      rejectReason: null,
      moderatedBy: null,
      moderatedAt: null,
    },
  });
}

export async function deleteSitePhoto({
  photoId,
  tourSiteId,
  userId,
  isAdmin,
}: {
  photoId: string;
  tourSiteId: string;
  userId: string;
  isAdmin: boolean;
}): Promise<SitePhoto> {
  const photo = await prisma.sitePhoto.findUnique({
    where: { id: photoId },
  });

  if (!photo || photo.tourSiteId !== tourSiteId) {
    throw new Error("PHOTO_NOT_FOUND");
  }

  if (!isAdmin && photo.uploaderId !== userId) {
    throw new Error("NOT_OWNER");
  }

  const deleted = await prisma.sitePhoto.delete({
    where: { id: photoId },
  });

  await destroyCloudinaryAsset(photo.publicId);

  return deleted;
}

export async function listApprovedPhotos(
  tourSiteId: string,
  { page, limit }: { page: number; limit: number },
): Promise<{
  items: SitePhoto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const tourSite = await prisma.tourSite.findUnique({
    where: { id: tourSiteId },
  });

  if (!tourSite) {
    throw new Error("SITE_NOT_FOUND");
  }

  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    prisma.sitePhoto.findMany({
      where: { tourSiteId, status: "APPROVED" },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.sitePhoto.count({
      where: { tourSiteId, status: "APPROVED" },
    }),
  ]);

  const optimizedItems = items.map((item) => ({
    ...item,
    url: optimizeImageUrl(item.url, 1200),
    thumbUrl: optimizeImageUrl(item.thumbUrl ?? item.url, 400),
  }));

  return {
    items: optimizedItems,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function moderationQueue({
  status,
  page,
  limit,
}: {
  status?: "PENDING" | "APPROVED" | "REJECTED";
  page: number;
  limit: number;
}): Promise<{
  items: (SitePhoto & { tourSite: { name: string; region: string | null } })[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const skip = (page - 1) * limit;
  // Default to the moderation backlog: without a filter the queue would page
  // through every seeded APPROVED photo before reaching anything pending.
  const where = { status: status ?? "PENDING" };

  const [items, total] = await Promise.all([
    prisma.sitePhoto.findMany({
      where,
      include: {
        tourSite: {
          select: {
            name: true,
            region: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
      skip,
      take: limit,
    }),
    prisma.sitePhoto.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function moderatePhoto(
  photoId: string,
  adminId: string,
  decision: "APPROVED" | "REJECTED",
  rejectReason?: string,
): Promise<SitePhoto> {
  const photo = await prisma.sitePhoto.findUnique({
    where: { id: photoId },
  });

  if (!photo) {
    throw new Error("PHOTO_NOT_FOUND");
  }

  if (photo.status === decision) {
    throw new Error("PHOTO_ALREADY_MODERATED");
  }

  if (decision === "REJECTED") {
    if (!rejectReason || rejectReason.trim().length < 5) {
      throw new Error("INVALID_REJECT_REASON");
    }
  }

  const updated = await prisma.sitePhoto.update({
    where: { id: photoId },
    data: {
      status: decision,
      moderatedBy: adminId,
      moderatedAt: new Date(),
      rejectReason: decision === "REJECTED" ? rejectReason?.trim() : null,
    },
  });

  return updated;
}
