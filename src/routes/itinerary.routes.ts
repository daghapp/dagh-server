import { Router } from "express";
import {
  getTourSites,
  postTourRequest,
  getItinerary,
  getUserTourRequests,
  selectDatingProfiles,
  getItineraryDatingSelections,
} from "../modules/itinerary/itinerary.controller.js";
import { ItineraryPaymentController } from "../modules/itinerary/itinerary.payment.controller.js";
import protectedRoute from "../middleware/protected.js";
import verifyHubtelCallback from "../middleware/hubtel-callback.js";
import { getUserItineraries } from "../modules/itinerary/user-itineraries.controller.js";

const router = Router();
const itineraryPaymentController = new ItineraryPaymentController();

/**
 * @swagger
 * tags:
 *   name: Itinerary
 *   description: Itinerary generation, payment initiation, and retrieval
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
 *     summary: Create a tour request (itinerary is generated lazily after payment)
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
 *               startRegion:
 *                 type: string
 *                 description: Hub the loop is anchored to (defaults to Central / Cape Coast)
 *                 default: Central
 *               allowAccraOvernight:
 *                 type: boolean
 *                 description: Opt in to more than two Greater Accra nights
 *                 default: false
 *               relocationInterest:
 *                 type: boolean
 *               apartmentType:
 *                 type: string
 *                 enum: [HOTEL, GUESTHOUSE, AIRBNB, APARTMENTS]
 *                 nullable: true
 *               transportType:
 *                 type: string
 *                 enum: [TROTRO, UBER, RENTED_VEHICLE, NONE]
 *                 nullable: true
 *               companionInterest:
 *                 type: boolean

 *             required: [tourSiteIds, tourType, durationDays]
 *     responses:
 *       201:
 *         description: Tour request created successfully (payment required to view itinerary)
 *       400:
 *         description: Validation failed
 *       422:
 *         description: Request was created but is not feasible (cannot generate itinerary)
 */
router.post("/request", protectedRoute, postTourRequest);

/**
 * @swagger
 * /itinerary/my-itineraries:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     summary: Get all created itineraries for the authenticated user
 *     tags: [Itinerary]
 *     responses:
 *       200:
 *         description: Itineraries retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/my-itineraries", protectedRoute, getUserItineraries);

/**
 * @swagger
 * /itinerary/{tourRequestId}/payment:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     summary: Initiate Hubtel payment for an existing tour request
 *     tags: [Itinerary]
 *     parameters:
 *       - in: path
 *         name: tourRequestId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Payment initiated successfully
 *       400:
 *         description: Failed to initiate payment
 *       403:
 *         description: Forbidden (tour request does not belong to the authenticated user)
 *       404:
 *         description: Tour request not found
 */
router.post(
  "/:tourRequestId/payment",
  protectedRoute,
  itineraryPaymentController.initiateItineraryPayment.bind(itineraryPaymentController),
);

/**
 * @swagger
 * /itinerary/payment-callback:
 *   post:
 *     summary: Hubtel payment callback for itinerary payments
 *     tags: [Itinerary]
 *     description: Updates tourRequest.paymentStatus based on Hubtel callback payload
 *     responses:
 *       200:
 *         description: Callback processed successfully
 *       400:
 *         description: Invalid callback payload
 *       404:
 *         description: Payment or tour request not found
 *       500:
 *         description: Failed to handle callback
 */
router.post(
  "/payment-callback",
  verifyHubtelCallback,
  itineraryPaymentController.handleHubtelPaymentCallback.bind(itineraryPaymentController),
);

/**
 * @swagger
 * /itinerary/requests:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     summary: Get all itinerary requests for the authenticated user
 *     tags: [Itinerary]
 *     responses:
 *       200:
 *         description: Tour requests retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/requests", protectedRoute, getUserTourRequests);

/**
 * @swagger
 * /itinerary/{tourRequestId}/dating-selections:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     summary: List dating profiles merged into a tour's itinerary
 *     tags: [Itinerary]
 *     parameters:
 *       - in: path
 *         name: tourRequestId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Dating selections retrieved successfully
 *       403:
 *         description: Not allowed
 *       404:
 *         description: Tour request not found
 */
router.get("/:tourRequestId/dating-selections", protectedRoute, getItineraryDatingSelections);

/**
 * @swagger
 * /itinerary/{tourRequestId}/dating-selections:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     summary: Select dating profiles to merge into the tour itinerary as social/leisure blocks
 *     tags: [Itinerary]
 *     parameters:
 *       - in: path
 *         name: tourRequestId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userIds]
 *             properties:
 *               userIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *                 description: Candidate user ids selected from /dating/recommendations
 *     responses:
 *       200:
 *         description: Dating selections saved
 *       400:
 *         description: No valid dating profiles selected
 *       403:
 *         description: KYC verification required or not allowed
 *       404:
 *         description: Tour request not found
 */
router.post("/:tourRequestId/dating-selections", protectedRoute, selectDatingProfiles);

/**
 * @swagger
 * /itinerary/{tourRequestId}:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     summary: Retrieve itinerary for a tour request (only after payment SUCCESS)
 *     tags: [Itinerary]
 *     parameters:
 *       - in: path
 *         name: tourRequestId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Itinerary retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     itinerary:
 *                       type: object
 *                       description: Generated itinerary (only after payment success)
 *                     request:
 *                       type: object
 *                       description: Tour request data used to generate the itinerary
 *                 price:
 *                   type: number
 *                   description: Feasible itinerary price (before payment)
 *                 error:
 *                   type: string
 *               required: [success, message, data, price]
 *
 *       403:
 *         description: PAYMENT_REQUIRED (initiate and complete payment first)
 *       404:
 *         description: Tour request not found or itinerary not available
 */
router.get("/:tourRequestId", protectedRoute, getItinerary);
export { router };
