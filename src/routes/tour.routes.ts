import express from "express";
import { UserTourController } from "../Modules/tour-management/user-tour.controller.js";
import { AdminTourController } from "../Modules/tour-management/admin-tour.controller.js";
import { validate } from "../middleware/validation.js";
import protectedRoute from "../middleware/protected.js";
import requireAdmin from "../middleware/admin.js";
import {
  tourSchema,
  updateTourSchema,
  tourBookingSchema,
  itineraryActivitySchema,
  tourItinerarySchema,
} from "../validator/index.js";

const router = express.Router();
const userTourController = new UserTourController();
const adminTourController = new AdminTourController();

/**
 * @swagger
 * /tours/bookings:
 *   post:
 *     summary: Book a tour
 *     description: Create a new tour booking for the authenticated user
 *     tags: [Tours - User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tourId
 *               - numberOfPeople
 *               - bookingDate
 *               - tourStartDate
 *             properties:
 *               tourId:
 *                 type: string
 *                 format: uuid
 *                 description: ID of the tour to book
 *                 example: 123e4567-e89b-12d3-a456-426614174000
 *               numberOfPeople:
 *                 type: integer
 *                 minimum: 1
 *                 description: Number of people for the booking
 *                 example: 2
 *               bookingDate:
 *                 type: string
 *                 format: date-time
 *                 description: Date when the booking is made
 *                 example: 2026-02-26T10:00:00Z
 *               tourStartDate:
 *                 type: string
 *                 format: date-time
 *                 description: Date when the tour starts
 *                 example: 2026-03-15T09:00:00Z
 *               specialRequests:
 *                 type: string
 *                 description: Any special requests or requirements
 *                 example: Vegetarian meals required
 *               paymentMethodId:
 *                 type: string
 *                 format: uuid
 *                 description: Optional payment method ID
 *                 example: 789e4567-e89b-12d3-a456-426614174000
 *     responses:
 *       201:
 *         description: Tour booked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Tour booked successfully
 *                 booking:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     tourId:
 *                       type: string
 *                       format: uuid
 *                     userId:
 *                       type: string
 *                       format: uuid
 *                     numberOfPeople:
 *                       type: integer
 *                     totalPrice:
 *                       type: number
 *                     currency:
 *                       type: string
 *                     bookingReference:
 *                       type: string
 *                     status:
 *                       type: string
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized - User not authenticated
 *       404:
 *         description: Tour not found or price not available
 *       500:
 *         description: Failed to book tour
 */
router.post(
  "/bookings",
  protectedRoute,
  validate(tourBookingSchema),
  userTourController.bookTour.bind(userTourController)
);

/**
 * @swagger
 * /tours/bookings/{bookingId}:
 *   delete:
 *     summary: Cancel a tour booking
 *     description: Cancel an existing tour booking by the authenticated user
 *     tags: [Tours - User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the booking to cancel
 *         example: 123e4567-e89b-12d3-a456-426614174000
 *     responses:
 *       200:
 *         description: Booking cancelled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Booking cancelled successfully
 *                 booking:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     status:
 *                       type: string
 *                       example: CANCELLED
 *       400:
 *         description: Booking is already cancelled
 *       401:
 *         description: Unauthorized - User not authenticated
 *       403:
 *         description: Forbidden - User doesn't have permission to cancel this booking
 *       404:
 *         description: Booking not found
 *       500:
 *         description: Failed to cancel tour booking
 */
router.delete(
  "/bookings/:bookingId",
  protectedRoute,
  userTourController.cancelBooking.bind(userTourController)
);

/**
 * @swagger
 * /tours:
 *   post:
 *     summary: Create a new tour
 *     description: Create a new tour package (Admin only)
 *     tags: [Tours - Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *             properties:
 *               title:
 *                 type: string
 *                 maxLength: 255
 *                 description: Title of the tour
 *                 example: Heritage Tour of Ghana
 *               slug:
 *                 type: string
 *                 maxLength: 255
 *                 description: URL-friendly slug
 *                 example: heritage-tour-ghana
 *               description:
 *                 type: string
 *                 description: Detailed description of the tour
 *                 example: Experience the rich cultural heritage of Ghana
 *               shortDescription:
 *                 type: string
 *                 description: Brief description for listings
 *                 example: 7-day cultural heritage tour
 *               category:
 *                 type: string
 *                 maxLength: 100
 *                 description: Tour category
 *                 example: Cultural
 *               durationDays:
 *                 type: integer
 *                 minimum: 1
 *                 description: Duration in days
 *                 example: 7
 *               durationNights:
 *                 type: integer
 *                 minimum: 0
 *                 description: Duration in nights
 *                 example: 6
 *               basePrice:
 *                 type: number
 *                 minimum: 0.01
 *                 description: Base price per person
 *                 example: 1200.00
 *               currency:
 *                 type: string
 *                 maxLength: 10
 *                 default: GHS
 *                 description: Currency code
 *                 example: GHS
 *               status:
 *                 type: string
 *                 enum: [draft, published, archived, pending_review]
 *                 default: draft
 *                 description: Tour status
 *               featured:
 *                 type: boolean
 *                 default: false
 *                 description: Whether the tour is featured
 *               trending:
 *                 type: boolean
 *                 default: false
 *                 description: Whether the tour is trending
 *               coverImage:
 *                 type: string
 *                 format: uri
 *                 description: URL of the cover image
 *               heritageDnaTesting:
 *                 type: boolean
 *                 default: false
 *                 description: Whether heritage DNA testing is included
 *     responses:
 *       201:
 *         description: Tour created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Tour created successfully
 *                 tour:
 *                   type: object
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized - User not authenticated
 *       403:
 *         description: Forbidden - Admin access required
 *       500:
 *         description: Failed to create tour
 */
router.post(
  "/",
  protectedRoute,
  requireAdmin,
  validate(tourSchema),
  adminTourController.createTour.bind(adminTourController)
);

/**
 * @swagger
 * /tours/{id}:
 *   put:
 *     summary: Update an existing tour
 *     description: Update tour details (Admin only)
 *     tags: [Tours - Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the tour to update
 *         example: 123e4567-e89b-12d3-a456-426614174000
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 maxLength: 255
 *               description:
 *                 type: string
 *               shortDescription:
 *                 type: string
 *               category:
 *                 type: string
 *                 maxLength: 100
 *               durationDays:
 *                 type: integer
 *                 minimum: 1
 *               durationNights:
 *                 type: integer
 *                 minimum: 0
 *               basePrice:
 *                 type: number
 *                 minimum: 0.01
 *               currency:
 *                 type: string
 *                 maxLength: 10
 *               status:
 *                 type: string
 *                 enum: [draft, published, archived, pending_review]
 *               featured:
 *                 type: boolean
 *               trending:
 *                 type: boolean
 *               coverImage:
 *                 type: string
 *                 format: uri
 *     responses:
 *       200:
 *         description: Tour updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Tour updated successfully
 *                 tour:
 *                   type: object
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized - User not authenticated
 *       403:
 *         description: Forbidden - Admin access required
 *       404:
 *         description: Tour not found
 *       500:
 *         description: Failed to update tour
 */
router.put(
  "/:id",
  protectedRoute,
  requireAdmin,
  validate(updateTourSchema),
  adminTourController.updateTour.bind(adminTourController)
);

/**
 * @swagger
 * /tours/{id}:
 *   delete:
 *     summary: Delete a tour
 *     description: Permanently delete a tour package (Admin only)
 *     tags: [Tours - Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the tour to delete
 *         example: 123e4567-e89b-12d3-a456-426614174000
 *     responses:
 *       200:
 *         description: Tour deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Tour deleted successfully
 *       401:
 *         description: Unauthorized - User not authenticated
 *       403:
 *         description: Forbidden - Admin access required
 *       404:
 *         description: Tour not found
 *       500:
 *         description: Failed to delete tour
 */
router.delete(
  "/:id",
  protectedRoute,
  requireAdmin,
  adminTourController.deleteTour.bind(adminTourController)
);

/**
 * @swagger
 * /tours/{id}/itinerary:
 *   post:
 *     summary: Add itinerary to a tour
 *     description: Add a new itinerary item to a tour package (Admin only)
 *     tags: [Tours - Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the tour
 *         example: 123e4567-e89b-12d3-a456-426614174000
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               activityTime:
 *                 type: string
 *                 description: Time of the activity
 *                 example: 09:00 AM
 *               activity:
 *                 type: string
 *                 maxLength: 255
 *                 description: Activity description
 *                 example: Visit to Elmina Castle
 *               durationMinutes:
 *                 type: integer
 *                 minimum: 1
 *                 description: Duration in minutes
 *                 example: 120
 *               included:
 *                 type: boolean
 *                 description: Whether the activity is included in the price
 *                 example: true
 *               cost:
 *                 type: number
 *                 minimum: 0
 *                 description: Additional cost if not included
 *                 example: 50.00
 *               locationName:
 *                 type: string
 *                 maxLength: 255
 *                 description: Name of the location
 *                 example: Elmina Castle
 *               locationAddress:
 *                 type: string
 *                 description: Address of the location
 *                 example: Elmina, Central Region, Ghana
 *     responses:
 *       201:
 *         description: Tour itinerary added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Tour itinerary added successfully
 *                 itinerary:
 *                   type: object
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized - User not authenticated
 *       403:
 *         description: Forbidden - Admin access required
 *       404:
 *         description: Tour not found
 *       500:
 *         description: Failed to add tour itinerary
 */
router.post(
  "/:id/itinerary",
  protectedRoute,
  requireAdmin,
  validate(itineraryActivitySchema),
  adminTourController.addTourItinerary.bind(adminTourController)
);

/**
 * @swagger
 * /tours/itinerary/{id}:
 *   put:
 *     summary: Update tour itinerary
 *     description: Update an existing tour itinerary item (Admin only)
 *     tags: [Tours - Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the itinerary to update
 *         example: 123e4567-e89b-12d3-a456-426614174000
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dayNumber:
 *                 type: integer
 *                 minimum: 1
 *                 description: Day number in the tour
 *                 example: 1
 *               title:
 *                 type: string
 *                 maxLength: 255
 *                 description: Title for the day
 *                 example: Day 1 - Arrival and Welcome
 *               description:
 *                 type: string
 *                 description: Description of the day's activities
 *                 example: Arrive at Kotoka International Airport and transfer to hotel
 *               breakfast:
 *                 type: boolean
 *                 description: Whether breakfast is included
 *                 example: true
 *               lunch:
 *                 type: boolean
 *                 description: Whether lunch is included
 *                 example: true
 *               dinner:
 *                 type: boolean
 *                 description: Whether dinner is included
 *                 example: true
 *               accommodationName:
 *                 type: string
 *                 maxLength: 255
 *                 description: Name of accommodation
 *                 example: Movenpick Ambassador Hotel
 *               accommodationType:
 *                 type: string
 *                 maxLength: 100
 *                 description: Type of accommodation
 *                 example: 4-star hotel
 *               accommodationRating:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 5
 *                 description: Accommodation rating
 *                 example: 4.5
 *     responses:
 *       200:
 *         description: Tour itinerary updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Tour itinerary updated successfully
 *                 itinerary:
 *                   type: object
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized - User not authenticated
 *       403:
 *         description: Forbidden - Admin access required
 *       404:
 *         description: Itinerary not found
 *       500:
 *         description: Failed to update tour itinerary
 */
router.put(
  "/itinerary/:id",
  protectedRoute,
  requireAdmin,
  validate(tourItinerarySchema),
  adminTourController.updateTourItinerary.bind(adminTourController)
);

/**
 * @swagger
 * /tours/itinerary/{id}:
 *   delete:
 *     summary: Delete tour itinerary
 *     description: Delete a tour itinerary item (Admin only)
 *     tags: [Tours - Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the itinerary to delete
 *         example: 123e4567-e89b-12d3-a456-426614174000
 *     responses:
 *       200:
 *         description: Tour itinerary deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Tour itinerary deleted successfully
 *       401:
 *         description: Unauthorized - User not authenticated
 *       403:
 *         description: Forbidden - Admin access required
 *       404:
 *         description: Itinerary not found
 *       500:
 *         description: Failed to delete tour itinerary
 */
router.delete(
  "/itinerary/:id",
  protectedRoute,
  requireAdmin,
  adminTourController.deleteTourItinerary.bind(adminTourController)
);

export {router};