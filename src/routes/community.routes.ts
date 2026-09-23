// ─────────────────────────────────────────
// Community Routes — mounted at /community
// ─────────────────────────────────────────

import express from "express";
import { CommunityController } from "../modules/community/community.controller.js";
import protectedRoute from "../middleware/protected.js";
import requireAdmin from "../middleware/admin.js";

const router = express.Router();
const controller = new CommunityController();

// ── User routes (all require auth) ────────────────────────────────────────────

/**
 * @swagger
 * /community/videos:
 *   get:
 *     summary: List published community video cards
 *     description: Returns paginated published videos with an isUnlocked flag for the calling user.
 *     tags: [Community]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 50
 *         description: Results per page (max 50)
 *     responses:
 *       200:
 *         description: Paginated community videos
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       title:
 *                         type: string
 *                       description:
 *                         type: string
 *                       teaserUrl:
 *                         type: string
 *                       thumbnailUrl:
 *                         type: string
 *                       youtubeVideoId:
 *                         type: string
 *                       isUnlocked:
 *                         type: boolean
 *                       unlockedAt:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *                       publishedAt:
 *                         type: string
 *                         format: date-time
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get("/videos", protectedRoute, controller.listVideos.bind(controller));

/**
 * @swagger
 * /community/my-unlocks:
 *   get:
 *     summary: Get all video IDs unlocked by the calling user
 *     description: Used on app launch to rehydrate local isSubscribed / unlock state without re-fetching every video.
 *     tags: [Community]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of unlocked video records
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     unlocks:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           videoId:
 *                             type: string
 *                           unlockedAt:
 *                             type: string
 *                             format: date-time
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get("/my-unlocks", protectedRoute, controller.getMyUnlocks.bind(controller));

/**
 * @swagger
 * /community/videos/{videoId}:
 *   get:
 *     summary: Get a single community video with unlock status
 *     tags: [Community]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: videoId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Video detail with unlock status
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Video not found
 *       500:
 *         description: Internal server error
 */
router.get("/videos/:videoId", protectedRoute, controller.getVideo.bind(controller));

/**
 * @swagger
 * /community/videos/{videoId}/interact:
 *   post:
 *     summary: Log a user interaction event for a video
 *     description: >
 *       Append-only analytics event. Safe to call for every user action.
 *       Valid actions: SUBSCRIBE_INTENT, PREVIEW_CLIP, WATCH_FULL_VIDEO, UNLOCK.
 *     tags: [Community]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: videoId
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
 *               - action
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [SUBSCRIBE_INTENT, PREVIEW_CLIP, WATCH_FULL_VIDEO, UNLOCK]
 *     responses:
 *       200:
 *         description: Interaction logged
 *       400:
 *         description: Invalid action value
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Video not found
 *       500:
 *         description: Internal server error
 */
router.post(
  "/videos/:videoId/interact",
  protectedRoute,
  controller.logInteraction.bind(controller),
);

/**
 * @swagger
 * /community/videos/{videoId}/unlock:
 *   post:
 *     summary: Mark a video as unlocked for the calling user
 *     description: >
 *       Idempotent — calling this multiple times for the same user+video is safe.
 *       Call this when the user returns to the app after visiting the YouTube channel.
 *     tags: [Community]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: videoId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Video unlocked (or already unlocked)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     isUnlocked:
 *                       type: boolean
 *                     unlockedAt:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Video not found
 *       500:
 *         description: Internal server error
 */
router.post("/videos/:videoId/unlock", protectedRoute, controller.unlockVideo.bind(controller));

// ── Admin routes ──────────────────────────────────────────────────────────────

/**
 * @swagger
 * /community/videos/{videoId}/analytics:
 *   get:
 *     summary: Get interaction analytics for a video (admin)
 *     description: Returns interaction counts by type and a conversion rate (unlocks / subscribe_intents).
 *     tags: [Community]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: videoId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Analytics data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     videoId:
 *                       type: string
 *                     title:
 *                       type: string
 *                     interactions:
 *                       type: object
 *                       properties:
 *                         SUBSCRIBE_INTENT:
 *                           type: integer
 *                         PREVIEW_CLIP:
 *                           type: integer
 *                         WATCH_FULL_VIDEO:
 *                           type: integer
 *                         UNLOCK:
 *                           type: integer
 *                     totalUnlocks:
 *                       type: integer
 *                     conversionRate:
 *                       type: number
 *                       format: float
 *                       description: totalUnlocks / SUBSCRIBE_INTENT events
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (non-admin)
 *       404:
 *         description: Video not found
 *       500:
 *         description: Internal server error
 */
router.get(
  "/videos/:videoId/analytics",
  protectedRoute,
  requireAdmin,
  controller.getVideoAnalytics.bind(controller),
);

/**
 * @swagger
 * /community/admin/videos:
 *   post:
 *     summary: Create a new community video card (admin)
 *     tags: [Community]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - description
 *               - teaserUrl
 *               - thumbnailUrl
 *               - youtubeVideoId
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               teaserUrl:
 *                 type: string
 *               thumbnailUrl:
 *                 type: string
 *               youtubeVideoId:
 *                 type: string
 *               isPublished:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       201:
 *         description: Video card created
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (non-admin)
 *       409:
 *         description: A video with this YouTube ID already exists
 *       500:
 *         description: Internal server error
 */
router.post(
  "/admin/videos",
  protectedRoute,
  requireAdmin,
  controller.adminCreateVideo.bind(controller),
);

/**
 * @swagger
 * /community/admin/videos/{videoId}:
 *   put:
 *     summary: Update a community video card (admin)
 *     tags: [Community]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: videoId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               teaserUrl:
 *                 type: string
 *               thumbnailUrl:
 *                 type: string
 *               isPublished:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Video card updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (non-admin)
 *       404:
 *         description: Video not found
 *       500:
 *         description: Internal server error
 */
router.put(
  "/admin/videos/:videoId",
  protectedRoute,
  requireAdmin,
  controller.adminUpdateVideo.bind(controller),
);

/**
 * @swagger
 * /community/admin/videos/{videoId}:
 *   delete:
 *     summary: Unpublish (soft-delete) a community video card (admin)
 *     description: Sets isPublished = false. The video and its analytics data are preserved.
 *     tags: [Community]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: videoId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Video unpublished
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (non-admin)
 *       404:
 *         description: Video not found
 *       500:
 *         description: Internal server error
 */
router.delete(
  "/admin/videos/:videoId",
  protectedRoute,
  requireAdmin,
  controller.adminDeleteVideo.bind(controller),
);

export { router };
