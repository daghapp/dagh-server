import { Router } from "express";
import { ProviderNearbyHotelsController } from "../modules/provider-management/provider-nearby-hotels.controller.js";
import protectedRoute from "../middleware/protected.js";

const router = Router();
const controller = new ProviderNearbyHotelsController();

/**
 * @swagger
 * tags:
 *   name: Providers
 *   description: Service providers (hotels, tour guides, car rentals)
 */

/**
 * @swagger
 * /providers/nearby-hotels:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     summary: Get nearby verified hotels for a tour site
 *     tags: [Providers]
 *     parameters:
 *       - in: query
 *         name: tourSiteId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: radiusKm
 *         required: false
 *         schema: { type: number, example: 30 }
 *       - in: query
 *         name: limit
 *         required: false
 *         schema: { type: integer, example: 10 }
 *     responses:
 *       200:
 *         description: Nearby hotels retrieved successfully
 *       400:
 *         description: tourSiteId is required
 *       404:
 *         description: Tour site not found
 *       500:
 *         description: Failed to get nearby hotels
 */
router.get("/nearby-hotels", protectedRoute, controller.getNearbyHotels.bind(controller));

export { router };

