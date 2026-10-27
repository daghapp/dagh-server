import { Router } from "express";
import { ProviderNearbyHotelsController } from "../modules/provider-management/provider-nearby-hotels.controller.js";
import { ProviderNearbyRentalsController } from "../modules/provider-management/provider-nearby-rentals.controller.js";
import { ProviderDetailController } from "../modules/provider-management/provider-detail.controller.js";
import protectedRoute from "../middleware/protected.js";

const router = Router();
const controller = new ProviderNearbyHotelsController();
const rentalsController = new ProviderNearbyRentalsController();
const detailController = new ProviderDetailController();

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
 *     summary: Get nearby verified hotels for a tour site (§1 tiered)
 *     description: >
 *       Verified supply within the radius first (category-preferred when
 *       propertyType is given); when fewer than 2 verified matches remain, an
 *       external Google Places fallback is injected tagged
 *       "Suggested Alternative Accommodation".
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
 *         name: propertyType
 *         required: false
 *         schema:
 *           type: string
 *           enum: [HOTEL, GUESTHOUSE, AIRBNB, APARTMENTS, MOTEL]
 *         description: Preferred accommodation category (ordered ahead of others)
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

/**
 * @swagger
 * /providers/nearby-rentals:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     summary: Get nearby verified car rentals for a tour site
 *     tags: [Providers]
 *     parameters:
 *       - in: query
 *         name: tourSiteId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: radiusKm
 *         required: false
 *         schema: { type: number, example: 75 }
 *       - in: query
 *         name: limit
 *         required: false
 *         schema: { type: integer, example: 10 }
 *       - in: query
 *         name: transportType
 *         required: false
 *         schema:
 *           type: string
 *           enum: [TROTRO, UBER, RENTED_VEHICLE, NONE]
 *         description: Prefer exact-type matches; falls back to any type when none exist
 *     responses:
 *       200:
 *         description: Nearby rentals retrieved successfully
 *       400:
 *         description: tourSiteId is required
 *       404:
 *         description: Tour site not found
 *       500:
 *         description: Failed to get nearby rentals
 */
router.get(
  "/nearby-rentals",
  protectedRoute,
  rentalsController.getNearbyRentals.bind(rentalsController),
);

/**
 * @swagger
 * /providers/{id}:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     summary: Get provider details by ID or external Google Places ID
 *     description: >
 *       Returns complete details including images (media assets), short description
 *       (bio or Google Places editorial overview), address, ratings, Google Maps link,
 *       and type-specific attributes (hotel price/type or car rental fleet info).
 *       Supports both internal provider UUIDs and external Google Places IDs (prefixed with 'ext:').
 *     tags: [Providers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Provider UUID or external place ID (e.g. ext:ChIJ...)
 *     responses:
 *       200:
 *         description: Provider details retrieved successfully
 *       400:
 *         description: Provider ID is required
 *       404:
 *         description: Provider not found
 *       500:
 *         description: Failed to get provider details
 */
router.get("/:id", protectedRoute, detailController.getProviderById.bind(detailController));

export { router };

