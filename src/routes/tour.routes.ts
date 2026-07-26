import express from "express";
import { UserTourController } from "../modules/tour-management/user-tour.controller.js";
import { AdminTourController } from "../modules/tour-management/admin-tour.controller.js";
import { validate } from "../middleware/validation.js";
import protectedRoute from "../middleware/protected.js";
import requireAdmin from "../middleware/admin.js";
import verifyHubtelCallback from "../middleware/hubtel-callback.js";
import {
  tourSchema,
  updateTourSchema,
  tourBookingSchema,
  tourItinerarySchema,
  tourBookingSchema_momo,
} from "../validator/index.js";

const router = express.Router();
const userTourController = new UserTourController();
const adminTourController = new AdminTourController();

/**
 * @swagger
 * /tours:
 *   get:
 *     summary: Get all tours
 *     description: Retrieve a paginated list of tour packages with optional filters
 *     tags: [Tours - User]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *         example: Cultural
 *       - in: query
 *         name: subcategory
 *         schema:
 *           type: string
 *         description: Filter by subcategory
 *         example: Heritage
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, published, archived, pending_review]
 *         description: Filter by status
 *         example: published
 *       - in: query
 *         name: featured
 *         schema:
 *           type: boolean
 *         description: Filter featured tours
 *         example: true
 *       - in: query
 *         name: trending
 *         schema:
 *           type: boolean
 *         description: Filter trending tours
 *         example: true
 *       - in: query
 *         name: durationDays
 *         schema:
 *           type: integer
 *         description: Filter by exact duration in days
 *         example: 7
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: number
 *         description: Minimum base price
 *         example: 100
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *         description: Maximum base price
 *         example: 500
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by title or description
 *         example: safari
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *         example: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 100
 *         description: Results per page
 *         example: 10
 *     responses:
 *       200:
 *         description: Tours retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *       500:
 *         description: Failed to fetch tours
 */
router.get("/", userTourController.getAllTours.bind(userTourController));

/**
 * @swagger
 * /tours/bookings/my:
 *   get:
 *     summary: Get user bookings
 *     description: Retrieve all tour bookings for the authenticated user
 *     tags: [Tours - User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Bookings retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 bookings:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       tourId:
 *                         type: string
 *                         format: uuid
 *                       userId:
 *                         type: string
 *                         format: uuid
 *                       numberOfPeople:
 *                         type: integer
 *                       totalPrice:
 *                         type: number
 *                       currency:
 *                         type: string
 *                       bookingReference:
 *                         type: string
 *                       status:
 *                         type: string
 *                       bookingDate:
 *                         type: string
 *                         format: date-time
 *                       tourStartDate:
 *                         type: string
 *                         format: date-time
 *                       tour:
 *                         type: object
 *       401:
 *         description: Unauthorized - User not authenticated
 *       404:
 *         description: User not found
 *       500:
 *         description: Failed to fetch user bookings
 */
router.get(
  "/bookings/my",
  protectedRoute,
  userTourController.getUserBookings.bind(userTourController),
);

/**
 * @swagger
 * /tour/initiate-booking-momo:
 *   post:
 *     summary: Initiate Tour Booking Payment (MoMo)
 *     description: Initiates a payment for a tour booking using mobile money. Creates a Payment record and awaits Hubtel callback for final confirmation.
 *     tags: [Tours - User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tourId:
 *                 type: string
 *                 format: uuid
 *                 description: Unique identifier of the tour package.
 *                 example: "d290f1ee-6c54-4b01-90e6-d701748f0851"
 *               numberOfPeople:
 *                 type: integer
 *                 minimum: 1
 *                 description: Number of people included in the booking.
 *                 example: 2
 *               bookingDate:
 *                 type: string
 *                 format: date-time
 *                 description: Date when the booking is made.
 *                 example: "2026-05-25T10:00:00Z"
 *               tourStartDate:
 *                 type: string
 *                 format: date-time
 *                 description: Scheduled start date of the tour.
 *                 example: "2026-06-01T08:00:00Z"
 *               specialRequests:
 *                 type: string
 *                 description: Optional special requests by the customer.
 *                 example: "Vegetarian meals"
 *               paymentMethod:
 *                 type: string
 *                 enum: ["MTN_MOMO", "TELECEL_MOMO", "AT_MOMO"]
 *                 description: Mobile money provider selected for payment.
 *                 example: "MTN_MOMO"
 *               phoneNumber:
 *                 type: string
 *                 pattern: "^233\\d{9}$"
 *                 description: Ghana MSISDN phone number of the customer.
 *                 example: "233501234567"
 *     responses:
 *       200:
 *         description: Payment initiation successful
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
 *                   example: "Payment initiated. Awaiting confirmation."
 *                 bookingId:
 *                   type: string
 *                   format: uuid
 *                   description: Unique identifier of the created booking.
 *                 paymentId:
 *                   type: string
 *                   format: uuid
 *                   description: Unique identifier of the created payment.
 *                 hubtelResponse:
 *                   type: object
 *                   description: Raw response from Hubtel DirectReceive API.
 *       400:
 *         description: Invalid request or payment initiation failed
 *       404:
 *         description: Tour not found
 *       500:
 *         description: Internal server error
 */
router.post(
  "/initiate-booking-momo",
  protectedRoute,
  validate(tourBookingSchema_momo),
  userTourController.initiateTourBookingMoMo.bind(userTourController),
);

/**
 * @swagger
 * /tours/hubtel-callback:
 *   post:
 *     summary: Handle Hubtel payment callback for tour bookings
 *     description: Receives payment confirmation callback from Hubtel after a tour booking payment
 *     tags: [Tours - User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Hubtel callback payload containing payment status and transaction details
 *     responses:
 *       200:
 *         description: Callback processed successfully
 *       400:
 *         description: Invalid callback payload
 *       500:
 *         description: Failed to process callback
 */
router.post(
  "/hubtel-callback",
  verifyHubtelCallback,
  userTourController.hubtelCallbackController.bind(userTourController),
);

/**
 * @swagger
 * /tours/bookings:
 *   post:
 *     summary: Book a tour
 *     description: Initiate a tour booking with Hubtel payment checkout
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
 *               numberOfPeople:
 *                 type: number
 *                 minimum: 1
 *                 description: Number of people booking
 *               bookingDate:
 *                 type: string
 *                 format: date
 *                 description: Date of booking (ISO 8601)
 *               tourStartDate:
 *                 type: string
 *                 format: date
 *                 description: Tour start date (ISO 8601)
 *               specialRequests:
 *                 type: string
 *                 description: Any special requests
 *     responses:
 *       201:
 *         description: Tour booked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     paymentData:
 *                       type: object
 *                       description: Hubtel checkout data
 *                     booking:
 *                       type: object
 *                       description: Created booking record
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Tour not found or price not available
 *       500:
 *         description: Failed to book tour
 */
router.post(
  "/bookings",
  protectedRoute,
  validate(tourBookingSchema),
  userTourController.bookTour.bind(userTourController),
);
/**
 * @swagger
 * /tours/user-itineraries/{itineraryId}:
 *   patch:
 *     summary: Update user itinerary for a tour
 *     description: Update the user's personalized itinerary for a booked tour
 *     tags: [Tours - User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: itineraryId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the user itinerary to update
 *         example: 123e4567-e89b-12d3-a456-426614174000
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *                 description: Additional notes or preferences for the itinerary
 *                 example: Prefer vegetarian meals
 *     responses:
 *       200:
 *         description: User itinerary updated successfully
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
 *                   example: User itinerary updated successfully
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized - User not authenticated
 *       403:
 *         description: Forbidden - User doesn't own this itinerary
 *       404:
 *         description: Itinerary not found
 *       500:
 *         description: Failed to update user itinerary
 */
router.patch(
  "/user-itineraries/:itineraryId",
  protectedRoute,
  userTourController.updateUserItinerary.bind(userTourController),
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
  userTourController.cancelBooking.bind(userTourController),
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
 *                 description: Title of the tour (required)
 *                 example: Heritage Tour of Ghana
 *               slug:
 *                 type: string
 *                 maxLength: 255
 *                 description: URL-friendly slug (optional)
 *                 example: heritage-tour-ghana
 *               description:
 *                 type: string
 *                 description: Detailed description of the tour (optional)
 *                 example: Experience the rich cultural heritage of Ghana
 *               shortDescription:
 *                 type: string
 *                 description: Brief description for listings (optional)
 *                 example: 7-day cultural heritage tour
 *               category:
 *                 type: string
 *                 maxLength: 100
 *                 description: Tour category (optional)
 *                 example: Cultural
 *               subcategory:
 *                 type: string
 *                 maxLength: 100
 *                 description: Tour subcategory (optional)
 *                 example: Heritage
 *               durationDays:
 *                 type: integer
 *                 minimum: 1
 *                 description: Duration in days (optional)
 *                 example: 7
 *               durationNights:
 *                 type: integer
 *                 minimum: 0
 *                 description: Duration in nights (optional)
 *                 example: 6
 *               basePrice:
 *                 type: number
 *                 minimum: 0.01
 *                 description: Base price per person (optional)
 *                 example: 1200.00
 *               currency:
 *                 type: string
 *                 maxLength: 10
 *                 default: GHS
 *                 description: Currency code (optional, defaults to GHS)
 *                 example: GHS
 *               status:
 *                 type: string
 *                 enum: [draft, published, archived, pending_review]
 *                 default: draft
 *                 description: Tour status (optional, defaults to draft)
 *               featured:
 *                 type: boolean
 *                 default: false
 *                 description: Whether the tour is featured (optional)
 *               trending:
 *                 type: boolean
 *                 default: false
 *                 description: Whether the tour is trending (optional)
 *               cancellationPolicy:
 *                 type: string
 *                 description: Tour cancellation policy details (optional)
 *                 example: Free cancellation up to 48 hours before departure
 *               bookingDeadline:
 *                 type: integer
 *                 minimum: 1
 *                 description: Number of days before tour start that bookings close (optional)
 *                 example: 7
 *               minimumBooking:
 *                 type: integer
 *                 minimum: 1
 *                 description: Minimum number of people required to run the tour (optional)
 *                 example: 4
 *               accessibility:
 *                 type: string
 *                 description: Accessibility information for the tour (optional)
 *                 example: Wheelchair accessible
 *               coverImage:
 *                 type: string
 *                 format: uri
 *                 description: URL of the cover image (optional)
 *               heritageDnaTesting:
 *                 type: boolean
 *                 default: false
 *                 description: Whether heritage DNA testing is included (optional)
 *               itineraries:
 *                 type: array
 *                 description: List of daily itinerary items (optional)
 *                 items:
 *                   type: object
 *                   properties:
 *                     dayNumber:
 *                       type: integer
 *                       minimum: 1
 *                     title:
 *                       type: string
 *                       maxLength: 255
 *                     description:
 *                       type: string
 *                     breakfast:
 *                       type: boolean
 *                     lunch:
 *                       type: boolean
 *                     dinner:
 *                       type: boolean
 *                     accommodationName:
 *                       type: string
 *                     accommodationType:
 *                       type: string
 *                     accommodationRating:
 *                       type: number
 *                       minimum: 0
 *                       maximum: 5
 *                     activities:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           activityTime:
 *                             type: string
 *                           activity:
 *                             type: string
 *                           durationMinutes:
 *                             type: integer
 *                           included:
 *                             type: boolean
 *                           cost:
 *                             type: number
 *                           locationName:
 *                             type: string
 *                           locationAddress:
 *                             type: string
 *               locations:
 *                 type: array
 *                 description: List of tour locations (optional)
 *                 items:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     city:
 *                       type: string
 *                     region:
 *                       type: string
 *                     description:
 *                       type: string
 *                     visitDuration:
 *                       type: integer
 *                     photos:
 *                       type: array
 *                       items:
 *                         type: string
 *                         format: uri
 *               media:
 *                 type: array
 *                 description: Tour media files (optional)
 *                 items:
 *                   type: object
 *                   properties:
 *                     mediaType:
 *                       type: string
 *                       enum: [image, video]
 *                     url:
 *                       type: string
 *                       format: uri
 *               heritageElements:
 *                 type: array
 *                 description: Heritage elements associated with this tour (optional)
 *                 items:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [ancestral, historical, cultural, tribal]
 *                     value:
 *                       type: string
 *               pricingIncludes:
 *                 type: array
 *                 description: Items included in the tour price (optional)
 *                 items:
 *                   type: object
 *                   properties:
 *                     item:
 *                       type: string
 *                       example: Airport transfers
 *               pricingExcludes:
 *                 type: array
 *                 description: Items excluded from the tour price (optional)
 *                 items:
 *                   type: object
 *                   properties:
 *                     item:
 *                       type: string
 *                       example: International flights
 *               groupDiscounts:
 *                 type: array
 *                 description: Group size discounts (optional)
 *                 items:
 *                   type: object
 *                   properties:
 *                     minSize:
 *                       type: integer
 *                       minimum: 1
 *                     discountPercentage:
 *                       type: number
 *                       minimum: 0
 *                       maximum: 100
 *               seasonalPricing:
 *                 type: array
 *                 description: Seasonal price adjustments (optional)
 *                 items:
 *                   type: object
 *                   properties:
 *                     season:
 *                       type: string
 *                     startDate:
 *                       type: string
 *                       format: date-time
 *                     endDate:
 *                       type: string
 *                       format: date-time
 *                     priceModifier:
 *                       type: number
 *               guides:
 *                 type: array
 *                 description: Tour guides assigned to this tour (optional)
 *                 items:
 *                   type: object
 *                   properties:
 *                     guideId:
 *                       type: string
 *                     name:
 *                       type: string
 *                     photo:
 *                       type: string
 *                       format: uri
 *                     bio:
 *                       type: string
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
  adminTourController.createTour.bind(adminTourController),
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
  adminTourController.updateTour.bind(adminTourController),
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
  adminTourController.deleteTour.bind(adminTourController),
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
 *             example:
 *               dayNumber: 1
 *               title: Day 1 - Arrival in Accra
 *               description: Airport pickup, hotel check-in, and evening cultural orientation.
 *               breakfast: false
 *               lunch: true
 *               dinner: true
 *               accommodationName: Movenpick Ambassador Hotel
 *               accommodationType: 4-star hotel
 *               accommodationRating: 4.5
 *               activities:
 *                 - activityTime: "09:00"
 *                   activity: Airport pickup and transfer
 *                   durationMinutes: 60
 *                   included: true
 *                   cost: 0
 *                   locationName: Kotoka International Airport
 *                   locationAddress: Accra, Ghana
 *             properties:
 *               dayNumber:
 *                 type: integer
 *                 minimum: 1
 *                 description: Day number in the tour itinerary
 *                 example: 1
 *               title:
 *                 type: string
 *                 maxLength: 255
 *                 description: Title for the itinerary day
 *                 example: Day 1 - Arrival and Welcome
 *               description:
 *                 type: string
 *                 description: Description of the day's schedule
 *                 example: Arrive at Kotoka International Airport and transfer to hotel.
 *               breakfast:
 *                 type: boolean
 *                 description: Whether breakfast is included
 *                 example: false
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
 *                 description: Name of the accommodation for the day
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
 *               activities:
 *                 type: array
 *                 description: Optional list of activities for the itinerary day
 *                 items:
 *                   type: object
 *                   properties:
 *                     activityTime:
 *                       type: string
 *                       description: Time of the activity
 *                       example: "09:00"
 *                     activity:
 *                       type: string
 *                       maxLength: 255
 *                       description: Activity description
 *                       example: Visit to Elmina Castle
 *                     durationMinutes:
 *                       type: integer
 *                       minimum: 1
 *                       description: Duration in minutes
 *                       example: 120
 *                     included:
 *                       type: boolean
 *                       description: Whether the activity is included in the package price
 *                       example: true
 *                     cost:
 *                       type: number
 *                       minimum: 0
 *                       description: Additional cost if not included in the package
 *                       example: 50
 *                     locationName:
 *                       type: string
 *                       maxLength: 255
 *                       description: Name of the activity location
 *                       example: Elmina Castle
 *                     locationAddress:
 *                       type: string
 *                       description: Address of the activity location
 *                       example: Elmina, Central Region, Ghana
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
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                       example: 123e4567-e89b-12d3-a456-426614174000
 *                     tourId:
 *                       type: string
 *                       format: uuid
 *                       example: 123e4567-e89b-12d3-a456-426614174111
 *                     dayNumber:
 *                       type: integer
 *                       example: 1
 *                     title:
 *                       type: string
 *                       example: Day 1 - Arrival and Welcome
 *                     description:
 *                       type: string
 *                       example: Arrive at Kotoka International Airport and transfer to hotel.
 *                     breakfast:
 *                       type: boolean
 *                       example: false
 *                     lunch:
 *                       type: boolean
 *                       example: true
 *                     dinner:
 *                       type: boolean
 *                       example: true
 *                     accommodationName:
 *                       type: string
 *                       example: Movenpick Ambassador Hotel
 *                     accommodationType:
 *                       type: string
 *                       example: 4-star hotel
 *                     accommodationRating:
 *                       type: string
 *                       description: Decimal fields are serialized as strings in JSON responses.
 *                       example: "4.5"
 *                     itinerary_activities:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             format: uuid
 *                             example: 123e4567-e89b-12d3-a456-426614174222
 *                           itineraryId:
 *                             type: string
 *                             format: uuid
 *                             example: 123e4567-e89b-12d3-a456-426614174000
 *                           activityTime:
 *                             type: string
 *                             example: "09:00"
 *                           activity:
 *                             type: string
 *                             example: Airport pickup and transfer
 *                           durationMinutes:
 *                             type: integer
 *                             example: 60
 *                           included:
 *                             type: boolean
 *                             example: true
 *                           cost:
 *                             type: string
 *                             description: Decimal fields are serialized as strings in JSON responses.
 *                             example: "0"
 *                           locationName:
 *                             type: string
 *                             example: Kotoka International Airport
 *                           locationAddress:
 *                             type: string
 *                             example: Accra, Ghana
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
  validate(tourItinerarySchema),
  adminTourController.addTourItinerary.bind(adminTourController),
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
 *             example:
 *               dayNumber: 2
 *               title: Day 2 - Cape Coast Heritage Tour
 *               description: Travel to Cape Coast and tour historic heritage sites.
 *               breakfast: true
 *               lunch: true
 *               dinner: false
 *               accommodationName: Ridge Royal Hotel
 *               accommodationType: Hotel
 *               accommodationRating: 4
 *               activities:
 *                 - activityTime: "08:00"
 *                   activity: Depart Accra for Cape Coast
 *                   durationMinutes: 180
 *                   included: true
 *                   cost: 0
 *                   locationName: Accra
 *                   locationAddress: Greater Accra Region, Ghana
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
 *               activities:
 *                 type: array
 *                 description: Replace the itinerary activities with this new list. Send an empty array to clear activities.
 *                 items:
 *                   type: object
 *                   properties:
 *                     activityTime:
 *                       type: string
 *                       example: "08:00"
 *                     activity:
 *                       type: string
 *                       maxLength: 255
 *                       example: Depart Accra for Cape Coast
 *                     durationMinutes:
 *                       type: integer
 *                       minimum: 1
 *                       example: 180
 *                     included:
 *                       type: boolean
 *                       example: true
 *                     cost:
 *                       type: number
 *                       minimum: 0
 *                       example: 0
 *                     locationName:
 *                       type: string
 *                       maxLength: 255
 *                       example: Accra
 *                     locationAddress:
 *                       type: string
 *                       example: Greater Accra Region, Ghana
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
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     tourId:
 *                       type: string
 *                       format: uuid
 *                     dayNumber:
 *                       type: integer
 *                     title:
 *                       type: string
 *                     description:
 *                       type: string
 *                     breakfast:
 *                       type: boolean
 *                     lunch:
 *                       type: boolean
 *                     dinner:
 *                       type: boolean
 *                     accommodationName:
 *                       type: string
 *                     accommodationType:
 *                       type: string
 *                     accommodationRating:
 *                       type: string
 *                       description: Decimal fields are serialized as strings in JSON responses.
 *                     itinerary_activities:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             format: uuid
 *                           itineraryId:
 *                             type: string
 *                             format: uuid
 *                           activityTime:
 *                             type: string
 *                           activity:
 *                             type: string
 *                           durationMinutes:
 *                             type: integer
 *                           included:
 *                             type: boolean
 *                           cost:
 *                             type: string
 *                             description: Decimal fields are serialized as strings in JSON responses.
 *                           locationName:
 *                             type: string
 *                           locationAddress:
 *                             type: string
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
  adminTourController.updateTourItinerary.bind(adminTourController),
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
  adminTourController.deleteTourItinerary.bind(adminTourController),
);

/**
 * @swagger
 * /tours/{tourId}:
 *   get:
 *     summary: Get full tour details
 *     description: Retrieve a complete tour package with all related data including itineraries, activities, locations, media, pricing, and bookings.
 *     tags:
 *       - Tours
 *     parameters:
 *       - in: path
 *         name: tourId
 *         required: true
 *         schema:
 *           type: string
 *         description: The unique ID of the tour package
 *     responses:
 *       200:
 *         description: Tour details retrieved successfully
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
 *                   example: Tour details retrieved successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: "uuid-of-tour"
 *                     title:
 *                       type: string
 *                       example: "Cape Coast Heritage Tour"
 *                     description:
 *                       type: string
 *                       example: "Explore the historic Cape Coast Castle and surrounding heritage sites."
 *                     tour_itineraries:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           dayNumber:
 *                             type: integer
 *                             example: 1
 *                           title:
 *                             type: string
 *                             example: "Arrival and Orientation"
 *                           itinerary_activities:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 activityTime:
 *                                   type: string
 *                                   example: "10:00 AM"
 *                                 activity:
 *                                   type: string
 *                                   example: "Visit Cape Coast Castle"
 *                     tour_locations:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                             example: "Cape Coast Castle"
 *                           city:
 *                             type: string
 *                             example: "Cape Coast"
 *                     tour_media:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           media_type:
 *                             type: string
 *                             example: "image"
 *                           url:
 *                             type: string
 *                             example: "https://example.com/photo.jpg"
 *                     pricing_includes:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           item:
 *                             type: string
 *                             example: "Breakfast included"
 *                     pricing_excludes:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           item:
 *                             type: string
 *                             example: "Flights not included"
 *                     bookings:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           bookingReference:
 *                             type: string
 *                             example: "BOOK12345"
 *                           numberOfPeople:
 *                             type: integer
 *                             example: 2
 *                           status:
 *                             type: string
 *                             example: "PENDING"
 *       404:
 *         description: Tour not found
 *       500:
 *         description: Failed to fetch tour details
 */
router.get("/:tourId", userTourController.getTourDetails.bind(userTourController));

export { router };
