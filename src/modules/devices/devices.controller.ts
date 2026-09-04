import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";

/**
 * Register or update a device for push notifications.
 * Upserts by authenticated userId + deviceId. Never accepts userId from body.
 */
export const registerDevice = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { deviceId, platform, expoPushToken, fcmToken, apnsToken, voipPushToken } = req.body;

    const device = await prisma.userDevice.upsert({
      where: {
        userId_deviceId: { userId, deviceId },
      },
      update: {
        platform,
        expoPushToken: expoPushToken ?? undefined,
        fcmToken: fcmToken ?? undefined,
        apnsToken: apnsToken ?? undefined,
        voipPushToken: voipPushToken ?? undefined,
        enabled: true,
        lastSeenAt: new Date(),
      },
      create: {
        userId,
        deviceId,
        platform,
        expoPushToken: expoPushToken ?? null,
        fcmToken: fcmToken ?? null,
        apnsToken: apnsToken ?? null,
        voipPushToken: voipPushToken ?? null,
      },
    });

    return ok(res, { device }, "Device registered successfully");
  } catch (error) {
    console.error("[Devices] registerDevice error:", error);
    return fail(res, 500, "Failed to register device");
  }
};

/**
 * Unregister a device. Only the owning user can delete.
 */
export const unregisterDevice = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const deviceId = String(req.params.deviceId);

    const device = await prisma.userDevice.findUnique({
      where: { userId_deviceId: { userId, deviceId } },
    });

    if (!device) {
      return fail(res, 404, "Device not found");
    }

    await prisma.userDevice.delete({
      where: { id: device.id },
    });

    return ok(res, { deleted: true }, "Device unregistered");
  } catch (error) {
    console.error("[Devices] unregisterDevice error:", error);
    return fail(res, 500, "Failed to unregister device");
  }
};

/**
 * Disable a device when its push token is rejected by the provider.
 * Called internally when FCM/APNs/Expo returns a token-invalid error.
 */
export const disableDevice = async (userId: string, deviceId: string) => {
  try {
    await prisma.userDevice.updateMany({
      where: { userId, deviceId, enabled: true },
      data: { enabled: false },
    });
  } catch (error) {
    console.error("[Devices] disableDevice error:", error);
  }
};

/**
 * Disable all devices for a user (e.g. on logout).
 */
export const disableAllUserDevices = async (userId: string) => {
  try {
    await prisma.userDevice.updateMany({
      where: { userId, enabled: true },
      data: { enabled: false },
    });
  } catch (error) {
    console.error("[Devices] disableAllUserDevices error:", error);
  }
};

/**
 * Get notification preferences for the authenticated user.
 */
export const getNotificationPreferences = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const preference = await prisma.userNotificationPreference.findUnique({
      where: { userId },
    });

    return ok(res, {
      messagesEnabled: preference?.messagesEnabled ?? true,
    });
  } catch (error) {
    console.error("[Devices] getNotificationPreferences error:", error);
    return fail(res, 500, "Failed to fetch notification preferences");
  }
};

/**
 * Update notification preferences for the authenticated user.
 */
export const updateNotificationPreferences = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { messagesEnabled } = req.body;

    if (typeof messagesEnabled !== "boolean") {
      return fail(res, 400, "messagesEnabled must be a boolean");
    }

    const preference = await prisma.userNotificationPreference.upsert({
      where: { userId },
      update: { messagesEnabled },
      create: { userId, messagesEnabled },
    });

    return ok(
      res,
      { messagesEnabled: preference.messagesEnabled },
      "Notification preferences updated",
    );
  } catch (error) {
    console.error("[Devices] updateNotificationPreferences error:", error);
    return fail(res, 500, "Failed to update notification preferences");
  }
};
