import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { prisma } from "../config/index.js";
import { getFirebaseMessaging } from "../config/firebase.js";
import { logCallPushSent, logCallPushFailed } from "./callLogger.js";
import type { Call } from "../../generated/prisma/client.js";

const expo = new Expo();

interface PushPayload {
  [key: string]: unknown;
  type: string;
  callId: string;
  callType: string;
  callerId?: string;
  callerName?: string;
  callerImageUrl?: string;
  conversationId?: string | null;
  expiresAt?: string;
}

function getPublicProfileImage(user: {
  profile?: { bio_profile_image_url?: string | null; profileUrl?: string | null } | null;
}): string | null {
  return user.profile?.bio_profile_image_url || user.profile?.profileUrl || null;
}

function isInvalidTokenError(error: unknown): boolean {
  const err = error as { message?: string } | undefined;
  const msg = String(err?.message || error || "").toLowerCase();
  return (
    msg.includes("notregistered") ||
    msg.includes("invalidregistration") ||
    msg.includes("devicenotregistered") ||
    msg.includes("invalid-credentials") ||
    msg.includes("messaging/registration-token-not-registered")
  );
}

async function sendToDevice(
  device: { id: string; platform: string; fcmToken: string | null; expoPushToken: string | null },
  payload: PushPayload,
): Promise<void> {
  if (device.platform === "ANDROID" && device.fcmToken) {
    const messaging = getFirebaseMessaging();
    if (!messaging) return;

    await messaging.send({
      token: device.fcmToken,
      data: Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v ?? "")])),
      android: { priority: "high" },
    });
  } else if (device.expoPushToken) {
    const message: ExpoPushMessage = {
      to: device.expoPushToken,
      data: payload,
      sound: "default",
      title: "Incoming Call",
      body: `${payload.callerName ?? "Someone"} is calling...`,
    };

    const chunks = expo.chunkPushNotifications([message]);
    for (const chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
  }
}

/**
 * Send incoming call push to all of the receiver's enabled devices.
 * Silently handles per-device failures and disables invalid tokens.
 */
export async function sendIncomingCallPush(
  call: Call,
  caller: {
    id: string;
    fullName: string;
    profile?: { bio_profile_image_url?: string | null; profileUrl?: string | null } | null;
  },
): Promise<void> {
  const devices = await prisma.userDevice.findMany({
    where: { userId: call.receiverId, enabled: true },
  });

  if (devices.length === 0) return;

  const payload: PushPayload = {
    type: "INCOMING_CALL",
    callId: call.id,
    callType: call.callType,
    callerId: caller.id,
    callerName: caller.fullName,
    callerImageUrl: getPublicProfileImage(caller) ?? undefined,
    conversationId: call.conversationId,
    expiresAt: call.expiresAt.toISOString(),
  };

  const results = await Promise.allSettled(devices.map((device) => sendToDevice(device, payload)));

  const platformBreakdown: Record<string, number> = {};
  for (const d of devices) {
    platformBreakdown[d.platform] = (platformBreakdown[d.platform] || 0) + 1;
  }
  logCallPushSent({ callId: call.id, deviceCount: devices.length, platformBreakdown });

  // Disable devices with invalid tokens
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected") {
      const reason = result.reason;
      if (isInvalidTokenError(reason)) {
        await prisma.userDevice.update({
          where: { id: devices[i].id },
          data: { enabled: false },
        });
        logCallPushFailed({
          callId: call.id,
          deviceId: devices[i].id,
          errorCode: String((reason as Error)?.message || reason),
          tokenInvalidated: true,
        });
      }
    }
  }
}

/**
 * Send missed call push notification to the caller.
 */
export async function sendMissedCallPush(call: Call): Promise<void> {
  const devices = await prisma.userDevice.findMany({
    where: { userId: call.callerId, enabled: true },
  });

  if (devices.length === 0) return;

  const payload: PushPayload = {
    type: "MISSED_CALL",
    callId: call.id,
    callType: call.callType,
  };

  const results = await Promise.allSettled(devices.map((device) => sendToDevice(device, payload)));

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected" && isInvalidTokenError(result.reason)) {
      await prisma.userDevice.update({
        where: { id: devices[i].id },
        data: { enabled: false },
      });
    }
  }
}
