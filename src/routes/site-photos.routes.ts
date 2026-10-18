// ───────────────
// SITE PHOTOS ROUTES (§4) — mounted under /tour-sites in server
// Includes upload (protected), public gallery, and admin moderation endpoints.
// ───────────────

import express from "express";
import { SitePhotoController } from "../modules/tour-sites/site-photo.controller.js";
import protectedRoute from "../middleware/protected.js";
import { requireRole } from "../middleware/permissions.js";
import sitePhotoUpload from "../middleware/site-photo-upload.js";

const router = express.Router();
const controller = new SitePhotoController();

/**
 * @swagger
 * tags:
 *   name: Tour Site Photos
 *   description: Community photo uploads and moderation for tour sites
 */

/**
 * @swagger
 * /tour-sites/{siteId}/photos:
 *   post:
 *     summary: Upload a photo for a tour site
 *     description: Uploads a photo to a tour site (JPEG/PNG, max 10MB, min 800x600). Photos go to moderation queue as PENDING before appearing in public gallery.
 *     tags: [Tour Site Photos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: siteId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - image
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Image file (JPEG/PNG, 800x600 minimum, 10MB max)
 *     responses:
 *       201:
 *         description: Photo uploaded successfully (pending moderation)
 *       400:
 *         description: Invalid file (size, format, or resolution)
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Tour site not found
 *       500:
 *         description: Upload failed
 */
router.post(
  "/:siteId/photos",
  protectedRoute,
  sitePhotoUpload.single("image"),
  (req, res, next) => {
    // Handle multer errors
    sitePhotoUpload.single("image")(req, res, (err: unknown) => {
      if (err) {
        const message = (err as Error).message;
        if (message.includes("Only JPG") || message.includes("Only JPG and PNG")) {
          return res.status(400).json({ success: false, error: message });
        }
        if (message.includes("File too large") || message.includes("10MB")) {
          return res.status(400).json({ success: false, error: "Image must be smaller than 10MB" });
        }
        return res.status(400).json({ success: false, error: message || "Upload failed" });
      }
      next();
    });
  },
  controller.uploadPhoto.bind(controller),
);

/**
 * @swagger
 * /tour-sites/{siteId}/photos:
 *   get:
 *     summary: Get approved photos for a tour site
 *     description: Returns paginated list of approved photos for the tour site (public endpoint)
 *     tags: [Tour Site Photos]
 *     parameters:
 *       - in: path
 *         name: siteId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *     responses:
 *       200:
 *         description: List of approved photos
 *       404:
 *         description: Tour site not found
 *       500:
 *         description: Failed to retrieve photos
 */
router.get("/:siteId/photos", controller.getSitePhotos.bind(controller));

/**
 * @swagger
 * /tour-sites/admin/photos:
 *   get:
 *     summary: Get moderation queue (admin only)
 *     description: Returns photos pending moderation, optionally filtered by status
 *     tags: [Tour Site Photos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Moderation queue
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Failed to retrieve moderation queue
 */
router.get(
  "/admin/photos",
  protectedRoute,
  requireRole(["ADMIN"]),
  controller.moderationQueue.bind(controller),
);

/**
 * @swagger
 * /tour-sites/admin/photos/{photoId}/approve:
 *   post:
 *     summary: Approve a photo (admin only)
 *     description: Approves a photo, making it visible in the public gallery
 *     tags: [Tour Site Photos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: photoId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Photo approved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Photo not found
 *       409:
 *         description: Photo already moderated
 *       500:
 *         description: Failed to moderate photo
 */
router.post(
  "/admin/photos/:photoId/approve",
  protectedRoute,
  requireRole(["ADMIN"]),
  controller.moderatePhoto.bind(controller),
);

/**
 * @swagger
 * /tour-sites/admin/photos/{photoId}/reject:
 *   post:
 *     summary: Reject a photo (admin only)
 *     description: Rejects a photo with a reason. Reason must be at least 5 characters.
 *     tags: [Tour Site Photos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: photoId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - rejectReason
 *             properties:
 *               rejectReason:
 *                 type: string
 *                 minLength: 5
 *                 maxLength: 500
 *     responses:
 *       200:
 *         description: Photo rejected successfully
 *       400:
 *         description: Invalid reject reason
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Photo not found
 *       409:
 *         description: Photo already moderated
 *       500:
 *         description: Failed to moderate photo
 */
router.post(
  "/admin/photos/:photoId/reject",
  protectedRoute,
  requireRole(["ADMIN"]),
  controller.moderatePhoto.bind(controller),
);

export { router };
