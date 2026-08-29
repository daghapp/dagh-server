import express from "express";
import protectedRoute from "../middleware/protected.js";
import { validate } from "../middleware/validation.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { initiateCallSchema } from "../validator/callValidation.js";
import {
  initiateCall,
  getCallHistory,
  getCallState,
  answerCall,
  declineCall,
  cancelCall,
  endCall,
  generateCallToken,
  generateRtcToken,
} from "../modules/messages/calls.controller.js";

const router = express.Router();

router.use(protectedRoute);

// Rate limiters: 5 calls per recipient per 10 min, 20 calls per caller per hour
const callPerRecipientLimiter = createRateLimiter("call-recipient", 10 * 60 * 1000, {
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `call-recipient:${req.user!.id}:${req.body?.receiverId ?? "unknown"}`,
  message: {
    success: false,
    error: { code: "RATE_LIMITED", message: "Too many calls to this user. Try again later." },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const callPerCallerLimiter = createRateLimiter("call-caller", 60 * 60 * 1000, {
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => `call-caller:${req.user!.id}`,
  message: {
    success: false,
    error: { code: "RATE_LIMITED", message: "Call limit reached. Try again later." },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * @swagger
 * /calls:
 *   post:
 *     summary: Initiate a voice or video call
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
 *               - receiverId
 *             properties:
 *               receiverId:
 *                 type: string
 *                 format: uuid
 *               conversationId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               callType:
 *                 type: string
 *                 enum: [VOICE, VIDEO]
 *                 default: VOICE
 *     responses:
 *       201:
 *         description: Call initiated
 *       403:
 *         description: Not matched or blocked
 *       409:
 *         description: Recipient busy or caller already in call
 *       422:
 *         description: Invalid input
 */
router.post(
  "/",
  callPerCallerLimiter,
  callPerRecipientLimiter,
  validate(initiateCallSchema),
  initiateCall,
);

/**
 * @swagger
 * /calls/history:
 *   get:
 *     summary: Get call history
 *     tags: [Calls]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Call ID to paginate after
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 50
 *     responses:
 *       200:
 *         description: Call history
 */
router.get("/history", getCallHistory);

/**
 * @swagger
 * /calls/{callId}:
 *   get:
 *     summary: Get current call state
 *     tags: [Calls]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: callId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Call state
 *       404:
 *         description: Call not found
 *       403:
 *         description: Not a participant
 */
router.get("/:callId", getCallState);

/**
 * @swagger
 * /calls/{callId}/answer:
 *   post:
 *     summary: Answer an incoming call
 *     tags: [Calls]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: callId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Call answered with LiveKit token
 *       409:
 *         description: Call already answered or expired
 */
router.post("/:callId/answer", answerCall);

/**
 * @swagger
 * /calls/{callId}/decline:
 *   post:
 *     summary: Decline an incoming call
 *     tags: [Calls]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: callId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Call declined
 *       409:
 *         description: Invalid call state
 */
router.post("/:callId/decline", declineCall);

/**
 * @swagger
 * /calls/{callId}/cancel:
 *   post:
 *     summary: Cancel an outgoing call
 *     tags: [Calls]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: callId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Call cancelled
 *       409:
 *         description: Invalid call state
 */
router.post("/:callId/cancel", cancelCall);

/**
 * @swagger
 * /calls/{callId}/end:
 *   post:
 *     summary: End an active call
 *     tags: [Calls]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: callId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Call ended
 *       409:
 *         description: Invalid call state
 */
router.post("/:callId/end", endCall);

/**
 * @swagger
 * /calls/{callId}/token:
 *   post:
 *     summary: Generate a LiveKit token scoped to a specific call
 *     tags: [Calls]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: callId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: LiveKit token
 *       409:
 *         description: Call expired or ended
 */
router.post("/:callId/token", generateCallToken);

/**
 * @swagger
 * /calls/token:
 *   post:
 *     summary: "[DEPRECATED] Generate a LiveKit token — use /calls/:callId/token instead"
 *     tags: [Calls]
 *     deprecated: true
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
 *     responses:
 *       200:
 *         description: RTC token
 */
router.post("/token", generateRtcToken);

export { router };
