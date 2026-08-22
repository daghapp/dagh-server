import express from "express";
import protectedRoute from "../middleware/protected.js";
import { validate } from "../middleware/validation.js";
import { audioUpload, handleAudioUploadError } from "../middleware/audioUpload.js";
import {
  sendMessageSchema,
  sendVoiceNoteSchema,
  blockUserSchema,
  reportUserSchema,
} from "../validator/messageValidation.js";
import {
  sendMessage,
  sendVoiceNote,
  getNewMatches,
  getConversations,
  getMessages,
  markAsRead,
  blockUser,
  unblockUser,
  reportUser,
} from "../modules/messages/messages.controller.js";

const router = express.Router();

router.use(protectedRoute);

/**
 * @swagger
 * /messages:
 *   post:
 *     summary: Send a text or media message to another user
 *     tags: [Messages]
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
 *               content:
 *                 type: string
 *                 description: Required when type is TEXT
 *                 minLength: 1
 *                 maxLength: 2000
 *               type:
 *                 type: string
 *                 enum: [TEXT, VOICE_NOTE, IMAGE, VIDEO]
 *                 default: TEXT
 *               mediaUrl:
 *                 type: string
 *                 format: uri
 *                 description: Required when type is IMAGE or VIDEO
 *               mediaDuration:
 *                 type: number
 *                 description: Duration in seconds (used for voice notes)
 *     responses:
 *       201:
 *         description: Message sent successfully
 *       400:
 *         description: Validation error (e.g. missing content for TEXT type)
 *       403:
 *         description: Users are blocked from communicating
 *       500:
 *         description: Internal server error
 */
router.post("/", validate(sendMessageSchema), sendMessage);

/**
 * @swagger
 * /messages/voice-note:
 *   post:
 *     summary: Upload and send a voice note audio message
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - receiverId
 *               - audio
 *               - mediaDuration
 *             properties:
 *               receiverId:
 *                 type: string
 *                 format: uuid
 *               mediaDuration:
 *                 type: integer
 *                 description: Duration in seconds
 *               audio:
 *                 type: string
 *                 format: binary
 *                 description: Audio file (MP3, M4A, WAV, AAC, OGG, WEBM). Max 15MB.
 *     responses:
 *       201:
 *         description: Voice note sent successfully
 *       400:
 *         description: Validation error or invalid audio file type
 *       403:
 *         description: Users are blocked from communicating
 *       413:
 *         description: Audio file exceeds 15MB limit
 *       500:
 *         description: Internal server error
 */
router.post(
  "/voice-note",
  audioUpload.single("audio"),
  handleAudioUploadError,
  validate(sendVoiceNoteSchema),
  sendVoiceNote,
);

/**
 * @swagger
 * /messages/matches:
 *   get:
 *     summary: Get active user matches ("New Matches")
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of new matches
 *       500:
 *         description: Internal server error
 */
router.get("/matches", getNewMatches);

/**
 * @swagger
 * /messages/conversations:
 *   get:
 *     summary: Get all conversations for authenticated user with unread counts
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of conversations with unread counts, partner profiles, and online status
 *       500:
 *         description: Internal server error
 */
router.get("/conversations", getConversations);

/**
 * @swagger
 * /messages/conversations/{conversationId}:
 *   get:
 *     summary: Get all messages in a conversation
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: List of messages (also marks unread messages as read)
 *       404:
 *         description: Conversation not found
 *       500:
 *         description: Internal server error
 */
router.get("/conversations/:conversationId", getMessages);

/**
 * @swagger
 * /messages/{messageId}/read:
 *   patch:
 *     summary: Mark a message as read
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Message marked as read
 *       404:
 *         description: Message not found
 *       500:
 *         description: Internal server error
 */
router.patch("/:messageId/read", markAsRead);

/**
 * @swagger
 * /messages/block:
 *   post:
 *     summary: Block a user ("REPORT & BLOCK")
 *     tags: [Messages / Safety]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - blockedId
 *             properties:
 *               blockedId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: User blocked successfully
 *       400:
 *         description: Cannot block yourself
 *       500:
 *         description: Internal server error
 */
router.post("/block", validate(blockUserSchema), blockUser);

/**
 * @swagger
 * /messages/block/{blockedId}:
 *   delete:
 *     summary: Unblock a user
 *     tags: [Messages / Safety]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: blockedId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: User unblocked successfully
 *       500:
 *         description: Internal server error
 */
router.delete("/block/:blockedId", unblockUser);

/**
 * @swagger
 * /messages/report:
 *   post:
 *     summary: Report a user for inappropriate behavior
 *     tags: [Messages / Safety]
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
 *               - reason
 *             properties:
 *               targetId:
 *                 type: string
 *                 format: uuid
 *               reason:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 255
 *               details:
 *                 type: string
 *                 maxLength: 1000
 *     responses:
 *       201:
 *         description: Report submitted successfully
 *       400:
 *         description: Cannot report yourself
 *       500:
 *         description: Internal server error
 */
router.post("/report", validate(reportUserSchema), reportUser);

export { router };
