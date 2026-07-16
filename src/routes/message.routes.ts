import express from "express";
import protectedRoute from "../middleware/protected.js";
import { validate } from "../middleware/validation.js";
import { sendMessageSchema } from "../validator/messageValidation.js";
import {
  sendMessage,
  getConversations,
  getMessages,
  markAsRead,
} from "../modules/messages/messages.controller.js";

const router = express.Router();

router.use(protectedRoute);

/**
 * @swagger
 * /api/messages:
 *   post:
 *     summary: Send a message to another user
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
 *               - content
 *             properties:
 *               receiverId:
 *                 type: string
 *                 format: uuid
 *               content:
 *                 type: string
 *                 maxLength: 2000
 *     responses:
 *       201:
 *         description: Message sent successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post("/", validate(sendMessageSchema), sendMessage);

/**
 * @swagger
 * /api/messages/conversations:
 *   get:
 *     summary: Get all conversations for the authenticated user
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of conversations
 *       401:
 *         description: Unauthorized
 */
router.get("/conversations", getConversations);

/**
 * @swagger
 * /api/messages/conversations/{conversationId}:
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
 *         description: List of messages
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Conversation not found
 */
router.get("/conversations/:conversationId", getMessages);

/**
 * @swagger
 * /api/messages/{messageId}/read:
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
 *       401:
 *         description: Unauthorized
 */
router.patch("/:messageId/read", markAsRead);

export { router };
