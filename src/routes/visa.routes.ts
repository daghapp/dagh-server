import { UserVisaController } from "../Modules/visa-management/user-visa.controller.js";
import { validate } from "../middleware/validation.js";
import express from "express";
import protectedRoute from "../middleware/protected.js";
import {
  initiateVisaPaymentSchema,
  visaOnArrivalDataSchema,
} from "../validator/visaValidation.js";

const router = express.Router();
const userVisaController = new UserVisaController();

/**
 * @swagger
 * tags:
 *   name: VisaOnArrival
 *   description: Visa on Arrival API
 */

/**
 * @swagger
 * /visa-request/payment:
 *   post:
 *     summary: Initiate payment for Visa on Arrival request
 *     tags: [VisaOnArrival]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               requestId:
 *                 type: string
 *                 format: uuid
 *               packageType:
 *                 type: string
 *                 enum: [STANDARD, EXPEDITED]
 *             required:
 *               - requestId
 *               - packageType
 *     responses:
 *       200:
 *         description: Payment initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 visaRequest:
 *                   $ref: '#/components/schemas/VisaOnArrivalRequest'
 *                 payment:
 *                   $ref: '#/components/schemas/Payment'
 */

router.post(
  "/:requestId/payment",
  protectedRoute,
  validate(initiateVisaPaymentSchema),
  userVisaController.initiateVisaPayment.bind(userVisaController),
);

/**
 * @swagger
 * components:
 *   schemas:
 *     VisaOnArrivalRequest:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         userId:
 *           type: string
 *           format: uuid
 *         status:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED, READY_FOR_GIS_SUBMISSION, EXPEDITED_AIRPORT_PAYMENT_PENDING]
 *         paymentId:
 *           type: string
 *           format: uuid
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     Payment:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         amount:
 *           type: number
 *         currency:
 *           type: string
 *         status:
 *           type: string
 *           enum: [SUCCESS, FAILED, PENDING]
 *         createdAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /visa/request:
 *   post:
 *     summary: Create a Visa on Arrival request with passport details
 *     tags: [VisaOnArrival]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
  *               passport_image_url:
  *                 type: string
  *                 format: uri
  *               bio_page_image_url:
  *                 type: string
  *                 format: uri
  *               flight_itenary_image_url:
  *                 type: string
  *                 format: uri
  *               passport_number:
  *                 type: string
  *               purpose_of_trip:
  *                 type: string
  *               date_of_departure:
  *                 type: string
  *                 format: date-time
  *               date_of_arrival:
  *                 type: string
  *                 format: date-time

  *             required:
  *               - requestId
  *               - passport_image_url
  *               - bio_page_image_url
  *               - flight_itenary_image_url
  *               - passport_number
  *               - purpose_of_trip
  *               - date_of_departure
  *               - date_of_arrival
  *               - primary_place_of_stay
 *     responses:
 *       200:
 *         description: Visa request created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 visaRequest:
 *                   $ref: '#/components/schemas/VisaOnArrivalRequest'
 */
router.post(
  "/passport",
  protectedRoute,
  validate(visaOnArrivalDataSchema),
  userVisaController.createVisaRequest.bind(userVisaController),
);

/**
 * @swagger
 * /visa:
 *   get:
 *     summary: Get all Visa on Arrival requests for the authenticated user
 *     tags: [VisaOnArrival]
 *     responses:
 *       200:
 *         description: List of visa requests retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   userId:
 *                     type: string
 *                     format: uuid
 *                   status:
 *                     type: string
 *                     enum: [PENDING, APPROVED, REJECTED, READY_FOR_GIS_SUBMISSION, EXPEDITED_AIRPORT_PAYMENT_PENDING]
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *                   updatedAt:
 *                     type: string
 *                     format: date-time
 *                   paymentId:
 *                     type: string
 *                     format: uuid
 *                     nullable: true
 *                   packageType:
 *                     type: string
 *                     enum: [STANDARD, EXPEDITED]
 *                     nullable: true
 */
router.get(
  "",
  protectedRoute,
  userVisaController.getVisaRequest.bind(userVisaController),
);

/**
 * @swagger
 * /visa/:requestId/status:
 *   get:
 *     summary: Get the status of a Visa on Arrival request
 *     tags: [VisaOnArrival]
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the visa request
 *     responses:
 *       200:
 *         description: Visa request status retrieved successfully
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
 *                     status:
 *                       type: string
 *                       enum: [PENDING, APPROVED, REJECTED, READY_FOR_GIS_SUBMISSION, EXPEDITED_AIRPORT_PAYMENT_PENDING]
 */
router.get(
  "/:requestId/status",
  protectedRoute,
  userVisaController.getVisaStatus.bind(userVisaController),
);

export { router };
