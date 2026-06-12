import { Router } from "express";
import { getTourSites, postTourRequest, getItinerary } from "../Modules/itinerary/itinerary.controller.js";
import protectedRoute from "../middleware/protected.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Itinerary
 *   description: Itinerary generation and retrieval
 */

/**
 * @swagger
 * /itinerary/sites:
 *   get:
 *     summary: List all available tour sites
 *     tags: [Itinerary]
 *     responses:
 *       200:
 *         description: Tour sites retrieved successfully
 */
router.get("/sites", getTourSites);

/**
 * @swagger
 * /itinerary/request:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     summary: Submit a tour request and generate an itinerary
 *     tags: [Itinerary]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tourSiteIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *               tourType:
 *                 type: string
 *                 enum: [GROUP, SINGLE]
 *               durationDays:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 30
 *               primaryPlaceOfStay:
 *                 type: string
 *                 nullable: true
 *               proofOfAccommodationUrl:
 *                 type: string
 *                 format: uri
 *                 nullable: true
 *               relocationInterest:
 *                 type: boolean
 *             required: [tourSiteIds, tourType, durationDays]
 *     responses:
 *       201:
 *         description: Itinerary generation request processed
 */
router.post("/request", protectedRoute,postTourRequest);

/**
 * @swagger
 * /itinerary/{tourRequestId}:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     summary: Retrieve a generated itinerary by tour request ID
 *     tags: [Itinerary]
 *     parameters:
 *       - in: path
 *         name: tourRequestId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Itinerary retrieved successfully
 */
router.get("/:tourRequestId", protectedRoute,getItinerary);

export { router };

