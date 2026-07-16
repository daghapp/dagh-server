import express from "express";
import protectedRoute from "../middleware/protected.js";
import { validate } from "../middleware/validation.js";
import { postBioDocument } from "../modules/profile-management/profile-bio-document.controller.js";
import { postBioDocumentSchema } from "../validator/profile-bio-document-validator.js";

const router = express.Router();

/**
 * @swagger
 * /profile/bio_document_urls:
 *   post:
 *     summary: Post user's bio document URLs and type
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bio_document_urls]
 *             properties:
 *               bio_document_urls:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uri
 *               bio_document_type:
 *                 type: string
 *                 enum: [PASSPORT, GHANA_CARD]
 *                 nullable: true
 *                 description: Type of bio document (optional)
 *     responses:
 *       200:
 *         description: Bio documents updated successfully
 *       400:
 *         description: Invalid payload
 *       401:
 *         description: Unauthorized
 */
router.post("/bio_document_urls", protectedRoute, validate(postBioDocumentSchema), postBioDocument);

export { router };
