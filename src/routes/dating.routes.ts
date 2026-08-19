import express from "express";
import rateLimit from "express-rate-limit";
import protectedRoute from "../middleware/protected.js";
import { validate } from "../middleware/validation.js";
import {
  datingProfileSchema,
  discoveryPreferenceSchema,
  swipeSchema,
} from "../validator/datingValidation.js";
import {
  getMyDatingProfile,
  initDatingProfile,
  updateDatingProfile,
  deactivateDatingProfile,
  getDatingProfileById,
  getDatingProfileStatus,
  getDiscoveryPreference,
  updateDiscoveryPreference,
} from "../modules/dating/dating.controller.js";
import {
  recordSwipe,
  getRecommendations,
  getMyMatches,
  getLikesReceived,
  unmatchUser,
  getLikesSent,
  getRelationshipStatus,
} from "../modules/dating/swipe.controller.js";

const router = express.Router();

// Swipe limiter: e.g. max 200 swipes per 15 min per IP (anti-spam).
const swipeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, error: "Too many swipes, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(protectedRoute);

/**
 * @swagger
 * /dating/profile:
 *   get:
 *     summary: Get the authenticated user's dating profile
 *     tags: [Dating]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The user's dating profile with discovery preferences
 *       404:
 *         description: Dating profile not found
 *       500:
 *         description: Internal server error
 */
router.get("/profile", getMyDatingProfile);

/**
 * @swagger
 * /dating/profile/init:
 *   post:
 *     summary: Initialize the authenticated user's dating profile
 *     description: Accepts the full profile-creation payload so every field from the creation form is saved in one call. Idempotent.
 *     tags: [Dating]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               headline:
 *                 type: string
 *               about:
 *                 type: string
 *               photos:
 *                 type: array
 *                 items:
 *                   type: string
 *               heightCm:
 *                 type: integer
 *               interests:
 *                 type: array
 *                 items:
 *                   type: string
 *               lookingFor:
 *                 type: string
 *                 enum: [LONG_TERM_PARTNER, SHORT_TERM, FRIENDSHIP, NOT_SURE]
 *               location:
 *                 type: string
 *               degree:
 *                 type: string
 *               university:
 *                 type: string
 *               profession:
 *                 type: string
 *               industry:
 *                 type: string
 *               workLocation:
 *                 type: string
 *               languages:
 *                 type: array
 *                 items:
 *                   type: string
 *               religion:
 *                 type: string
 *               hometown:
 *                 type: string
 *               fullName:
 *                 type: string
 *               gender:
 *                 type: string
 *                 enum: [MALE, FEMALE, OTHER]
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *               ethnicity:
 *                 type: string
 *                 enum: [African, Asian, Black_African_American, Caribbean, Caucassian_White, Hispanic_Latino, Middle_Eastern, Mixed, Native_American_Indigenous, Pacific_Islander, Other]
 *     responses:
 *       201:
 *         description: Dating profile created
 *       200:
 *         description: Dating profile already exists
 *       500:
 *         description: Internal server error
 */
router.post("/profile/init", validate(datingProfileSchema), initDatingProfile);

/**
 * @swagger
 * /dating/profile:
 *   patch:
 *     summary: Update the authenticated user's dating profile
 *     tags: [Dating]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               headline:
 *                 type: string
 *                 maxLength: 80
 *               about:
 *                 type: string
 *                 maxLength: 2000
 *               photos:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uri
 *                 maxItems: 9
 *               heightCm:
 *                 type: integer
 *                 minimum: 120
 *                 maximum: 250
 *               interests:
 *                 type: array
 *                 items:
 *                   type: string
 *                 maxItems: 20
 *               lookingFor:
 *                 type: string
 *                 enum: [LONG_TERM_PARTNER, SHORT_TERM, FRIENDSHIP, NOT_SURE]
 *               location:
 *                 type: string
 *                 description: Basic Info - current location
 *               degree:
 *                 type: string
 *                 description: Education & Career - degree
 *               university:
 *                 type: string
 *                 description: Education & Career - university
 *               profession:
 *                 type: string
 *                 description: Education & Career - profession
 *               industry:
 *                 type: string
 *                 description: Education & Career - industry
 *               workLocation:
 *                 type: string
 *                 description: Education & Career - work location
 *               languages:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Cultural Background - languages spoken
 *               religion:
 *                 type: string
 *                 description: Cultural Background - religion
 *               hometown:
 *                 type: string
 *                 description: Cultural Background - hometown / ancestral village
 *               fullName:
 *                 type: string
 *                 description: Account - full name (saved on the user's account)
 *               gender:
 *                 type: string
 *                 enum: [MALE, FEMALE, OTHER]
 *                 description: Account - gender (saved on the user's account)
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *                 description: Account - date of birth (saved on the user's account)
 *               ethnicity:
 *                 type: string
 *                 enum: [African, Asian, Black_African_American, Caribbean, Caucassian_White, Hispanic_Latino, Middle_Eastern, Mixed, Native_American_Indigenous, Pacific_Islander, Other]
 *                 description: Account - ethnicity (saved on the user's account)
 *     responses:
 *       200:
 *         description: Dating profile updated
 *       404:
 *         description: Dating profile not found
 *       500:
 *         description: Internal server error
 */
router.patch("/profile", validate(datingProfileSchema), updateDatingProfile);

/**
 * @swagger
 * /dating/profile/deactivate:
 *   delete:
 *     summary: Deactivate the authenticated user's dating profile
 *     description: Removes the dating profile and discovery preferences. The user can re-initialize later.
 *     tags: [Dating]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dating profile deactivated
 *       404:
 *         description: Dating profile not found
 *       500:
 *         description: Internal server error
 */
router.delete("/profile/deactivate", deactivateDatingProfile);

/**
 * @swagger
 * /dating/profile/status:
 *   get:
 *     summary: Get dating profile status (used to skip onboarding for returning users)
 *     tags: [Dating]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile existence and completion status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     hasProfile:
 *                       type: boolean
 *                     profileStatus:
 *                       type: string
 *                       enum: [INCOMPLETE, COMPLETE]
 *                     profile:
 *                       type: object
 *                       nullable: true
 *                       description: The dating profile (with discovery preferences) when present, otherwise null
 *       500:
 *         description: Internal server error
 */
router.get("/profile/status", getDatingProfileStatus);

/**
 * @swagger
 * /dating/profile/{userId}:
 *   get:
 *     summary: Get a public dating profile by user id
 *     tags: [Dating]
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
 *         description: The public dating profile
 *       403:
 *         description: Cannot view this profile (blocked)
 *       404:
 *         description: Profile not found
 *       500:
 *         description: Internal server error
 */
router.get("/profile/:userId", getDatingProfileById);

/**
 * @swagger
 * /dating/preferences:
 *   get:
 *     summary: Get the authenticated user's discovery preferences
 *     tags: [Dating]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Discovery preferences
 *       404:
 *         description: Discovery preferences not set
 *       500:
 *         description: Internal server error
 */
router.get("/preferences", getDiscoveryPreference);

/**
 * @swagger
 * /dating/preferences:
 *   put:
 *     summary: Create or update the authenticated user's discovery preferences
 *     tags: [Dating]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               lookingFor:
 *                 type: string
 *                 enum: [LONG_TERM_PARTNER, SHORT_TERM, FRIENDSHIP, NOT_SURE]
 *               genderPreference:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [MALE, FEMALE, OTHER]
 *               minAge:
 *                 type: integer
 *                 minimum: 18
 *               maxAge:
 *                 type: integer
 *                 maximum: 99
 *               maxDistanceKm:
 *                 type: integer
 *                 minimum: 1
 *               locationLat:
 *                 type: number
 *                 minimum: -90
 *                 maximum: 90
 *               locationLng:
 *                 type: number
 *                 minimum: -180
 *                 maximum: 180
 *               locationName:
 *                 type: string
 *               showProfile:
 *                 type: boolean
 *               showOnlineStatus:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Discovery preferences updated
 *       404:
 *         description: Dating profile not found
 *       500:
 *         description: Internal server error
 */
router.put("/preferences", validate(discoveryPreferenceSchema), updateDiscoveryPreference);

/**
 * @swagger
 * /dating/swipe:
 *   post:
 *     summary: Record a swipe (LIKE, SUPER_LIKE, or PASS). A mutual LIKE creates a match and a conversation.
 *     tags: [Dating]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - targetId
 *               - direction
 *             properties:
 *               targetId:
 *                 type: string
 *                 format: uuid
 *               direction:
 *                 type: string
 *                 enum: [LIKE, SUPER_LIKE, PASS]
 *     responses:
 *       201:
 *         description: Swipe recorded (match included when mutual)
 *       400:
 *         description: Cannot swipe on yourself
 *       403:
 *         description: Cannot swipe on a blocked user
 *       404:
 *         description: Target has no dating profile
 *       409:
 *         description: Already swiped on this user
 *       500:
 *         description: Internal server error
 */
router.post("/swipe", swipeLimiter, validate(swipeSchema), recordSwipe);

/**
 * @swagger
 * /dating/recommendations:
 *   get:
 *     summary: Get ranked discovery candidates for the current user
 *     description: Returns candidates enriched with relationshipStatus and canSendInterest fields.
 *     tags: [Dating]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Ranked list of candidates with relationship state
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
 *                       userId:
 *                         type: string
 *                       fullName:
 *                         type: string
 *                       profile:
 *                         type: object
 *                       relationshipStatus:
 *                         type: string
 *                         enum: [NONE, INTEREST_SENT, INTEREST_RECEIVED, MATCHED, PASSED, BLOCKED]
 *                       canSendInterest:
 *                         type: boolean
 *       500:
 *         description: Internal server error
 */
router.get("/recommendations", getRecommendations);

/**
 * @swagger
 * /dating/matches:
 *   get:
 *     summary: Get all active matches for the current user
 *     tags: [Dating]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of matches with partner profiles
 *       500:
 *         description: Internal server error
 */
router.get("/matches", getMyMatches);

/**
 * @swagger
 * /dating/likes-received:
 *   get:
 *     summary: List users who liked the current user
 *     tags: [Dating]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of users who liked the current user
 *       500:
 *         description: Internal server error
 */
router.get("/likes-received", getLikesReceived);

/**
 * @swagger
 * /dating/likes-sent:
 *   get:
 *     summary: List outgoing interests sent by the current user
 *     description: Returns a cursor-paginated list of outgoing likes/super-likes with target user profiles and current status (PENDING or MATCHED).
 *     tags: [Dating]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 50
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Cursor (ID of the last item) for pagination
 *     responses:
 *       200:
 *         description: Sent interests retrieved successfully
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
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             description: Interest/swipe ID
 *                           targetUserId:
 *                             type: string
 *                           direction:
 *                             type: string
 *                             enum: [LIKE, SUPER_LIKE]
 *                           status:
 *                             type: string
 *                             enum: [PENDING, MATCHED, DECLINED, EXPIRED, CANCELLED]
 *                             description: "PENDING: awaiting response. MATCHED: mutual like. DECLINED/EXPIRED/CANCELLED: if supported."
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *                           targetUser:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: string
 *                               profile:
 *                                 type: object
 *                                 properties:
 *                                   fullName:
 *                                     type: string
 *                                   photos:
 *                                     type: array
 *                                     items:
 *                                       type: string
 *                     nextCursor:
 *                       type: string
 *                       nullable: true
 *       500:
 *         description: Internal server error
 */
router.get("/likes-sent", getLikesSent);

/**
 * @swagger
 * /dating/relationship-status/{userId}:
 *   get:
 *     summary: Get relationship status with a specific user
 *     tags: [Dating]
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
 *         description: Relationship status retrieved successfully
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
 *                     userId:
 *                       type: string
 *                     relationshipStatus:
 *                       type: string
 *                       enum: [NONE, INTEREST_SENT, INTEREST_RECEIVED, MATCHED, PASSED, BLOCKED]
 *                     canSendInterest:
 *                       type: boolean
 *                     interestId:
 *                       type: string
 *                       nullable: true
 *                       description: Swipe ID if interest was sent
 *                     sentAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *       500:
 *         description: Internal server error
 */
router.get("/relationship-status/:userId", getRelationshipStatus);

/**
 * @swagger
 * /dating/matches/{matchId}:
 *   delete:
 *     summary: Unmatch a user (soft-remove the match)
 *     tags: [Dating]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: matchId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Unmatched successfully
 *       404:
 *         description: Match not found
 *       500:
 *         description: Internal server error
 */
router.delete("/matches/:matchId", unmatchUser);

export { router };
