import express from "express";
import protectedRoute from "../middleware/protected.js";
import { getCallHistory, generateRtcToken } from "../modules/messages/calls.controller.js";

const router = express.Router();

router.use(protectedRoute);

/**
 * @swagger
 * /calls/history:
 *   get:
 *     summary: Get user call logs history
 *     tags: [Calls]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Call history retrieved successfully (last 50 calls)
 *       500:
 *         description: Internal server error
 */
router.get("/history", getCallHistory);

/**
 * @swagger
 * /calls/token:
 *   post:
 *     summary: Generate a LiveKit AccessToken for a WebRTC call room
 *     description: >
 *       Returns a room-scoped LiveKit token and the media service URL. When
 *       LiveKit is not configured, falls back to a placeholder HMAC token
 *       (dev only).
 *     tags: [Calls]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - roomId
 *             properties:
 *               roomId:
 *                 type: string
 *               callType:
 *                 type: string
 *                 enum: [VOICE, VIDEO]
 *                 default: VOICE
 *     responses:
 *       200:
 *         description: RTC token generated (valid for 1 hour)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 roomId:
 *                   type: string
 *                 userId:
 *                   type: string
 *                 callType:
 *                   type: string
 *                   enum: [VOICE, VIDEO]
 *                 token:
 *                   type: string
 *                 serviceUrl:
 *                   type: string
 *                   description: LiveKit WSS URL (LIVEKIT_URL), or CALL_SERVICE_URL/API_URL fallback
 *                 expiresIn:
 *                   type: integer
 *                   description: Token lifetime in seconds
 *       400:
 *         description: Room ID is required
 *       500:
 *         description: Internal server error
 */
router.post("/token", generateRtcToken);

export { router };
