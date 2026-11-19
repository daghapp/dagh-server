import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";
import { sendTestPushToUser } from "../../helpers/pushNotifications.js";
import { deviceTokenPatch } from "./deviceTokenPatch.js";

/**
 * Register or update a device for push notifications.
 * Upserts by authenticated userId + deviceId. Never accepts userId from body.
 */
export const registerDevice = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { deviceId, platform, publicKey, keyVersion } = req.body;

    // Token independence: an omitted token field is preserved on update; an
    // explicit null (or empty string) clears it. `enabled` and `lastSeenAt`
    // are always refreshed.
    const { update, create } = deviceTokenPatch(req.body);

    // End-to-end encryption key registration (optional, additive).
    const keyPatch: Record<string, unknown> = {};
    if (publicKey !== undefined) {
      keyPatch.publicKey = publicKey === null ? null : String(publicKey).trim() || null;
      keyPatch.keyUpdatedAt = new Date();
      if (keyVersion !== undefined) keyPatch.keyVersion = Number(keyVersion);
    }

    // An installation UUID is unique to the handset. If another account still
    // owns this deviceId (logout skipped DELETE, or the user switched accounts),
    // drop that row so the previous user never keeps receiving this phone's pushes.
    await prisma.userDevice.deleteMany({
      where: { deviceId, userId: { not: userId } },
    });

    const device = await prisma.userDevice.upsert({
      where: {
        userId_deviceId: { userId, deviceId },
      },
      update: {
        ...update,
        ...keyPatch,
        platform,
        enabled: true,
        lastSeenAt: new Date(),
      },
      create: {
        userId,
        deviceId,
        platform,
        ...create,
        ...keyPatch,
      },
    });

    return ok(res, { device }, "Device registered successfully");
  } catch (error) {
    console.error("[Devices] registerDevice error:", error);
    return fail(res, 500, "Failed to register device");
  }
};

/**
 * Send a test push notification to every enabled device of the authenticated
 * user. Returns a per-device result summary so the client can see which
 * provider was used and whether the provider accepted the message.
 */
export const sendTestPush = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const summary = await sendTestPushToUser(userId);
    return ok(res, summary, "Test push sent");
  } catch (error) {
    console.error("[Devices] sendTestPush error:", error);
    return fail(res, 500, "Failed to send test push");
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
      announcementsEnabled: preference?.announcementsEnabled ?? true,
      promotionsEnabled: preference?.promotionsEnabled ?? false,
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
    const { messagesEnabled, announcementsEnabled, promotionsEnabled } = req.body ?? {};

    const patch: {
      messagesEnabled?: boolean;
      announcementsEnabled?: boolean;
      promotionsEnabled?: boolean;
    } = {};

    for (const [key, value] of Object.entries({
      messagesEnabled,
      announcementsEnabled,
      promotionsEnabled,
    })) {
      if (value === undefined) continue;
      if (typeof value !== "boolean") {
        return fail(res, 400, `${key} must be a boolean`);
      }
      patch[key as keyof typeof patch] = value;
    }

    if (Object.keys(patch).length === 0) {
      return fail(
        res,
        400,
        "Provide at least one of messagesEnabled, announcementsEnabled, promotionsEnabled",
      );
    }

    const preference = await prisma.userNotificationPreference.upsert({
      where: { userId },
      update: patch,
      create: { userId, ...patch },
    });

    return ok(
      res,
      {
        messagesEnabled: preference.messagesEnabled,
        announcementsEnabled: preference.announcementsEnabled,
        promotionsEnabled: preference.promotionsEnabled,
      },
      "Notification preferences updated",
    );
  } catch (error) {
    console.error("[Devices] updateNotificationPreferences error:", error);
    return fail(res, 500, "Failed to update notification preferences");
  }
};

/**
 * List a user's device public keys for end-to-end key agreement.
 */
export const getUserEncryptionKeys = async (req: Request, res: Response) => {
  try {
    const userId = String(req.params.userId);
    const devices = await prisma.userDevice.findMany({
      where: { userId, publicKey: { not: null } },
      select: {
        id: true,
        deviceId: true,
        platform: true,
        publicKey: true,
        keyVersion: true,
        keyUpdatedAt: true,
        enabled: true,
      },
      orderBy: { lastSeenAt: "desc" },
    });
    return ok(res, { userId, keys: devices });
  } catch (error) {
    console.error("[Devices] getUserEncryptionKeys error:", error);
    return fail(res, 500, "Failed to fetch encryption keys");
  }
};
