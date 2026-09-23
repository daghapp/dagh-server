// ─────────────────────────────────────────
// Community Routes — mounted at /community
// ─────────────────────────────────────────

import express from "express";
import { CommunityController } from "../modules/community/community.controller.js";
import { YouTubeVerifyController } from "../modules/community/youtube-verify.controller.js";
import protectedRoute from "../middleware/protected.js";
import requireAdmin from "../middleware/admin.js";
import { validate } from "../middleware/validation.js";
import { syncCommunityVideosSchema } from "../validator/community-validator.js";

const router = express.Router();
const controller = new CommunityController();
const youtubeVerifyController = new YouTubeVerifyController();

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

// ── YouTube subscription verification (optional OAuth) ─────────────────────────

/**
 * @swagger
 * /community/youtube/start/{videoId}:
 *   get:
 *     summary: Start server-side YouTube subscription verification for a video
 *     description: >
 *       Returns a Google authorization URL that, when opened, lets the user
 *       grant read-only YouTube access to the account they subscribe with. Once
 *       authorized, Google redirects to /community/youtube/callback, which checks
 *       the subscription against the configured channel and unlocks the video on
 *       success. Requires YOUTUBE_OAUTH_CLIENT_ID / YOUTUBE_OAUTH_CLIENT_SECRET.
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
 *         description: Authorization URL created
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
 *                     authUrl:
 *                       type: string
 *                     expiresIn:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Video not found
 *       503:
 *         description: YouTube OAuth not configured
 *       500:
 *         description: Internal server error
 */
router.get(
  "/youtube/start/:videoId",
  protectedRoute,
  youtubeVerifyController.start.bind(youtubeVerifyController),
);

/**
 * @swagger
 * /community/youtube/callback:
 *   get:
 *     summary: YouTube OAuth callback (server-side subscription verification)
 *     description: >
 *       Public OAuth redirect target registered in the Google console. Exchanges
 *       the authorization code, checks whether the user is subscribed to the
 *       configured channel via the YouTube Data API, unlocks the video when true,
 *       caches the verdict, and redirects back to YOUTUBE_VERIFY_RETURN_URL with
 *       subscribed / videoId / unlocked query params.
 *     tags: [Community]
 *     parameters:
 *       - in: query
 *         name: code
 *         schema:
 *           type: string
 *         description: Google authorization code
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         description: Signed state token from /community/youtube/start/:videoId
 *       - in: query
 *         name: error
 *         schema:
 *           type: string
 *         description: Present when the user denied the consent screen
 *     responses:
 *       302:
 *         description: Redirect to the app deep link with the verification verdict
 *       500:
 *         description: Internal server error
 */
router.get("/youtube/callback", youtubeVerifyController.callback.bind(youtubeVerifyController));

/**
 * @swagger
 * /community/youtube/status/{videoId}:
 *   get:
 *     summary: Get durable unlock state plus the last cached subscription verdict
 *     description: >
 *       Combines the persistent VideoUnlock record with the most recent
 *       server-side verification verdict (cached up to YOUTUBE_VERIFY_CACHE_MS).
 *       Call on feed load / app resume to rehydrate buttons without re-running
 *       the OAuth flow.
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
 *         description: Verification status
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
 *                     isUnlocked:
 *                       type: boolean
 *                     unlockedAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     verifiedSubscribed:
 *                       type: boolean
 *                       nullable: true
 *                       description: Most recent server-side verdict, null when not cached
 *                     verifiedAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     cached:
 *                       type: boolean
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get(
  "/youtube/status/:videoId",
  protectedRoute,
  youtubeVerifyController.status.bind(youtubeVerifyController),
);

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

/**
 * @swagger
 * /community/admin/sync-youtube:
 *   post:
 *     summary: Sync latest uploads from the configured YouTube channel (admin)
 *     description: >
 *       Resolves the channel (YOUTUBE_CHANNEL_ID / YOUTUBE_CHANNEL_HANDLE in the
 *       environment, or an explicit channelId/handle in the request body), pulls
 *       the latest uploads via the YouTube Data API, and adds any missing videos
 *       to the feed.
 *
 *       Existing cards are never overwritten, so admin edits and soft-deletes are
 *       preserved across sync runs. Teasers are derived from the video's own
 *       embed URL — the app plays the first 45 seconds as the preview clip and
 *       then surfaces the "Watch on YouTube" / subscribe call-to-action.
 *
 *       A single sync is rate-limited per channel by a Redis-backed cooldown
 *       (YOUTUBE_SYNC_COOLDOWN_MS, default 1 hour) to protect API quota.
 *     tags: [Community]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               channelId:
 *                 type: string
 *                 description: Override the configured channel ID
 *               handle:
 *                 type: string
 *                 description: Override the configured channel handle (e.g. "@diasporaaffairsgh")
 *               maxResults:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 20
 *                 default: 6
 *                 description: Number of latest uploads to sync
 *     responses:
 *       200:
 *         description: Sync summary
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
 *                     channelId:
 *                       type: string
 *                     fetched:
 *                       type: integer
 *                     created:
 *                       type: integer
 *                     alreadyPresent:
 *                       type: integer
 *                     syncedAt:
 *                       type: string
 *                       format: date-time
 *                     cached:
 *                       type: boolean
 *                       description: true when returned from the Redis cooldown cache instead of the API
 *       400:
 *         description: Invalid request body
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (non-admin)
 *       502:
 *         description: YouTube Data API error
 *       503:
 *         description: YouTube API key not configured
 *       500:
 *         description: Internal server error
 */
router.post(
  "/admin/sync-youtube",
  protectedRoute,
  requireAdmin,
  validate(syncCommunityVideosSchema),
  controller.adminSyncChannel.bind(controller),
);

export { router };
