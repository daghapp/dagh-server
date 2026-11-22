import express from "express";
import { PaymentController } from "../modules/payment-management/payment.controller.js";
import {
  initializePaymentSchema,
  initializePaymentSchema_apple,
} from "../validator/payment-validator.js";
import { validate } from "../middleware/validation.js";
import protectedRoute from "../middleware/protected.js";
import { viewsPath } from "../helpers/view-path.js";

const router = express.Router();
const paymentController = new PaymentController();

/**
 * @swagger
 * /payment/initialize:
 *   post:
 *     summary: Initialize a payment transaction
 *     description: Initializes a payment by sending a request to Hubtel and storing the payment details in the database
 *     tags: [Payment]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - totalAmount
 *               - description
 *               - returnUrl
 *               - callbackUrl
 *               - cancellationUrl
 *             properties:
 *               totalAmount:
 *                 type: number
 *                 minimum: 0.01
 *                 description: Total amount to be paid (must be positive)
 *                 example: 150.00
 *               description:
 *                 type: string
 *                 minLength: 1
 *                 description: Description of the payment
 *                 example: Payment for visa application
 *               returnUrl:
 *                 type: string
 *                 format: uri
 *                 description: URL to redirect after successful payment
 *                 example: https://example.com/payment/success
 *               callbackUrl:
 *                 type: string
 *                 format: uri
 *                 description: URL to receive payment callback notification
 *                 example: https://example.com/api/payment/callback
 *               cancellationUrl:
 *                 type: string
 *                 format: uri
 *                 description: URL to redirect if payment is cancelled
 *                 example: https://example.com/payment/cancelled
 *     responses:
 *       200:
 *         description: Payment initialized successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                   message:
 *                     type: string
 *                     example: Payment initialized successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     paymentReference:
 *                       type: string
 *                       description: Unique payment reference from Hubtel
 *       400:
 *         description: Invalid request or invalid response from payment provider
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                   message:
 *                     type: string
 *                     example: Invalid response from Hubtel
 *       401:
 *         description: Unauthorized - User not authenticated
 *       500:
 *         description: Payment initialization failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                   message:
 *                     type: string
 *                     example: Payment initialization failed
 *                 error:
 *                   type: string
 *                   example: Payment initialization failed
 *     */
router.post(
  "/initialize",
  protectedRoute,
  validate(initializePaymentSchema),
  paymentController.initializePayment.bind(paymentController),
);

/**
 * @swagger
 * /payment/apple-pay:
 *   post:
 *     summary: Initialize Apple Pay payment
 *     description: Initializes an Apple Pay payment transaction
 *     tags: [Payment]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - totalAmount
 *               - description
 *               - returnUrl
 *               - callbackUrl
 *               - cancellationUrl
 *             properties:
 *               totalAmount:
 *                 type: number
 *                 minimum: 0.01
 *                 description: Total amount to be paid (must be positive)
 *                 example: 150.00
 *               description:
 *                 type: string
 *                 minLength: 1
 *                 description: Description of the payment
 *                 example: Payment for visa application
 *               returnUrl:
 *                 type: string
 *                 format: uri
 *                 description: URL to redirect after successful payment
 *                 example: https://example.com/payment/success
 *               callbackUrl:
 *                 type: string
 *                 format: uri
 *                 description: URL to receive payment callback notification
 *                 example: https://example.com/api/payment/callback
 *               cancellationUrl:
 *                 type: string
 *                 format: uri
 *                 description: URL to redirect if payment is cancelled
 *                 example: https://example.com/payment/cancelled
 *     responses:
 *       200:
 *         description: Apple Pay payment initialized successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                   message:
 *                     type: string
 *                     example: Payment initialized successfully
 *       401:
 *         description: Unauthorized - User not authenticated
 *       503:
 *         description: Payments disabled or Apple Pay initialization failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                   message:
 *                     type: string
 *                     example: Payments are temporarily disabled. Please try again later.
 *     */
router.post(
  "/apple-pay",
  protectedRoute,
  validate(initializePaymentSchema_apple),
  paymentController.initializePayment_Apple.bind(paymentController),
);

/**
 * @swagger
 * /payment/status:
 *   get:
 *     summary: Check if payments are currently enabled
 *     description: Public availability flag used by the frontend to skip payment screens when payments are disabled. Never returns the admin who toggled the setting.
 *     tags: [Payment]
 *     responses:
 *       200:
 *         description: Current payment availability
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
 *                     enabled:
 *                       type: boolean
 *                       example: false
 *                     reason:
 *                       type: string
 *                       nullable: true
 *                       example: "Scheduled maintenance until 16:00 GMT"
 *                 message:
 *                   type: string
 *                   example: "Payments are temporarily disabled. Please try again later."
 *       500:
 *         description: Failed to fetch payment status
 */
router.get("/status", paymentController.getPaymentStatus.bind(paymentController));

/**
 * @swagger
 * /payment/verify/{reference}:
 *   get:
 *     summary: Verify a payment transaction
 *     description: Verifies the status of a payment using the payment reference and updates the payment record in the database
 *     tags: [Payment]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique payment reference returned during payment initialization
 *         example: HBT_20260304_ABC123
 *     responses:
 *       200:
 *         description: Payment verified successfully
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
 *                   example: Payment verified
 *                 data:
 *                   type: object
 *                   description: Raw transaction status data from Hubtel
 *       400:
 *         description: Unable to verify payment
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Unable to verify payment
 *       401:
 *         description: Unauthorized - User not authenticated
 *       500:
 *         description: Payment verification failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Payment verification failed
 *                 error:
 *                   type: string
 */
router.get(
  "/verify/:reference",
  protectedRoute,
  paymentController.verifyPayment.bind(paymentController),
);

/**
 * @swagger
 * /payment/transaction-status/{posSalesId}:
 *   get:
 *     summary: Check transaction status via Hubtel status API
 *     description: Checks the transaction status using Hubtel's dedicated transaction status API endpoint
 *     tags: [Payment]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: posSalesId
 *         required: true
 *         schema:
 *           type: string
 *         description: POS Sales ID from Hubtel transaction
 *         example: HBT_20260304_123456
 *     responses:
 *       200:
 *         description: Transaction status retrieved successfully
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
 *                   example: Transaction status retrieved
 *                 data:
 *                   type: object
 *                   description: Transaction status data from Hubtel
 *       400:
 *         description: Unable to check transaction status
 *       401:
 *         description: Unauthorized - User not authenticated
 *       500:
 *         description: Transaction status check failed
 */
router.get(
  "/transaction-status/:posSalesId",
  protectedRoute,
  paymentController.checkTransactionStatus.bind(paymentController),
);

/**
 * @swagger
 * /payment/processing:
 *   get:
 *     summary: Payment processing page
 *     description: Serves the payment reroute HTML page during payment processing
 *     tags: [Payment]
 *     responses:
 *       200:
 *         description: Payment processing page
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 */
router.get("/processing", (_req, res) => {
  res.status(200).sendFile(viewsPath("payment-reroute.html"));
});

/**
 * @swagger
 * /payment/p.js:
 *   get:
 *     summary: Payment processing JavaScript
 *     description: Serves the payment processing JavaScript file
 *     tags: [Payment]
 *     responses:
 *       200:
 *         description: JavaScript file content
 *         content:
 *           application/javascript:
 *             schema:
 *               type: string
 */
router.get("/p.js", (_req, res) => {
  res.status(200).sendFile(viewsPath("p.js"));
});

export { router };
