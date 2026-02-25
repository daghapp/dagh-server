import express from "express";
import {PaymentController} from "../Modules/payment-management/payment.controller.js";
import { initializePaymentSchema, subscribtionPaymentSchema } from "../validator/index.js";
import { validate } from "../middleware/validation.js";
import protectedRoute from "../middleware/protected.js";

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
 *                 message:
 *                   type: string
 *                   example: Payment initialized successfully
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
 *                 message:
 *                   type: string
 *                   example: Invalid response from Hubtel
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
 *                 message:
 *                   type: string
 *                   example: Payment initialization failed
 *                 error:
 *                   type: string
 */
router.post("/initialize", 
    validate(initializePaymentSchema),
    protectedRoute,
    paymentController.initializePayment.bind(paymentController) )

/**
 * @swagger
 * /payment/subscribe:
 *   post:
 *     summary: Create a subscription payment invoice
 *     description: Handles subscription payments by creating an invoice with Hubtel and recording the subscription details in the database
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
 *               - invoiceNumber
 *               - customerName
 *               - customerPhoneNumber
 *               - customerEmail
 *               - hasTax
 *               - issuedBy
 *               - createdBy
 *               - dueDate
 *               - isDefault
 *               - callbackUrl
 *               - items
 *             properties:
 *               invoiceNumber:
 *                 type: string
 *                 minLength: 1
 *                 description: Unique invoice number
 *                 example: INV-2026-001
 *               customerName:
 *                 type: string
 *                 minLength: 1
 *                 description: Name of the customer
 *                 example: John Doe
 *               customerPhoneNumber:
 *                 type: string
 *                 minLength: 1
 *                 description: Customer's phone number
 *                 example: +1234567890
 *               customerEmail:
 *                 type: string
 *                 format: email
 *                 description: Customer's email address
 *                 example: customer@example.com
 *               hasTax:
 *                 type: boolean
 *                 description: Whether the invoice includes tax
 *                 example: false
 *               issuedBy:
 *                 type: string
 *                 minLength: 1
 *                 description: Name or identifier of the issuer
 *                 example: DAGH Services
 *               createdBy:
 *                 type: string
 *                 minLength: 1
 *                 description: Name or identifier of the creator
 *                 example: Admin User
 *               dueDate:
 *                 type: string
 *                 format: date-time
 *                 description: Due date in ISO 8601 datetime format
 *                 example: 2026-03-15T23:59:59.000Z
 *               isDefault:
 *                 type: boolean
 *                 description: Whether this is the default subscription
 *                 example: true
 *               callbackUrl:
 *                 type: string
 *                 format: uri
 *                 description: URL to receive payment callback notification
 *                 example: https://example.com/api/payment/subscription/callback
 *               note:
 *                 type: string
 *                 description: Additional notes for the invoice (optional)
 *                 example: Annual subscription renewal
 *               reminders:
 *                 type: array
 *                 description: Payment reminders configuration (optional)
 *                 items:
 *                   type: object
 *                   required:
 *                     - days
 *                     - isBefore
 *                   properties:
 *                     days:
 *                       type: number
 *                       minimum: 1
 *                       description: Number of days for the reminder
 *                       example: 7
 *                     isBefore:
 *                       type: boolean
 *                       description: Whether the reminder is before the due date
 *                       example: true
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 description: Invoice line items (at least one required)
 *                 items:
 *                   type: object
 *                   required:
 *                     - description
 *                     - quantity
 *                     - unitPrice
 *                   properties:
 *                     description:
 *                       type: string
 *                       minLength: 1
 *                       description: Description of the item
 *                       example: Premium subscription - 1 year
 *                     quantity:
 *                       type: number
 *                       minimum: 1
 *                       description: Quantity of the item
 *                       example: 1
 *                     unitPrice:
 *                       type: number
 *                       minimum: 0
 *                       description: Unit price of the item
 *                       example: 299.99
 *     responses:
 *       200:
 *         description: Subscription invoice created successfully
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
 *                   example: Subscription payment processed successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     invoiceId:
 *                       type: string
 *                       description: Unique invoice ID from Hubtel
 *                     subscription:
 *                       type: object
 *                       description: Created or updated subscription details
 *       400:
 *         description: Invalid request or failed to create invoice
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
 *                   example: Failed to create subscription invoice
 *       401:
 *         description: Unauthorized - User not authenticated
 *       500:
 *         description: Subscription payment processing failed
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
 *                   example: Subscription payment processing failed
 *                 error:
 *                   type: string
 */
router.post("/subscribe", 
    validate(subscribtionPaymentSchema),
    protectedRoute,
    paymentController.subscriptionPayment.bind(paymentController) )

/**
 * @swagger
 * /payment/verify/{reference}:
 *   get:
 *     summary: Verify payment status
 *     description: Verifies the payment status by checking with Hubtel and updating the payment record in the database
 *     tags: [Payment]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment reference (checkoutId) from the initialized payment
 *         example: c4105d52f5a24d2995ffbd094ae12a45
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
 *                   properties:
 *                     status:
 *                       type: string
 *                       description: Payment status from Hubtel
 *                       enum: [Paid, Failed, Pending]
 *                       example: Paid
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
router.get("/verify/:reference", protectedRoute, paymentController.verifyPayment.bind(paymentController) )

export { router }