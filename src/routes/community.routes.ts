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
 *     description: >
 *       Returns paginated published videos with an isUnlocked flag for the
 *       calling user. Each card carries `videoId` (alias of `id`) and a
 *       `channel` object with the subscribe links — the app must not hardcode
 *       the channel. Locked cards expose only a clipped preview;
 *       `youtubeVideoId` and `watchUrl` are omitted entirely until the user
 *       subscribes and unlocks, so the full video link cannot be read off the
 *       feed.
 *
 *       Pass `sort` to reorder the feed — e.g. `?sort=most_liked` or
 *       `?sort=most_watched` to rank by YouTube engagement instead of
 *       recency. The counts behind those orderings travel on every card as
 *       `viewCount` / `likeCount`, so the app can label a tab without a second
 *       request. Values are case-insensitive; an unrecognised `sort` falls back
 *       to `newest` rather than erroring, and the applied order is echoed back
 *       in `meta.sort`.
 *
 *       If the caller's channel grant is older than
 *       YOUTUBE_READ_REVERIFY_FLOOR_MS (default 5 min) it is re-checked against
 *       the YouTube subscriptions API before this page is built, so a user who
 *       unsubscribed sees `meta.hasChannelAccess: false` on this request. A
 *       grant inside the window costs no quota.
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
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [newest, most_watched, most_liked]
 *           default: newest
 *         description: >
 *           Feed ordering. `newest` = publication date (default);
 *           `most_watched` / `most_liked` rank by YouTube viewCount / likeCount
 *           as last refreshed by the channel sync, so a long-standing popular
 *           video can outrank a newer one. Ties break by publication date, then
 *           by id, so paging through a sorted feed never repeats or drops a card.
 *         example: most_liked
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
 *                       videoId:
 *                         type: string
 *                         description: Alias of id — use as the :videoId path param
 *                       title:
 *                         type: string
 *                       description:
 *                         type: string
 *                       teaserUrl:
 *                         type: string
 *                         description: Clipped preview embed URL (bounded to the preview window) — never the full video
 *                       previewStartSeconds:
 *                         type: integer
 *                         description: Offset the preview clip starts at
 *                       previewDurationSeconds:
 *                         type: integer
 *                         description: Length of the preview clip in seconds
 *                       thumbnailUrl:
 *                         type: string
 *                       youtubeVideoId:
 *                         type: string
 *                         description: Present only when isUnlocked is true
 *                       watchUrl:
 *                         type: string
 *                         description: Full-length embed URL. Present only when isUnlocked is true
 *                       requiresSubscription:
 *                         type: boolean
 *                       viewCount:
 *                         type: integer
 *                         description: >
 *                           YouTube's public view count, last refreshed by the
 *                           channel sync. 0 means either genuinely unwatched or
 *                           never synced — present on locked cards too, since it
 *                           reveals nothing about the video's contents
 *                       likeCount:
 *                         type: integer
 *                         description: YouTube's public like count. Same caveats as viewCount
 *                       channel:
 *                         type: object
 *                         description: Where to send the user to subscribe. Identical on every card; all fields null when no channel is configured
 *                         properties:
 *                           channelId:
 *                             type: string
 *                             nullable: true
 *                           handle:
 *                             type: string
 *                             nullable: true
 *                             description: Normalised to include the leading @
 *                           subscribeUrl:
 *                             type: string
 *                             nullable: true
 *                             description: Web URL for the channel page. The user still taps Subscribe there
 *                           appUrl:
 *                             type: string
 *                             nullable: true
 *                             description: vnd.youtube:// deep link. Null when only a handle is configured — fall back to subscribeUrl
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
 *                 meta:
 *                   type: object
 *                   description: Page-level context, not per-item
 *                   properties:
 *                     hasChannelAccess:
 *                       type: boolean
 *                       description: True when a channel subscription unlocks the whole feed
 *                     sort:
 *                       type: string
 *                       enum: [NEWEST, MOST_WATCHED, MOST_LIKED]
 *                       description: The ordering actually applied — reflects the fallback if an unrecognised sort was requested
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
 *     description: Accepts either the internal card id or the YouTube video id.
 *     tags: [Community]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: videoId
 *         required: true
 *         schema:
 *           type: string
 *         description: Internal card id or YouTube video id
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
 *       Accepts either the internal card id or the YouTube video id.
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
 *               durationMs:
 *                 type: integer
 *                 minimum: 0
 *                 description: Optional client-reported watch time (ms) for the event, e.g. how far the user got into the teaser before leaving.
 *     responses:
 *       200:
 *         description: Interaction logged
 *       400:
 *         description: Invalid action or durationMs value
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
 *     summary: Unlock a video for the calling user
 *     description: >
 *       Grants full access, but only against a server-confirmed YouTube
 *       subscription verdict — the client saying "I came back from YouTube" is
 *       not evidence. Idempotent: an existing unlock is returned untouched and
 *       never re-checked, so it does not expire with the verdict cache.
 *       Accepts either the internal card id or the YouTube video id.
 *       Returns 403 SUBSCRIPTION_REQUIRED when there is no positive verdict.
 *       When YOUTUBE_OAUTH_CLIENT_ID / YOUTUBE_OAUTH_CLIENT_SECRET are unset the
 *       server cannot verify anything, so the gate fails open and this endpoint
 *       trusts the client.
 *     tags: [Community]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: videoId
 *         required: true
 *         schema:
 *           type: string
 *         description: Internal card id or YouTube video id
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
 *       403:
 *         description: SUBSCRIPTION_REQUIRED — no positive subscription verdict on record
 *       404:
 *         description: Video not found
 *       500:
 *         description: Internal server error
 */
router.post("/videos/:videoId/unlock", protectedRoute, controller.unlockVideo.bind(controller));

// ── YouTube subscription verification (the gate's key issuer) ─────────────────

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
 *       success. Also returns the channel subscribe links, so the app can send
 *       the user to the channel and start verification in one round-trip.
 *       Requires YOUTUBE_OAUTH_CLIENT_ID / YOUTUBE_OAUTH_CLIENT_SECRET.
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
 *                     channel:
 *                       type: object
 *                       description: Same shape as the feed card's `channel` object
 *                       properties:
 *                         channelId:
 *                           type: string
 *                           nullable: true
 *                         handle:
 *                           type: string
 *                           nullable: true
 *                         subscribeUrl:
 *                           type: string
 *                           nullable: true
 *                         appUrl:
 *                           type: string
 *                           nullable: true
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
 *
 *       YouTube publishes no event when a user unsubscribes, so this endpoint
 *       re-checks the channel grant live if it is older than
 *       YOUTUBE_READ_REVERIFY_FLOOR_MS (default 5 min) and returns the corrected
 *       state in this same response — a user who cancelled is locked here rather
 *       than after the nightly sweep. A grant inside the window costs no YouTube
 *       quota. The same gate backs the feed, the single-card read, `my-unlocks`
 *       and `unlock`.
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
 *     description: >
 *       Returns interaction counts by type and a conversion rate (unlocks /
 *       subscribe_intents), alongside the YouTube view/like counters the feed's
 *       engagement sorts are built on. The two are reported separately on
 *       purpose: `interactions` only covers activity inside this app, while
 *       `youtube` covers the whole channel, and the gap between them shows
 *       whether the feed is surfacing videos the audience already cares about.
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
 *                     youtube:
 *                       type: object
 *                       description: Channel-wide counters from YouTube, as opposed to the in-app `interactions` above
 *                       properties:
 *                         viewCount:
 *                           type: integer
 *                         likeCount:
 *                           type: integer
 *                         statsSyncedAt:
 *                           type: string
 *                           format: date-time
 *                           nullable: true
 *                           description: When the counters were last refreshed. Null when the card predates them or the last sync could not read them
 *                     conversionRate:
 *                       type: number
 *                       format: float
 *                       description: totalUnlocks / SUBSCRIBE_INTENT events
 *                     totalWatchTimeMs:
 *                       type: integer
 *                       nullable: true
 *                       description: Sum of client-reported durationMs across interactions (null when none reported)
 *                     avgWatchTimeMs:
 *                       type: integer
 *                       nullable: true
 *                       description: Average client-reported durationMs per interaction (null when none reported)
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
 *                 description: Clipped preview embed URL. Do not pass the full-length video URL here — it would defeat the gate
 *               thumbnailUrl:
 *                 type: string
 *               youtubeVideoId:
 *                 type: string
 *               previewStartSeconds:
 *                 type: integer
 *                 default: 0
 *                 description: Offset the preview clip starts at
 *               previewDurationSeconds:
 *                 type: integer
 *                 default: 45
 *                 description: Length of the preview clip in seconds
 *               isPublished:
 *                 type: boolean
 *                 default: true
 *               viewCount:
 *                 type: integer
 *                 minimum: 0
 *                 default: 0
 *                 description: Seed the YouTube view count for a hand-made card so it is not buried under `sort=most_watched`. Overwritten by the next channel sync
 *               likeCount:
 *                 type: integer
 *                 minimum: 0
 *                 default: 0
 *                 description: Seed the YouTube like count. Overwritten by the next channel sync
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
 *                 description: Clipped preview embed URL. Do not set this to the full-length video URL — it would defeat the gate
 *               thumbnailUrl:
 *                 type: string
 *               previewStartSeconds:
 *                 type: integer
 *                 description: Offset the preview clip starts at
 *               previewDurationSeconds:
 *                 type: integer
 *                 description: Length of the preview clip in seconds
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
 *       Cards that already exist keep their admin-edited content (title,
 *       description, teaser bounds) and their soft-delete — only the YouTube
 *       view/like counters are refreshed, since those back the feed's
 *       `sort=most_watched` / `most_liked` orderings and would otherwise freeze
 *       at whatever they were the day the card was first synced.
 *
 *       Teasers are derived from the video's own embed URL — the app plays the
 *       first 45 seconds as the preview clip and then surfaces the "Watch on
 *       YouTube" / subscribe call-to-action.
 *
 *       A single sync is rate-limited per channel by a Redis-backed cooldown
 *       (YOUTUBE_SYNC_COOLDOWN_MS, default 1 hour) to protect API quota. The
 *       cooldown is consulted after the channel is resolved and before the
 *       uploads are fetched, so a sync inside the window costs no quota at all —
 *       at most the 1-point handle→id resolution on a handle-only configuration.
 *       The counters cost one extra YouTube request per run (the whole batch rides
 *       in a single `videos` call), and a failure there is non-fatal: the
 *       uploads are still synced, just with their previous counts.
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
 *                     updated:
 *                       type: integer
 *                       description: Existing cards whose view/like counters were refreshed
 *                     alreadyPresent:
 *                       type: integer
 *                       deprecated: true
 *                       description: Alias of `updated`, kept so older clients keep parsing
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

/**
 * @swagger
 * /community/admin/youtube-grants:
 *   get:
 *     summary: List YouTube channel grants (admin)
 *     description: >
 *       The grant table is otherwise unreachable from outside the process: the
 *       only reads on it are the per-user lookups behind the feed gate, and the
 *       only writer besides the OAuth callback is the nightly re-verification
 *       sweep. Use this to answer "does this account still have feed access, and
 *       can we still prove it?" without going to the database.
 *
 *       Refresh tokens are never returned. Each row reports only `hasRefreshToken`
 *       and `tokenEncrypted`, so the console can show how many grants are still
 *       stored in the clear or hold a credential the current key cannot read.
 *     tags: [Community]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, revoked, all]
 *           default: active
 *         description: Which grants to list
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 25
 *           maximum: 100
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Case-insensitive match on the user's email or name
 *     responses:
 *       200:
 *         description: Grants, plus a table-wide summary in `meta.summary`
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (non-admin)
 *       500:
 *         description: Internal server error
 */
router.get(
  "/admin/youtube-grants",
  protectedRoute,
  requireAdmin,
  controller.adminListChannelGrants.bind(controller),
);

/**
 * @swagger
 * /community/admin/youtube-grants/{userId}/revoke:
 *   post:
 *     summary: Revoke a user's YouTube channel grant (admin)
 *     description: >
 *       Closes the grant without consulting YouTube — the escape hatch for a
 *       support request, a refund, or an account that must not keep feed access
 *       while its subscription check is stuck. Also removes that user's per-video
 *       unlock rows, so the individual videos they had opened stop playing.
 *
 *       Recorded with reason `MANUAL`, which is what distinguishes it from the
 *       sweep's `UNSUBSCRIBED`. Recoverable: if the user re-runs the OAuth flow,
 *       the same row is revived in place.
 *     tags: [Community]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Grant revoked
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (non-admin)
 *       404:
 *         description: The user has no active channel grant
 *       500:
 *         description: Internal server error
 */
router.post(
  "/admin/youtube-grants/:userId/revoke",
  protectedRoute,
  requireAdmin,
  controller.adminRevokeChannelGrant.bind(controller),
);

/**
 * @swagger
 * /community/admin/youtube-grants/re-encrypt:
 *   post:
 *     summary: Re-seal any refresh token still stored in the clear (admin)
 *     description: >
 *       One-shot backfill for grants whose refresh token predates encryption.
 *       New grants are sealed on write and the sweep re-seals a row the first
 *       time it successfully re-checks it, so this is normally a no-op. It exists
 *       so the backfill does not require shell access to the database.
 *
 *       Idempotent — safe to run repeatedly.
 *     tags: [Community]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Backfill result
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (non-admin)
 *       500:
 *         description: Internal server error
 */
router.post(
  "/admin/youtube-grants/re-encrypt",
  protectedRoute,
  requireAdmin,
  controller.adminReencryptGrantTokens.bind(controller),
);

export { router };
