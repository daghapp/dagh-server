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
 *     summary: Generate RTC room connection token for WebRTC call
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
 *       400:
 *         description: Room ID is required
 *       500:
 *         description: Internal server error
 */
router.post("/token", generateRtcToken);

export { router };
