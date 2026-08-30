import type { ExpoPushMessage } from "expo-server-sdk";
import type { Call } from "../../generated/prisma/client.js";

/**
 * Pure helpers for building push payloads and provider messages.
 * No DB or provider dependencies so they can be unit tested in isolation.
 */

export interface CallerProfile {
  id: string;
  fullName: string;
  profile?: { bio_profile_image_url?: string | null; profileUrl?: string | null } | null;
}

export interface DevicePushTarget {
  id: string;
  platform: string;
  fcmToken: string | null;
  expoPushToken: string | null;
}

export type PushProvider = "FCM" | "EXPO";

export type PushPayload = Record<string, string>;

/**
 * Expo/FCM only accept flat string values in data payloads. Drops null and
 * undefined entries and stringifies anything else so a bad value can never
 * cause the whole notification to be rejected.
 */
export function sanitizePushData(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "object") out[key] = JSON.stringify(value);
    else out[key] = String(value);
  }
  return out;
}

export function getPublicProfileImage(user: CallerProfile): string | null {
  return user.profile?.bio_profile_image_url || user.profile?.profileUrl || null;
}

const INVALID_TOKEN_MARKERS = [
  "devicenotregistered",
  "device not registered",
  "invalidregistration",
  "registrationtokennotregistered",
  "registration-token-not-registered",
  "messaging/registration-token-not-registered",
  "invalidtoken",
  "apnstokeninvalid",
];

const TRANSIENT_MARKERS = [
  "timeout",
  "etimedout",
  "econnreset",
  "econnrefused",
  "serviceunavailable",
  "server-unavailable",
  "internal-error",
  "message-rate-exceeded",
  "toomanyrequests",
  "providererror",
  "429",
  "500",
  "502",
  "503",
];

export function isInvalidTokenError(error: unknown): boolean {
  const str = String(
    typeof error === "object" && error !== null && "message" in error
      ? (error as { message?: unknown }).message
      : (error ?? ""),
  ).toLowerCase();
  return INVALID_TOKEN_MARKERS.some((marker) => str.includes(marker));
}

export function isTransientProviderError(error: unknown): boolean {
  const str = String(
    typeof error === "object" && error !== null && "message" in error
      ? (error as { message?: unknown }).message
      : (error ?? ""),
  ).toLowerCase();
  return TRANSIENT_MARKERS.some((marker) => str.includes(marker));
}

/**
 * Decide which provider/token to use for a device.
 * Android prefers the native FCM token (reliable background delivery); anything
 * else falls back to the Expo token. Returns null when the device has no usable
 * token for push delivery.
 */
export function providerForDevice(
  device: DevicePushTarget,
): { provider: PushProvider; token: string } | null {
  if (device.platform === "ANDROID" && device.fcmToken) {
    return { provider: "FCM", token: device.fcmToken };
  }
  if (device.expoPushToken) {
    return { provider: "EXPO", token: device.expoPushToken };
  }
  return null;
}

/**
 * Build the notification payload for an incoming call. The call ID returned by
 * POST /calls is carried inside `data` so the app can navigate to the exact call.
 */
export function buildIncomingCallPayload(
  call: Pick<Call, "id" | "callType" | "conversationId" | "expiresAt">,
  caller: CallerProfile,
): PushPayload {
  return sanitizePushData({
    type: "INCOMING_CALL",
    callId: call.id,
    callType: call.callType,
    callerId: caller.id,
    callerName: caller.fullName,
    callerImageUrl: getPublicProfileImage(caller),
    conversationId: call.conversationId,
    expiresAt: call.expiresAt.toISOString(),
  });
}

/**
 * Build the notification payload for a terminal state change (declined,
 * cancelled, missed, ended, failed). Sent to both participants so the app can
 * dismiss an obsolete incoming-call screen.
 */
export function buildCallStatePayload(
  call: Pick<Call, "id" | "callType" | "status" | "conversationId" | "version">,
): PushPayload {
  return sanitizePushData({
    type: "CALL_STATE_CHANGED",
    callId: call.id,
    callType: call.callType,
    status: call.status,
    conversationId: call.conversationId,
    sequence: call.version,
    occurredAt: new Date().toISOString(),
  });
}

export function titleForPayload(payload: PushPayload): string {
  if (payload.type === "INCOMING_CALL") {
    return payload.callType === "VIDEO" ? "Incoming video call" : "Incoming voice call";
  }
  return "Call update";
}

export function bodyForPayload(payload: PushPayload): string {
  if (payload.type === "INCOMING_CALL") {
    return `${payload.callerName ?? "Someone"} is calling...`;
  }
  switch (payload.status) {
    case "DECLINED":
      return "Call declined";
    case "CANCELLED":
      return "Call cancelled";
    case "MISSED":
      return "Missed call";
    case "ENDED":
      return "Call ended";
    case "FAILED":
      return "Call failed";
    default:
      return "Call ended";
  }
}

/**
 * Build an Expo push message. `channelId` and the custom ringtone are only used
 * by Android, but expo-server-sdk forwards them harmlessly for iOS.
 */
export function buildExpoMessage(to: string, payload: PushPayload): ExpoPushMessage {
  return {
    to,
    title: titleForPayload(payload),
    body: bodyForPayload(payload),
    sound: payload.type === "INCOMING_CALL" ? "call_ringtone.wav" : "default",
    priority: "high",
    channelId: "calls",
    data: payload,
  };
}

/**
 * Build a Firebase Cloud Messaging data-only message. Data-only messages wake
 * the app in the background and let it build a call-screen notification.
 */
export function buildFcmMessage(
  token: string,
  payload: PushPayload,
): {
  token: string;
  data: PushPayload;
  android: { priority: "high" };
  apns: { headers: { "apns-priority": string }; payload: { aps: { "content-available": number } } };
} {
  return {
    token,
    data: payload,
    android: { priority: "high" },
    apns: {
      headers: { "apns-priority": "10" },
      payload: { aps: { "content-available": 1 } },
    },
  };
}
