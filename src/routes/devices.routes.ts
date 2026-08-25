import express from "express";
import protectedRoute from "../middleware/protected.js";
import { validate } from "../middleware/validation.js";
import { registerDeviceSchema } from "../validator/deviceValidation.js";
import { registerDevice, unregisterDevice } from "../modules/devices/devices.controller.js";

const router = express.Router();

router.use(protectedRoute);

/**
 * @swagger
 * /devices/register:
 *   post:
 *     summary: Register or update a device for push notifications
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - deviceId
 *               - platform
 *             properties:
 *               deviceId:
 *                 type: string
 *               platform:
 *                 type: string
 *                 enum: [IOS, ANDROID]
 *               expoPushToken:
 *                 type: string
 *                 nullable: true
 *               fcmToken:
 *                 type: string
 *                 nullable: true
 *               apnsToken:
 *                 type: string
 *                 nullable: true
 *               voipPushToken:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Device registered successfully
 *       400:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 */
router.post("/register", validate(registerDeviceSchema), registerDevice);

/**
 * @swagger
 * /devices/{deviceId}:
 *   delete:
 *     summary: Unregister a device
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Device unregistered
 *       404:
 *         description: Device not found
 *       500:
 *         description: Internal server error
 */
router.delete("/:deviceId", unregisterDevice);

export { router };
