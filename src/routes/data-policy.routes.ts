import express from "express";
import {
  getDataPolicy,
  adminGetDataPolicy,
  adminUpdateDataPolicy,
} from "../modules/data-policy/data-policy.controller.js";
import protectedRoute from "../middleware/protected.js";
import requireAdmin from "../middleware/admin.js";
import { validate } from "../middleware/validation.js";
import { updateDataPolicySchema } from "../validator/data-policy-validator.js";

const router = express.Router();

/**
 * @swagger
 * /data-policy:
 *   get:
 *     summary: Get the current published data policy
 *     tags: [DataPolicy]
 *     responses:
 *       200:
 *         description: Current data policy
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
 *                     title:
 *                       type: string
 *                     content:
 *                       type: string
 *                     version:
 *                       type: integer
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       404:
 *         description: Data policy not found
 *       500:
 *         description: Internal server error
 */
router.get("/", getDataPolicy);

/**
 * @swagger
 * /data-policy/admin/policy:
 *   get:
 *     summary: Get the full data policy record for editing (admin)
 *     tags: [DataPolicy]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Full data policy record
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (non-admin)
 *       404:
 *         description: Data policy not found
 *       500:
 *         description: Internal server error
 */
router.get("/admin/policy", protectedRoute, requireAdmin, adminGetDataPolicy);

/**
 * @swagger
 * /data-policy/admin/policy:
 *   put:
 *     summary: Update the data policy content (admin)
 *     tags: [DataPolicy]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *               title:
 *                 type: string
 *     responses:
 *       200:
 *         description: Data policy updated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (non-admin)
 *       404:
 *         description: Data policy not found (must be seeded first)
 *       500:
 *         description: Internal server error
 */
router.put(
  "/admin/policy",
  protectedRoute,
  requireAdmin,
  validate(updateDataPolicySchema),
  adminUpdateDataPolicy,
);

export { router };
