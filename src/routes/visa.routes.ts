import { UserVisaController } from "src/Modules/visa-management/user-visa.controller.js";
import { validate } from "../middleware/validation.js";
import express from "express";
import protectedRoute from "src/middleware/protected.js";
import {
  initiateVisaPaymentSchema,
  visaOnArrivalDataSchema,
} from "src/validator/visaValidation.js";

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
 *               requestId:
 *                 type: string
 *                 format: uuid
 *               passport_image_url:
 *                 type: string
 *                 format: uri
 *               surname:
 *                 type: string
 *               full_name:
 *                 type: string
 *               passport_number:
 *                 type: string
 *               purpose_of_trip:
 *                 type: string
 *               primary_place_of_stay:
 *                 type: string
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *             required:
 *               - requestId
 *               - passport_image_url
 *               - surname
 *               - full_name
 *               - passport_number
 *               - purpose_of_trip
 *               - primary_place_of_stay
 *               - phone
 *               - email
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

router.get(
  "",
  protectedRoute,
  userVisaController.getVisaRequest.bind(userVisaController),
);

router.get(
  "/:requestId/status",
  protectedRoute,
  userVisaController.getVisaStatus.bind(userVisaController),
);

export { router };
