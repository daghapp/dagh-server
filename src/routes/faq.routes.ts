import express from "express";
import {
  getFaqItems,
  adminGetFaqItems,
  adminCreateFaqItem,
  adminUpdateFaqItem,
  adminDeleteFaqItem,
} from "../modules/faq/faq.controller.js";
import protectedRoute from "../middleware/protected.js";
import { requirePermission, PERMISSIONS } from "../middleware/permissions.js";
import { validate } from "../middleware/validation.js";
import { createFaqItemSchema, updateFaqItemSchema } from "../validator/faq-validator.js";

const router = express.Router();

/**
 * @swagger
 * /faq:
 *   get:
 *     summary: Get all published FAQ items
 *     tags: [FAQ]
 *     responses:
 *       200:
 *         description: List of published FAQ items
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
 *                       question:
 *                         type: string
 *                       answer:
 *                         type: string
 *                       category:
 *                         type: string
 *                         nullable: true
 *                       sortOrder:
 *                         type: integer
 *       500:
 *         description: Internal server error
 */
router.get("/", getFaqItems);

/**
 * @swagger
 * /faq/admin:
 *   get:
 *     summary: Get all FAQ items including unpublished (admin)
 *     tags: [FAQ]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all FAQ items
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (non-admin)
 *       500:
 *         description: Internal server error
 */
router.get(
  "/admin",
  protectedRoute,
  requirePermission(PERMISSIONS.SETTINGS.FULL),
  adminGetFaqItems,
);

/**
 * @swagger
 * /faq/admin:
 *   post:
 *     summary: Create a new FAQ item (admin)
 *     tags: [FAQ]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - question
 *               - answer
 *             properties:
 *               question:
 *                 type: string
 *               answer:
 *                 type: string
 *               category:
 *                 type: string
 *                 nullable: true
 *               sortOrder:
 *                 type: integer
 *                 default: 0
 *               published:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       200:
 *         description: FAQ item created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (non-admin)
 *       500:
 *         description: Internal server error
 */
router.post(
  "/admin",
  protectedRoute,
  requirePermission(PERMISSIONS.SETTINGS.FULL),
  validate(createFaqItemSchema),
  adminCreateFaqItem,
);

/**
 * @swagger
 * /faq/admin/{id}:
 *   put:
 *     summary: Update an FAQ item (admin)
 *     tags: [FAQ]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
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
 *               question:
 *                 type: string
 *               answer:
 *                 type: string
 *               category:
 *                 type: string
 *                 nullable: true
 *               sortOrder:
 *                 type: integer
 *               published:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: FAQ item updated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (non-admin)
 *       404:
 *         description: FAQ item not found
 *       500:
 *         description: Internal server error
 */
router.put(
  "/admin/:id",
  protectedRoute,
  requirePermission(PERMISSIONS.SETTINGS.FULL),
  validate(updateFaqItemSchema),
  adminUpdateFaqItem,
);

/**
 * @swagger
 * /faq/admin/{id}:
 *   delete:
 *     summary: Delete an FAQ item (admin)
 *     tags: [FAQ]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: FAQ item deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (non-admin)
 *       404:
 *         description: FAQ item not found
 *       500:
 *         description: Internal server error
 */
router.delete(
  "/admin/:id",
  protectedRoute,
  requirePermission(PERMISSIONS.SETTINGS.FULL),
  adminDeleteFaqItem,
);

export { router };
