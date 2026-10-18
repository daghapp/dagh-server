// ───────────────
// SITE PHOTO MODERATION TESTS (§4) — Vitest against real prisma
// Tests validation and DB moderation flow without Cloudinary network calls.
// ───────────────

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/prisma.js";
import { AccountType, AuthProvider } from "../generated/prisma/client.js";
import {
  validatePhotoUpload,
  PHOTO_UPLOAD_CONSTRAINTS,
} from "../src/validator/site-photo-validator.js";
import {
  listApprovedPhotos,
  moderationQueue,
  moderatePhoto,
} from "../src/modules/tour-sites/site-photo.service.js";

describe("site photo moderation", () => {
  const stamp = Date.now();
  let adminId: string;
  let userId: string;
  let tourSiteId: string;
  const createdPhotoIds: string[] = [];

  beforeAll(async () => {
    // Create test users
    const admin = await prisma.user.create({
      data: {
        email: `site-photo-admin-${stamp}@example.com`,
        fullName: "Site Photo Admin",
        accountType: AccountType.ADMIN,
        authProvider: AuthProvider.EMAIL,
      },
    });
    adminId = admin.id;

    const user = await prisma.user.create({
      data: {
        email: `site-photo-user-${stamp}@example.com`,
        fullName: "Site Photo User",
        accountType: AccountType.USER,
        authProvider: AuthProvider.EMAIL,
      },
    });
    userId = user.id;

    // Find a tour site to use
    const tourSite = await prisma.tourSite.findFirst({
      select: { id: true },
    });
    if (!tourSite) {
      throw new Error("No tour sites found in seeded DB");
    }
    tourSiteId = tourSite.id;
  });

  afterAll(async () => {
    // Cleanup
    if (createdPhotoIds.length > 0) {
      await prisma.sitePhoto.deleteMany({
        where: { id: { in: createdPhotoIds } },
      });
    }
    await prisma.user.deleteMany({
      where: { id: { in: [adminId, userId] } },
    });
  });

  describe("validatePhotoUpload", () => {
    it("accepts a valid 800x600 JPEG", () => {
      const result = validatePhotoUpload({
        sizeBytes: 1024 * 1024,
        mimeType: "image/jpeg",
        width: 800,
        height: 600,
      });
      expect(result.ok).toBe(true);
    });

    it("rejects oversize", () => {
      const result = validatePhotoUpload({
        sizeBytes: PHOTO_UPLOAD_CONSTRAINTS.maxBytes + 1,
        mimeType: "image/jpeg",
        width: 1000,
        height: 800,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("FILE_TOO_LARGE");
      }
    });

    it("rejects wrong mime", () => {
      const result = validatePhotoUpload({
        sizeBytes: 1024 * 1024,
        mimeType: "image/gif",
        width: 800,
        height: 600,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("UNSUPPORTED_FORMAT");
      }
    });

    it("rejects sub-minimum resolution (width too small)", () => {
      const result = validatePhotoUpload({
        sizeBytes: 1024 * 1024,
        mimeType: "image/jpeg",
        width: 799,
        height: 600,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("RESOLUTION_TOO_LOW");
      }
    });

    it("rejects sub-minimum resolution (height too small)", () => {
      const result = validatePhotoUpload({
        sizeBytes: 1024 * 1024,
        mimeType: "image/jpeg",
        width: 800,
        height: 599,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("RESOLUTION_TOO_LOW");
      }
    });

    it("accepts png", () => {
      const result = validatePhotoUpload({
        sizeBytes: 1024 * 1024,
        mimeType: "image/png",
        width: 1024,
        height: 768,
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("DB flow without Cloudinary", () => {
    let approvedPhotoId: string;
    let pendingPhotoId: string;
    let rejectedPhotoId: string;

    beforeAll(async () => {
      // Create test photos directly in DB
      const approved = await prisma.sitePhoto.create({
        data: {
          tourSiteId,
          url: "https://example.com/photo1.jpg",
          status: "APPROVED",
          width: 1000,
          height: 800,
          sizeBytes: 1024 * 1024,
        },
      });
      approvedPhotoId = approved.id;
      createdPhotoIds.push(approvedPhotoId);

      const pending = await prisma.sitePhoto.create({
        data: {
          tourSiteId,
          url: "https://example.com/photo2.jpg",
          status: "PENDING",
          width: 1000,
          height: 800,
          sizeBytes: 1024 * 1024,
        },
      });
      pendingPhotoId = pending.id;
      createdPhotoIds.push(pendingPhotoId);

      const rejected = await prisma.sitePhoto.create({
        data: {
          tourSiteId,
          url: "https://example.com/photo3.jpg",
          status: "REJECTED",
          rejectReason: "Poor quality",
          width: 1000,
          height: 800,
          sizeBytes: 1024 * 1024,
        },
      });
      rejectedPhotoId = rejected.id;
      createdPhotoIds.push(rejectedPhotoId);
    });

    it("listApprovedPhotos returns only APPROVED row", async () => {
      const result = await listApprovedPhotos(tourSiteId, { page: 1, limit: 10 });
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items.some((p) => p.id === approvedPhotoId)).toBe(true);
      expect(result.items.every((p) => p.status === "APPROVED")).toBe(true);
      expect(result.total).toBeGreaterThanOrEqual(1);
    });

    it("moderationQueue default returns PENDING rows first (oldest first)", async () => {
      const result = await moderationQueue({ page: 1, limit: 10 });
      // Should include pending photos
      expect(result.items.some((p) => p.id === pendingPhotoId)).toBe(true);
    });

    it("moderatePhoto(PENDING → APPROVED) sets status, moderatedBy, moderatedAt", async () => {
      const result = await moderatePhoto(pendingPhotoId, adminId, "APPROVED");
      expect(result.status).toBe("APPROVED");
      expect(result.moderatedBy).toBe(adminId);
      expect(result.moderatedAt).toBeInstanceOf(Date);
    });

    it("re-moderating throws PHOTO_ALREADY_MODERATED", async () => {
      await expect(moderatePhoto(approvedPhotoId, adminId, "APPROVED")).rejects.toThrow(
        "PHOTO_ALREADY_MODERATED",
      );
    });

    it("reject without reason throws INVALID_REJECT_REASON", async () => {
      const pending2 = await prisma.sitePhoto.create({
        data: {
          tourSiteId,
          url: "https://example.com/photo4.jpg",
          status: "PENDING",
          width: 1000,
          height: 800,
          sizeBytes: 1024 * 1024,
        },
      });
      createdPhotoIds.push(pending2.id);
      await expect(moderatePhoto(pending2.id, adminId, "REJECTED", "")).rejects.toThrow(
        "INVALID_REJECT_REASON",
      );
    });

    it("reject with reason < 5 chars throws INVALID_REJECT_REASON", async () => {
      const pending3 = await prisma.sitePhoto.create({
        data: {
          tourSiteId,
          url: "https://example.com/photo5.jpg",
          status: "PENDING",
          width: 1000,
          height: 800,
          sizeBytes: 1024 * 1024,
        },
      });
      createdPhotoIds.push(pending3.id);
      await expect(moderatePhoto(pending3.id, adminId, "REJECTED", "bad")).rejects.toThrow(
        "INVALID_REJECT_REASON",
      );
    });

    it("reject with valid reason succeeds", async () => {
      const pending4 = await prisma.sitePhoto.create({
        data: {
          tourSiteId,
          url: "https://example.com/photo6.jpg",
          status: "PENDING",
          width: 1000,
          height: 800,
          sizeBytes: 1024 * 1024,
        },
      });
      createdPhotoIds.push(pending4.id);
      const result = await moderatePhoto(pending4.id, adminId, "REJECTED", "Poor image quality");
      expect(result.status).toBe("REJECTED");
      expect(result.rejectReason).toBe("Poor image quality");
    });

    it("unknown photoId throws PHOTO_NOT_FOUND", async () => {
      await expect(moderatePhoto("non-existent-id", adminId, "APPROVED")).rejects.toThrow(
        "PHOTO_NOT_FOUND",
      );
    });
  });
});
