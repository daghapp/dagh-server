import express from "express";
import protectedRoute from "../middleware/protected.js";
import { requirePermission, PERMISSIONS } from "../middleware/permissions.js";
import { validate } from "../middleware/validation.js";
import { createTourSiteSchema } from "../validator/tour-site-validator.js";
import { TourSiteController } from "../modules/tour-sites/tour-site.controller.js";

// ─────────────────────────────────────────
// TOUR SITES — admin catalogue management.
// Mounted at /tour-sites alongside the community photo routes.
// ─────────────────────────────────────────

const router = express.Router();
const controller = new TourSiteController();

/**
 * @swagger
 * tags:
 *   name: Tour Sites
 *   description: Admin management of the tour-site catalogue
 */

/**
 * @swagger
 * /tour-sites/admin:
 *   post:
 *     summary: Add a tour site directly to the catalogue (admin only)
 *     description: Creates a live tour site without going through the pending-site review queue. The free-text category is normalized into the SiteCategory enum, supplementary tags are preserved, and the transit profile is derived from the region. Requires the tours.edit permission.
 *     tags: [Tour Sites]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, region, latitude, longitude, description]
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 100
 *                 example: Wli Waterfalls
 *               region:
 *                 type: string
 *                 enum: [Greater Accra, Central, Western, Western North, Volta, Oti, Eastern, Ashanti, Bono, Bono East, Ahafo, Savannah, Northern, North East, Upper East, Upper West]
 *                 example: Volta
 *               latitude:
 *                 type: number
 *                 minimum: 4.5
 *                 maximum: 11.5
 *                 example: 7.0131
 *               longitude:
 *                 type: number
 *                 minimum: -3.3
 *                 maximum: 1.3
 *                 example: 0.5126
 *               description:
 *                 type: string
 *                 minLength: 10
 *                 maxLength: 2000
 *                 example: The highest waterfall in West Africa, set in the Agumatsa Range.
 *               history:
 *                 type: string
 *                 maxLength: 5000
 *               category:
 *                 type: string
 *                 maxLength: 50
 *                 description: Free-text category, mapped to the SiteCategory enum
 *                 example: Nature / Waterfall
 *               categories:
 *                 type: array
 *                 maxItems: 10
 *                 description: Extra album tags (merged with the tag derived from category)
 *                 items:
 *                   type: string
 *                   maxLength: 50
 *               imageUrl:
 *                 type: string
 *                 format: uri
 *               imageCredit:
 *                 type: string
 *                 maxLength: 200
 *     responses:
 *       201:
 *         description: Tour site created
 *       400:
 *         description: Validation failure (missing/invalid fields)
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: tours.edit permission required
 *       409:
 *         description: A site with this name already exists
 *       500:
 *         description: Failed to create tour site
 */
router.post(
  "/admin",
  protectedRoute,
  requirePermission(PERMISSIONS.TOURS.EDIT),
  validate(createTourSiteSchema),
  controller.createSite.bind(controller),
);

export { router };
