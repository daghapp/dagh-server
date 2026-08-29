import express from "express";
import protectedRoute from "../middleware/protected.js";
import { validate } from "../middleware/validation.js";
import { verifyJurisdictionSchema } from "../validator/geoValidation.js";
import { verifyJurisdiction } from "../modules/geo/geo.controller.js";

export const router = express.Router();

/**
 * @swagger
 * /geo/verify-jurisdiction:
 *   post:
 *     summary: Verify the device's IP is within an allowed jurisdiction
 *     description: >
 *       Accepts the device's public IP, resolves it to a country via geoip-country,
 *       and checks it against the Americas & Caribbean allow-list. If the country is
 *       not allowed (or can't be resolved), all of the user's device sessions are
 *       logged out and the request is rejected with 403.
 *     tags: [Geo]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ip]
 *             properties:
 *               ip:
 *                 type: string
 *                 example: "3.1.1.1"
 *     responses:
 *       200:
 *         description: IP is within an allowed jurisdiction
 *       400:
 *         description: Invalid or missing IP address
 *       403:
 *         description: IP is outside the allowed jurisdiction; user has been logged out
 *       500:
 *         description: Internal server error
 */
router.post(
  "/verify-jurisdiction",
  protectedRoute,
  validate(verifyJurisdictionSchema),
  verifyJurisdiction,
);
