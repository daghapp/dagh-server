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

export interface SenderProfile {
  id: string;
  fullName: string;
  profile?: { bio_profile_image_url?: string | null; profileUrl?: string | null } | null;
}

export type MessageNotificationType = "NEW_MESSAGE";

export interface NewMessagePayload {
  type: MessageNotificationType;
  messageId: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatarUrl?: string;
  messageType: string;
  previewBody: string;
  route: string;
  schemaVersion: string;
}

export interface DevicePushTarget {
  id: string;
  platform: string;
  fcmToken: string | null;
  expoPushToken: string | null;
  voipPushToken?: string | null;
}

export type PushProvider = "FCM" | "EXPO" | "VOIP";

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
  "baddevicetoken",
  "missingdevicetoken",
  "unregistered",
  "devicetokennotfortopic",
];

const TRANSIENT_MARKERS = [
  "timeout",
  "etimedout",
  "econnreset",
  "econnrefused",
  "serviceunavailable",
  "server-unavailable",
  "internal-error",
  "internalservererror",
  "message-rate-exceeded",
  "toomanyrequests",
  "shutdown",
  "expiredprovidertoken",
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

export function isCallPayload(payload: PushPayload): boolean {
  return payload.type === "INCOMING_CALL" || payload.type === "CALL_STATE_CHANGED";
}

/**
 * Decide which provider/token to use for a device.
 * iOS devices that registered a PushKit VoIP token get call payloads delivered
 * as an APNs VoIP push so the OS can launch the terminated app and present the
 * call; on Android the native FCM token is preferred (reliable background
 * delivery); anything else falls back to the Expo token. Returns null when the
 * device has no usable token for push delivery.
 */
export function providerForDevice(
  device: DevicePushTarget,
  payload?: PushPayload,
): { provider: PushProvider; token: string } | null {
  if (payload && isCallPayload(payload) && device.platform === "IOS" && device.voipPushToken) {
    return { provider: "VOIP", token: device.voipPushToken };
  }
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

const MAX_PREVIEW_LENGTH = 120;

/**
 * Build a safe preview string for the visible notification body.
 * Strips markup, collapses whitespace, and truncates to ~120 chars.
 * Never places sensitive URLs in the preview.
 */
function sanitizeTextPreview(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PREVIEW_LENGTH);
}

/**
 * Build the visible notification body based on message type.
 */
export function messagePreviewBody(messageType: string, content?: string | null): string {
  switch (messageType) {
    case "VOICE_NOTE":
      return "Sent a voice message";
    case "IMAGE":
      return "Sent a photo";
    case "VIDEO":
      return "Sent a video";
    case "DOCUMENT":
      return "Sent a document";
    case "TEXT":
      return content ? sanitizeTextPreview(content) : "New message";
    default:
      return "New message";
  }
}

/**
 * Build the NEW_MESSAGE push payload for a chat message. The payload carries
 * enough data for the frontend to navigate to the correct conversation.
 */
export function buildNewMessagePayload(
  message: {
    id: string;
    type: string;
    content?: string | null;
  },
  sender: SenderProfile,
  conversationId: string,
): PushPayload {
  return sanitizePushData({
    type: "NEW_MESSAGE",
    messageId: message.id,
    conversationId,
    senderId: sender.id,
    senderName: sender.fullName,
    senderAvatarUrl: getPublicProfileImage(sender),
    senderImageUrl: getPublicProfileImage(sender),
    messageType: message.type,
    previewBody: messagePreviewBody(message.type, message.content),
    route: "/(connect)/chat/[id]",
    schemaVersion: "1",
  });
}

export function titleForPayload(payload: PushPayload): string {
  if (payload.type === "INCOMING_CALL") {
    return payload.callType === "VIDEO" ? "Incoming video call" : "Incoming voice call";
  }
  if (payload.type === "NEW_MESSAGE") {
    return payload.senderName || "Simply Mark";
  }
  return "Call update";
}

export function bodyForPayload(payload: PushPayload): string {
  if (payload.type === "INCOMING_CALL") {
    return `${payload.callerName ?? "Someone"} is calling...`;
  }
  if (payload.type === "NEW_MESSAGE") {
    return payload.previewBody || messagePreviewBody(payload.messageType, payload.content);
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
 * Build an Expo push message. Uses a dedicated `messages` channel for chat
 * messages (default sound) and the `calls` channel with a custom ringtone
 * for incoming calls. `ttlSeconds` bounds how long the provider may deliver.
 */
export function buildExpoMessage(
  to: string,
  payload: PushPayload,
  ttlSeconds?: number,
): ExpoPushMessage {
  const isCall = payload.type === "INCOMING_CALL" || payload.type === "CALL_STATE_CHANGED";
  return {
    to,
    title: titleForPayload(payload),
    body: bodyForPayload(payload),
    sound: isCall ? "call_ringtone.wav" : "default",
    priority: "high",
    channelId: isCall ? "calls" : "messages",
    ttl: ttlSeconds,
    data: payload,
  };
}

/**
 * Build a Firebase Cloud Messaging message.
 *
 * - `INCOMING_CALL` — visible alert (title/body) on the `calls` channel plus
 *   routing `data`, so a backgrounded/killed app shows a ring without needing
 *   JavaScript. `ttlMs` (defaults to the remaining ring window) bounds delivery
 *   to the ringing period.
 * - `CALL_STATE_CHANGED` — silent data-only cleanup so only the app handler
 *   dismisses ringing state.
 * - `NEW_MESSAGE` — visible notification with data payload.
 */
export function buildFcmMessage(
  token: string,
  payload: PushPayload,
  ttlMs?: number,
): {
  token: string;
  notification?: { title: string; body: string };
  data: PushPayload;
  android: {
    priority: "high";
    ttl?: number;
    notification?: { channelId: string; sound?: string; tag?: string };
  };
  apns: {
    headers: { "apns-priority": string };
    payload: { aps: { "content-available": number; alert?: { title: string; body: string } } };
  };
} {
  const isIncomingCall = payload.type === "INCOMING_CALL";
  const isCallStateChanged = payload.type === "CALL_STATE_CHANGED";
  const ttl = ttlMs !== undefined ? { ttl: ttlMs } : {};

  if (isCallStateChanged) {
    return {
      token,
      data: payload,
      android: { priority: "high", ...ttl },
      apns: {
        headers: { "apns-priority": "10" },
        payload: {
          aps: { "content-available": 1 },
        },
      },
    };
  }

  const visible: { notification: { title: string; body: string }; data: PushPayload } = {
    notification: {
      title: titleForPayload(payload),
      body: bodyForPayload(payload),
    },
    data: payload,
  };

  if (isIncomingCall) {
    return {
      token,
      ...visible,
      android: {
        priority: "high",
        ...ttl,
        notification: {
          channelId: "calls",
          sound: "call_ringtone",
          ...(payload.callId ? { tag: `incoming-call-${payload.callId}` } : {}),
        },
      },
      apns: {
        headers: { "apns-priority": "10" },
        payload: {
          aps: {
            "content-available": 1,
            alert: { title: titleForPayload(payload), body: bodyForPayload(payload) },
          },
        },
      },
    };
  }

  return {
    token,
    ...visible,
    android: {
      priority: "high",
      ...ttl,
      notification: { channelId: "messages", sound: "default" },
    },
    apns: {
      headers: { "apns-priority": "10" },
      payload: {
        aps: {
          "content-available": 1,
          alert: { title: titleForPayload(payload), body: bodyForPayload(payload) },
        },
      },
    },
  };
}

export interface VoipPushMessage {
  to: string;
  pushType: "voip";
  topic: string;
  body: { aps: { "content-available": number }; [key: string]: unknown };
}

/**
 * Build a PushKit VoIP push. Delivered directly to the device's APNs VoIP
 * token so the OS launches the app even when it is terminated. `topic` must be
 * the app bundle ID suffixed with `.voip` (PushKit requirement). The call data
 * rides at the top level of the JSON body for `didReceiveIncomingPush`.
 */
export function buildVoipMessage(to: string, payload: PushPayload, topic: string): VoipPushMessage {
  return {
    to,
    pushType: "voip",
    topic,
    body: {
      aps: { "content-available": 1 },
      ...payload,
    },
  };
}
