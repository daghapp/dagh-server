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
 *     summary: Upload an experience (caption and/or photo) for a tour site
 *     description: |
 *       Submit a user experience for a tour site. Send either a caption, a photo,
 *       or both. Photos (JPEG/PNG, max 10MB, min 800x600) and captions (max 2000
 *       chars) go to the moderation queue as PENDING before appearing in the
 *       public gallery. Use `multipart/form-data` when sending a file, or
 *       `application/json` for a text-only experience.
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
 *             properties:
 *               caption:
 *                 type: string
 *                 maxLength: 2000
 *                 description: The user's experience/comment
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Optional image file (JPEG/PNG, 800x600 minimum, 10MB max)
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - caption
 *             properties:
 *               caption:
 *                 type: string
 *                 maxLength: 2000
 *     responses:
 *       201:
 *         description: Experience submitted successfully (pending moderation)
 *       400:
 *         description: Missing caption and image, or invalid file/caption
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Tour site not found
 *       500:
 *         description: Upload failed
 */
// Single multer pass with mapped errors. Multer must run exactly once per
// request: it consumes the multipart stream, so invoking it again (as an
// earlier revision did) left req.file unset / errored the second parse.
const handleSitePhotoUpload = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
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
};

router.post(
  "/:siteId/photos",
  protectedRoute,
  handleSitePhotoUpload,
  controller.uploadPhoto.bind(controller),
);

/**
 * @swagger
 * /tour-sites/{siteId}/photos/{photoId}:
 *   patch:
 *     summary: Edit your experience caption
 *     description: Owner-only. Updating the caption moves the experience back to PENDING for re-moderation.
 *     tags: [Tour Site Photos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: siteId
 *         required: true
 *         schema:
 *           type: string
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
 *               - caption
 *             properties:
 *               caption:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 2000
 *     responses:
 *       200:
 *         description: Experience updated (pending moderation)
 *       400:
 *         description: Invalid caption
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not the owner
 *       404:
 *         description: Experience not found
 *       500:
 *         description: Failed to update experience
 *   delete:
 *     summary: Delete your experience
 *     description: Owner or admin. Removes the gallery item and its Cloudinary asset.
 *     tags: [Tour Site Photos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: siteId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: photoId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Experience deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not the owner
 *       404:
 *         description: Experience not found
 *       500:
 *         description: Failed to delete experience
 */
router.patch("/:siteId/photos/:photoId", protectedRoute, controller.updatePhoto.bind(controller));

router.delete("/:siteId/photos/:photoId", protectedRoute, controller.deletePhoto.bind(controller));

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
