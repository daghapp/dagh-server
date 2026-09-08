import { Expo, type ExpoPushReceipt } from "expo-server-sdk";
import { prisma } from "../config/index.js";
import { getFirebaseMessaging } from "../config/firebase.js";
import {
  buildIncomingCallPayload,
  buildCallStatePayload,
  buildNewMessagePayload,
  buildExpoMessage,
  buildFcmMessage,
  buildVoipMessage,
  providerForDevice,
  sanitizePushData,
  isInvalidTokenError,
  isTransientProviderError,
  type CallerProfile,
  type SenderProfile,
  type PushPayload,
  type PushProvider,
} from "./pushPayload.js";
import { sendVoip, isApnsConfigured, getApnTopic } from "../config/apns.js";
import {
  logPushEventCreated,
  logPushTargetSelected,
  logPushSendAttempt,
  logPushProviderAccepted,
  logPushProviderError,
  logPushReceiptChecked,
  sanitizePayload,
  tokenSuffix,
} from "./pushDiagnostics.js";
import {
  logCallPushEnqueued,
  logCallPushSent,
  logCallPushFailed,
  logCallPushReceipt,
  logMessagePushEnqueued,
  logMessagePushSent,
  logMessagePushFailed,
  logMessagePushReceipt,
} from "./callLogger.js";
import type { Call, CallPushDelivery, MessagePushDelivery } from "../../generated/prisma/client.js";

const expo = new Expo();

const MAX_ATTEMPTS = 5;
const EXPO_RECEIPT_DELAY_MS = 60_000;

/**
 * Bounded exponential backoff between delivery attempts (2s, 4s, 8s, ... capped
 * at 60s) so transient provider failures retry without hammering the provider.
 */
function backoffMs(attemptCount: number): number {
  if (attemptCount <= 1) return 2000;
  return Math.min(2000 * 2 ** (attemptCount - 1), 60_000);
}

// ---------------------------------------------------------------------------
// Enqueue (durable outbox)
// ---------------------------------------------------------------------------

/**
 * Upsert a pending delivery row for one device. Re-enqueueing the same
 * (call, device, provider) resets the row so it is sent again.
 */
async function upsertDelivery(input: {
  callId: string;
  targetUserId: string;
  deviceId: string;
  provider: PushProvider;
  token: string;
  payload: PushPayload;
}): Promise<void> {
  const { callId, targetUserId, deviceId, provider, token, payload } = input;
  await prisma.callPushDelivery.upsert({
    where: { callId_deviceId_provider: { callId, deviceId, provider } },
    update: {
      targetUserId,
      token,
      payload,
      status: "PENDING",
      attemptCount: 0,
      providerMessageId: null,
      errorCode: null,
      acceptedAt: null,
      receiptsFetchedAt: null,
      lastAttemptAt: null,
    },
    create: {
      callId,
      targetUserId,
      deviceId,
      provider,
      token,
      payload,
      status: "PENDING",
      attemptCount: 0,
    },
  });
}

async function enqueueForUser(call: Call, userId: string, payload: PushPayload): Promise<void> {
  const devices = await prisma.userDevice.findMany({
    where: { userId, enabled: true },
  });

  if (devices.length === 0) return;

  let enqueued = 0;
  for (const device of devices) {
    const target = providerForDevice(device, payload);
    logPushTargetSelected({
      correlationId: call.id,
      deviceId: device.id,
      platform: device.platform,
      provider: target?.provider,
      tokenSuffix: target ? tokenSuffix(target.token) : null,
      skipReason: target ? undefined : "native_call_token_missing",
      eventType: payload.type,
    });
    if (!target) continue;
    await upsertDelivery({
      callId: call.id,
      targetUserId: userId,
      deviceId: device.id,
      provider: target.provider,
      token: target.token,
      payload,
    });
    enqueued++;
  }

  logCallPushEnqueued({ callId: call.id, userId, deviceCount: enqueued });
}

/**
 * Queue an incoming-call push for every enabled device belonging to the call
 * receiver. The caller's devices are never targeted. Returns before any push
 * provider is contacted — the durable outbox worker owns delivery.
 */
export async function enqueueIncomingCallPush(call: Call, caller: CallerProfile): Promise<void> {
  const payload = buildIncomingCallPayload(call, caller);
  logPushEventCreated({
    eventType: "INCOMING_CALL",
    eventId: call.id,
    callId: call.id,
    conversationId: call.conversationId ?? undefined,
    recipientUserId: call.receiverId,
    createdAt: new Date().toISOString(),
  });
  await enqueueForUser(call, call.receiverId, payload);
  void dispatchCallDeliveries(call.id).catch((error) => {
    console.error("[push] dispatchCallDeliveries error:", error);
  });
}

/**
 * Queue a state-change push for a single recipient. Each transition creates one
 * outbox row per participant, so dispatch must enqueue only the row's own
 * recipient — re-targeting both participants for every row would re-enqueue
 * (and reset) delivery rows that the first dispatch already sent, producing
 * duplicate pushes.
 */
async function enqueueCallStatePushForUser(call: Call, recipientUserId: string): Promise<void> {
  const payload = buildCallStatePayload(call);
  logPushEventCreated({
    eventType: "CALL_STATE_CHANGED",
    eventId: call.id,
    callId: call.id,
    conversationId: call.conversationId ?? undefined,
    recipientUserId,
    createdAt: new Date().toISOString(),
  });
  await enqueueForUser(call, recipientUserId, payload);
}

/**
 * Queue a state-change push (declined / cancelled / missed / ended / failed) to
 * both participants so they can dismiss an obsolete incoming-call screen.
 */
export async function enqueueCallStatePush(call: Call): Promise<void> {
  await enqueueCallStatePushForUser(call, call.callerId);
  await enqueueCallStatePushForUser(call, call.receiverId);
  void dispatchCallDeliveries(call.id).catch((error) => {
    console.error("[push] dispatchCallDeliveries error:", error);
  });
}

// ---------------------------------------------------------------------------
// Message push enqueue
// ---------------------------------------------------------------------------

/**
 * Upsert a pending message delivery row for one device.
 */
async function upsertMessageDelivery(input: {
  messageId: string;
  targetUserId: string;
  deviceId: string;
  provider: PushProvider;
  token: string;
  payload: PushPayload;
}): Promise<void> {
  const { messageId, targetUserId, deviceId, provider, token, payload } = input;
  await prisma.messagePushDelivery.upsert({
    where: { messageId_deviceId: { messageId, deviceId } },
    update: {
      targetUserId,
      token,
      payload,
      status: "PENDING",
      attemptCount: 0,
      providerMessageId: null,
      errorCode: null,
      acceptedAt: null,
      receiptsFetchedAt: null,
      lastAttemptAt: null,
    },
    create: {
      messageId,
      targetUserId,
      deviceId,
      provider,
      token,
      payload,
      status: "PENDING",
      attemptCount: 0,
    },
  });
}

/**
 * Enqueue push notifications for a new message to every enabled device of the
 * recipient. The sender's devices are never targeted. Skips devices with no
 * usable token. Deduplicates identical tokens.
 */
export async function enqueueMessagePushDeliveries(
  messageId: string,
  recipientUserId: string,
  sender: SenderProfile,
  conversationId: string,
  messageType: string,
  content?: string | null,
): Promise<void> {
  const preference = await prisma.userNotificationPreference.findUnique({
    where: { userId: recipientUserId },
  });
  logPushEventCreated({
    eventType: "NEW_MESSAGE",
    eventId: messageId,
    messageId,
    conversationId,
    recipientUserId,
    createdAt: new Date().toISOString(),
  });
  if (preference && !preference.messagesEnabled) return;

  const devices = await prisma.userDevice.findMany({
    where: { userId: recipientUserId, enabled: true },
  });

  if (devices.length === 0) return;

  const seenTokens = new Set<string>();
  let enqueued = 0;

  for (const device of devices) {
    const payload = buildNewMessagePayload(
      { id: messageId, type: messageType, content },
      sender,
      conversationId,
    );
    const target = providerForDevice(device, payload);
    logPushTargetSelected({
      correlationId: messageId,
      deviceId: device.id,
      platform: device.platform,
      provider: target?.provider,
      tokenSuffix: target ? tokenSuffix(target.token) : null,
      skipReason: target ? undefined : "no_usable_token",
      eventType: payload.type,
    });
    if (!target) continue;
    if (seenTokens.has(target.token)) {
      logPushTargetSelected({
        correlationId: messageId,
        deviceId: device.id,
        platform: device.platform,
        skipReason: "duplicate_token",
        eventType: payload.type,
      });
      continue;
    }
    seenTokens.add(target.token);

    await upsertMessageDelivery({
      messageId,
      targetUserId: recipientUserId,
      deviceId: device.id,
      provider: target.provider,
      token: target.token,
      payload,
    });
    enqueued++;
  }

  logMessagePushEnqueued({
    messageId,
    userId: recipientUserId,
    deviceCount: enqueued,
    conversationId,
  });
}

/**
 * Process pending NotificationOutbox records.
 */
const processingOutbox = new Set<string>();

export async function dispatchNotificationOutbox(): Promise<void> {
  const rows = await prisma.notificationOutbox.findMany({
    where: { status: { in: ["PENDING", "RETRY_PENDING"] } },
    take: 50,
  });

  for (const row of rows) {
    if (processingOutbox.has(row.id)) continue;
    processingOutbox.add(row.id);
    try {
      if (row.eventType === "MESSAGE_CREATED") {
        const payload = row.payload as {
          messageId: string;
          conversationId: string;
          senderId: string;
        };
        const message = await prisma.message.findUnique({
          where: { id: payload.messageId },
          include: {
            sender: {
              select: {
                id: true,
                fullName: true,
                email: true,
                profile: { select: { bio_profile_image_url: true, profileUrl: true } },
              },
            },
          },
        });

        if (message) {
          await enqueueMessagePushDeliveries(
            message.id,
            row.recipientUserId,
            message.sender,
            payload.conversationId,
            message.type,
            message.content,
          );
          await dispatchMessageDeliveries(message.id);
        }
      }

      if (row.eventType === "INCOMING_CALL" || row.eventType === "CALL_STATE_CHANGED") {
        const payload = row.payload as { callId: string };
        const call = await prisma.call.findUnique({
          where: { id: payload.callId },
          include: {
            caller: {
              select: {
                id: true,
                fullName: true,
                profile: { select: { bio_profile_image_url: true, profileUrl: true } },
              },
            },
          },
        });

        if (call) {
          if (row.eventType === "INCOMING_CALL") {
            await enqueueIncomingCallPush(call, call.caller);
          } else {
            await enqueueCallStatePushForUser(call, row.recipientUserId);
            void dispatchCallDeliveries(call.id).catch((error) => {
              console.error("[push] dispatchCallDeliveries error:", error);
            });
          }
        }
      }

      await prisma.notificationOutbox.update({
        where: { id: row.id },
        data: { status: "COMPLETED", attempts: { increment: 1 } },
      });
    } catch (error) {
      console.error("[outbox] failed to process row:", row.id, error);
      await prisma.notificationOutbox
        .update({
          where: { id: row.id },
          data: {
            status: row.attempts + 1 >= MAX_ATTEMPTS ? "FAILED" : "RETRY_PENDING",
            attempts: { increment: 1 },
          },
        })
        .catch(() => { });
    } finally {
      processingOutbox.delete(row.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Message delivery
// ---------------------------------------------------------------------------

/** Deliver a single message outbox row, updating status/attempt metadata. */
async function sendMessageDeliveryRow(row: MessagePushDelivery): Promise<void> {
  const device = await prisma.userDevice.findUnique({ where: { id: row.deviceId } });
  const conversationId = (row.payload as PushPayload).conversationId;
  if (!device || !device.enabled) {
    await prisma.messagePushDelivery.update({
      where: { id: row.id },
      data: { status: "FAILED", errorCode: "DEVICE_DISABLED", lastAttemptAt: new Date() },
    });
    return;
  }

  const result = await sendToDevice(
    row.provider,
    row.token,
    row.payload as PushPayload,
    row.attemptCount + 1,
    row.deviceId,
  );
  const now = new Date();

  if (!result.errorCode) {
    await prisma.messagePushDelivery.update({
      where: { id: row.id },
      data: {
        status: "SENT",
        providerMessageId: result.providerMessageId,
        errorCode: null,
        attemptCount: { increment: 1 },
        acceptedAt: now,
        lastAttemptAt: now,
      },
    });
    logMessagePushSent({
      messageId: row.messageId,
      deviceId: row.deviceId,
      provider: row.provider,
      providerMessageId: result.providerMessageId,
      conversationId,
      attempt: row.attemptCount + 1,
    });
    return;
  }

  if (result.invalidToken) {
    await prisma.messagePushDelivery.update({
      where: { id: row.id },
      data: {
        status: "FAILED",
        errorCode: result.errorCode,
        attemptCount: { increment: 1 },
        lastAttemptAt: now,
      },
    });
    await invalidateToken(row.deviceId, row.provider);
    logMessagePushFailed({
      messageId: row.messageId,
      deviceId: row.deviceId,
      provider: row.provider,
      errorCode: result.errorCode,
      conversationId,
      tokenInvalidated: true,
      attempt: row.attemptCount + 1,
    });
    return;
  }

  if (result.transient && row.attemptCount + 1 < MAX_ATTEMPTS) {
    await prisma.messagePushDelivery.update({
      where: { id: row.id },
      data: { errorCode: result.errorCode, attemptCount: { increment: 1 }, lastAttemptAt: now },
    });
    return;
  }

  await prisma.messagePushDelivery.update({
    where: { id: row.id },
    data: {
      status: "FAILED",
      errorCode: result.errorCode,
      attemptCount: { increment: 1 },
      lastAttemptAt: now,
    },
  });
  logMessagePushFailed({
    messageId: row.messageId,
    deviceId: row.deviceId,
    provider: row.provider,
    errorCode: result.errorCode,
    conversationId,
    tokenInvalidated: false,
    attempt: row.attemptCount + 1,
  });
}

/**
 * Immediate best-effort dispatch of a message's pending pushes. In-memory guard
 * prevents a duplicate send for the same message within one process; the cron
 * worker remains the durable fallback.
 */
const dispatchingMessages = new Set<string>();

export async function dispatchMessageDeliveries(messageId: string): Promise<void> {
  if (dispatchingMessages.has(messageId)) return;
  dispatchingMessages.add(messageId);
  try {
    const rows = await prisma.messagePushDelivery.findMany({
      where: { messageId, status: "PENDING" },
      take: 50,
    });
    for (const row of rows) {
      await sendMessageDeliveryRow(row);
    }
  } finally {
    dispatchingMessages.delete(messageId);
  }
}

/**
 * Cron worker step: deliver every pending message outbox row whose backoff
 * window has elapsed.
 */
export async function sendPendingMessagePushDeliveries(): Promise<void> {
  const rows = await prisma.messagePushDelivery.findMany({
    where: { status: "PENDING", attemptCount: { lt: MAX_ATTEMPTS } },
    take: 200,
    orderBy: { createdAt: "asc" },
  });

  for (const row of rows) {
    if (
      row.lastAttemptAt &&
      row.lastAttemptAt.getTime() + backoffMs(row.attemptCount) > Date.now()
    ) {
      continue;
    }
    await sendMessageDeliveryRow(row);
  }
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

interface SendResult {
  providerMessageId: string | null;
  errorCode: string | null;
  transient: boolean;
  invalidToken: boolean;
}

async function sendToDevice(
  provider: PushProvider,
  token: string,
  payload: PushPayload,
  attempt = 1,
  deviceId: string | null = null,
): Promise<SendResult> {
  // Incoming-call pushes must not outlive the ringing window: expire the
  // delivery once the call is terminal and bound provider TTL to the remaining
  // ring time (never exceed it), matching the server's ringing deadline.
  const expiresAtMs =
    payload.type === "INCOMING_CALL" && payload.expiresAt
      ? new Date(payload.expiresAt).getTime()
      : undefined;
  const remainingRingMs =
    expiresAtMs !== undefined ? Math.max(0, expiresAtMs - Date.now()) : undefined;

  if (payload.type === "INCOMING_CALL" && remainingRingMs !== undefined && remainingRingMs <= 0) {
    return {
      providerMessageId: null,
      errorCode: "CALL_EXPIRED",
      transient: false,
      invalidToken: false,
    };
  }

  const ttlMs =
    remainingRingMs !== undefined
      ? Math.max(1, Math.ceil(remainingRingMs))
      : payload.type === "CALL_STATE_CHANGED"
        ? 60_000
        : undefined;
  const ttlSeconds = ttlMs !== undefined ? Math.max(1, Math.ceil(ttlMs / 1000)) : undefined;
  const correlationId = payload.callId ?? payload.messageId ?? "unknown";

  logPushSendAttempt({
    correlationId,
    deviceId,
    provider,
    eventType: payload.type,
    attempt,
    priority: "high",
    tokenSuffix: tokenSuffix(token),
    ttlMs,
    payload: sanitizePayload(payload),
  });

  if (provider === "VOIP") {
    if (!isApnsConfigured()) {
      return {
        providerMessageId: null,
        errorCode: "APNS_NOT_CONFIGURED",
        transient: true,
        invalidToken: false,
      };
    }

    const message = buildVoipMessage(token, payload, getApnTopic());
    let response;
    try {
      response = await sendVoip(message);
    } catch (error) {
      response = {
        statusCode: null,
        body: (error as { message?: string })?.message ?? String(error),
      };
    }

    if (response.statusCode === 200) {
      logPushProviderAccepted({
        correlationId,
        deviceId,
        provider,
        providerMessageId: response.apnsId ?? null,
        eventType: payload.type,
      });
      return {
        providerMessageId: response.apnsId ?? null,
        errorCode: null,
        transient: false,
        invalidToken: false,
      };
    }

    const errorCode =
      response.statusCode === null
        ? `APNs network: ${response.body}`
        : `APNs ${response.statusCode}: ${response.body}`;
    const transient = isTransientProviderError(errorCode);
    const invalidToken = isInvalidTokenError(errorCode);
    logPushProviderError({
      correlationId,
      deviceId,
      provider,
      eventType: payload.type,
      errorCode,
      attempt,
      retry: transient && attempt < MAX_ATTEMPTS,
      tokenInvalidated: invalidToken,
    });
    return {
      providerMessageId: null,
      errorCode,
      transient,
      invalidToken,
    };
  }

  if (provider === "FCM") {
    const messaging = getFirebaseMessaging();
    if (!messaging) {
      return {
        providerMessageId: null,
        errorCode: "FIREBASE_NOT_CONFIGURED",
        transient: true,
        invalidToken: false,
      };
    }

    try {
      const startedAt = Date.now();
      const messageId = await messaging.send(buildFcmMessage(token, payload, ttlMs));
      logPushProviderAccepted({
        correlationId,
        deviceId,
        provider,
        providerMessageId: messageId,
        eventType: payload.type,
        latencyMs: Date.now() - startedAt,
      });
      return {
        providerMessageId: messageId,
        errorCode: null,
        transient: false,
        invalidToken: false,
      };
    } catch (error) {
      const code =
        (error as { code?: string })?.code ||
        (error as { message?: string })?.message ||
        String(error);
      const transient = isTransientProviderError(error);
      const invalidToken = isInvalidTokenError(error);
      logPushProviderError({
        correlationId,
        deviceId,
        provider,
        eventType: payload.type,
        errorCode: code,
        attempt,
        retry: transient && attempt < MAX_ATTEMPTS,
        tokenInvalidated: invalidToken,
      });
      return {
        providerMessageId: null,
        errorCode: code,
        transient,
        invalidToken,
      };
    }
  }

  try {
    const message = buildExpoMessage(token, payload, ttlSeconds);
    const [ticket] = await expo.sendPushNotificationsAsync([message]);
    if (ticket && ticket.status === "error") {
      const errorCode = [
        ticket.message,
        ticket.details?.error && `ExpoError:${ticket.details.error}`,
      ]
        .filter(Boolean)
        .join(" | ");
      const transient = isTransientProviderError(ticket);
      const invalidToken = isInvalidTokenError(ticket);
      logPushProviderError({
        correlationId,
        deviceId,
        provider,
        eventType: payload.type,
        errorCode,
        attempt,
        retry: transient && attempt < MAX_ATTEMPTS,
        tokenInvalidated: invalidToken,
      });
      return {
        providerMessageId: null,
        errorCode,
        transient,
        invalidToken,
      };
    }
    logPushProviderAccepted({
      correlationId,
      deviceId,
      provider,
      providerMessageId: ticket?.id ?? null,
      eventType: payload.type,
    });
    return {
      providerMessageId: ticket?.id ?? null,
      errorCode: null,
      transient: false,
      invalidToken: false,
    };
  } catch (error) {
    const errorCode = (error as { message?: string })?.message || String(error);
    const transient = isTransientProviderError(error);
    const invalidToken = isInvalidTokenError(error);
    logPushProviderError({
      correlationId,
      deviceId,
      provider,
      eventType: payload.type,
      errorCode,
      attempt,
      retry: transient && attempt < MAX_ATTEMPTS,
      tokenInvalidated: invalidToken,
    });
    return {
      providerMessageId: null,
      errorCode,
      transient,
      invalidToken,
    };
  }
}

/**
 * Invalidate a token that the provider rejected. The installation stays (it can
 * re-register) but the stale token is removed and the device disabled so we
 * never target it again. `disabledAt` records when, `failureCount` tracks how
 * many times this installation's tokens have been rejected.
 */
async function invalidateToken(deviceId: string, provider: PushProvider): Promise<void> {
  const tokenField =
    provider === "FCM"
      ? { fcmToken: null }
      : provider === "VOIP"
        ? { voipPushToken: null }
        : { expoPushToken: null };
  await prisma.userDevice
    .updateMany({
      where: { id: deviceId, enabled: true },
      data: {
        enabled: false,
        disabledAt: new Date(),
        failureCount: { increment: 1 },
        ...tokenField,
      },
    })
    .catch((error) => {
      console.error("[push] invalidateToken error:", error);
    });
}

/** Deliver a single outbox row, updating status/attempt metadata. */
async function sendDeliveryRow(row: CallPushDelivery): Promise<void> {
  const device = await prisma.userDevice.findUnique({ where: { id: row.deviceId } });
  if (!device || !device.enabled) {
    await prisma.callPushDelivery.update({
      where: { id: row.id },
      data: { status: "FAILED", errorCode: "DEVICE_DISABLED", lastAttemptAt: new Date() },
    });
    return;
  }

  const result = await sendToDevice(
    row.provider,
    row.token,
    row.payload as PushPayload,
    row.attemptCount + 1,
    row.deviceId,
  );
  const now = new Date();

  if (!result.errorCode) {
    await prisma.callPushDelivery.update({
      where: { id: row.id },
      data: {
        status: "SENT",
        providerMessageId: result.providerMessageId,
        errorCode: null,
        attemptCount: { increment: 1 },
        acceptedAt: now,
        lastAttemptAt: now,
      },
    });
    logCallPushSent({
      callId: row.callId,
      deviceId: row.deviceId,
      provider: row.provider,
      providerMessageId: result.providerMessageId,
    });
    return;
  }

  if (result.invalidToken) {
    await prisma.callPushDelivery.update({
      where: { id: row.id },
      data: {
        status: "FAILED",
        errorCode: result.errorCode,
        attemptCount: { increment: 1 },
        lastAttemptAt: now,
      },
    });
    await invalidateToken(row.deviceId, row.provider);
    logCallPushFailed({
      callId: row.callId,
      deviceId: row.deviceId,
      provider: row.provider,
      errorCode: result.errorCode,
      tokenInvalidated: true,
    });
    return;
  }

  if (result.transient && row.attemptCount + 1 < MAX_ATTEMPTS) {
    await prisma.callPushDelivery.update({
      where: { id: row.id },
      data: { errorCode: result.errorCode, attemptCount: { increment: 1 }, lastAttemptAt: now },
    });
    return;
  }

  await prisma.callPushDelivery.update({
    where: { id: row.id },
    data: {
      status: "FAILED",
      errorCode: result.errorCode,
      attemptCount: { increment: 1 },
      lastAttemptAt: now,
    },
  });
  logCallPushFailed({
    callId: row.callId,
    deviceId: row.deviceId,
    provider: row.provider,
    errorCode: result.errorCode,
    tokenInvalidated: false,
  });
}

/**
 * Immediate best-effort dispatch of a call's pending pushes. In-memory guard
 * prevents a duplicate send for the same call within one process; the cron
 * worker remains the durable fallback so a restart cannot lose deliveries.
 */
const dispatchingCalls = new Set<string>();

export async function dispatchCallDeliveries(callId: string): Promise<void> {
  if (dispatchingCalls.has(callId)) return;
  dispatchingCalls.add(callId);
  try {
    const rows = await prisma.callPushDelivery.findMany({
      where: { callId, status: "PENDING" },
      take: 50,
    });
    for (const row of rows) {
      await sendDeliveryRow(row);
    }
  } finally {
    dispatchingCalls.delete(callId);
  }
}

/**
 * Cron worker step: deliver every pending outbox row whose backoff window has
 * elapsed. Retries transient failures with bounded exponential backoff and
 * invalidates tokens the provider rejects.
 */
export async function sendPendingPushDeliveries(): Promise<void> {
  const rows = await prisma.callPushDelivery.findMany({
    where: { status: "PENDING", attemptCount: { lt: MAX_ATTEMPTS } },
    take: 200,
    orderBy: { createdAt: "asc" },
  });

  for (const row of rows) {
    if (
      row.lastAttemptAt &&
      row.lastAttemptAt.getTime() + backoffMs(row.attemptCount) > Date.now()
    ) {
      continue;
    }
    await sendDeliveryRow(row);
  }
}

/**
 * Fetch Expo push receipts for tickets accepted earlier. A successful HTTP
 * request to Expo only means the message was accepted; the receipt determines
 * whether APNs/FCM really delivered it. DeviceNotRegistered receipts invalidate
 * the token.
 */
export async function fetchExpoPushReceipts(): Promise<void> {
  const cutoff = new Date(Date.now() - EXPO_RECEIPT_DELAY_MS);

  const rows = await prisma.callPushDelivery.findMany({
    where: {
      status: "SENT",
      provider: "EXPO",
      receiptsFetchedAt: null,
      acceptedAt: { not: null, lte: cutoff },
    },
    take: 1000,
  });

  const receiptIds = rows
    .map((row) => row.providerMessageId)
    .filter((id): id is string => Boolean(id));

  if (receiptIds.length === 0) return;

  const receipts = new Map<string, ExpoPushReceipt>();
  for (const chunk of expo.chunkPushNotificationReceiptIds(receiptIds)) {
    try {
      const batch = await expo.getPushNotificationReceiptsAsync(chunk);
      for (const [id, receipt] of Object.entries(batch)) {
        receipts.set(id, receipt);
      }
    } catch (error) {
      console.error("[push] getPushNotificationReceiptsAsync error:", error);
    }
  }

  const now = new Date();

  for (const row of rows) {
    if (!row.providerMessageId) {
      await prisma.callPushDelivery.update({
        where: { id: row.id },
        data: { receiptsFetchedAt: now, status: "FAILED", errorCode: "RECEIPT_MISSING_ID" },
      });
      continue;
    }

    const receipt = receipts.get(row.providerMessageId);
    if (!receipt) continue; // Receipt not available yet — try again next run.

    if (receipt.status === "ok") {
      await prisma.callPushDelivery.update({
        where: { id: row.id },
        data: { status: "DELIVERED", receiptsFetchedAt: now },
      });
      logCallPushReceipt({
        callId: row.callId,
        deviceId: row.deviceId,
        provider: "EXPO",
        status: "DELIVERED",
      });
      logPushReceiptChecked({
        correlationId: row.callId,
        deviceId: row.deviceId,
        provider: "EXPO",
        status: "DELIVERED",
      });
      continue;
    }

    const errorString = [receipt.message, receipt.details?.error].filter(Boolean).join(" | ");

    if (isInvalidTokenError(receipt)) {
      await prisma.callPushDelivery.update({
        where: { id: row.id },
        data: { status: "FAILED", errorCode: errorString, receiptsFetchedAt: now },
      });
      await invalidateToken(row.deviceId, "EXPO");
      logCallPushFailed({
        callId: row.callId,
        deviceId: row.deviceId,
        provider: "EXPO",
        errorCode: errorString,
        tokenInvalidated: true,
      });
      logPushReceiptChecked({
        correlationId: row.callId,
        deviceId: row.deviceId,
        provider: "EXPO",
        status: "FAILED",
        errorCode: errorString,
      });
      continue;
    }

    await prisma.callPushDelivery.update({
      where: { id: row.id },
      data: { status: "FAILED", errorCode: errorString, receiptsFetchedAt: now },
    });
    logCallPushReceipt({
      callId: row.callId,
      deviceId: row.deviceId,
      provider: "EXPO",
      status: "FAILED",
      errorCode: errorString,
    });
    logPushReceiptChecked({
      correlationId: row.callId,
      deviceId: row.deviceId,
      provider: "EXPO",
      status: "FAILED",
      errorCode: errorString,
    });
  }
}

/**
 * Fetch Expo push receipts for message push tickets accepted earlier.
 */
export async function fetchMessageExpoPushReceipts(): Promise<void> {
  const cutoff = new Date(Date.now() - EXPO_RECEIPT_DELAY_MS);

  const rows = await prisma.messagePushDelivery.findMany({
    where: {
      status: "SENT",
      provider: "EXPO",
      receiptsFetchedAt: null,
      acceptedAt: { not: null, lte: cutoff },
    },
    take: 1000,
  });

  const receiptIds = rows
    .map((row) => row.providerMessageId)
    .filter((id): id is string => Boolean(id));

  if (receiptIds.length === 0) return;

  const receipts = new Map<string, ExpoPushReceipt>();
  for (const chunk of expo.chunkPushNotificationReceiptIds(receiptIds)) {
    try {
      const batch = await expo.getPushNotificationReceiptsAsync(chunk);
      for (const [id, receipt] of Object.entries(batch)) {
        receipts.set(id, receipt);
      }
    } catch (error) {
      console.error("[push] message getPushNotificationReceiptsAsync error:", error);
    }
  }

  const now = new Date();

  for (const row of rows) {
    if (!row.providerMessageId) {
      await prisma.messagePushDelivery.update({
        where: { id: row.id },
        data: { receiptsFetchedAt: now, status: "FAILED", errorCode: "RECEIPT_MISSING_ID" },
      });
      continue;
    }

    const receipt = receipts.get(row.providerMessageId);
    if (!receipt) continue;

    const conversationId = (row.payload as PushPayload).conversationId;

    if (receipt.status === "ok") {
      await prisma.messagePushDelivery.update({
        where: { id: row.id },
        data: { status: "DELIVERED", receiptsFetchedAt: now },
      });
      logMessagePushReceipt({
        messageId: row.messageId,
        deviceId: row.deviceId,
        provider: "EXPO",
        status: "DELIVERED",
        conversationId,
      });
      logPushReceiptChecked({
        correlationId: row.messageId,
        deviceId: row.deviceId,
        provider: "EXPO",
        status: "DELIVERED",
      });
      continue;
    }

    const errorString = [receipt.message, receipt.details?.error].filter(Boolean).join(" | ");

    if (isInvalidTokenError(receipt)) {
      await prisma.messagePushDelivery.update({
        where: { id: row.id },
        data: { status: "FAILED", errorCode: errorString, receiptsFetchedAt: now },
      });
      await invalidateToken(row.deviceId, "EXPO");
      logMessagePushFailed({
        messageId: row.messageId,
        deviceId: row.deviceId,
        provider: "EXPO",
        errorCode: errorString,
        conversationId,
        tokenInvalidated: true,
      });
      logPushReceiptChecked({
        correlationId: row.messageId,
        deviceId: row.deviceId,
        provider: "EXPO",
        status: "FAILED",
        errorCode: errorString,
      });
      continue;
    }

    await prisma.messagePushDelivery.update({
      where: { id: row.id },
      data: { status: "FAILED", errorCode: errorString, receiptsFetchedAt: now },
    });
    logMessagePushReceipt({
      messageId: row.messageId,
      deviceId: row.deviceId,
      provider: "EXPO",
      status: "FAILED",
      errorCode: errorString,
      conversationId,
    });
    logPushReceiptChecked({
      correlationId: row.messageId,
      deviceId: row.deviceId,
      provider: "EXPO",
      status: "FAILED",
      errorCode: errorString,
    });
  }
}

// ---------------------------------------------------------------------------
// Test push (diagnostics endpoint)
// ---------------------------------------------------------------------------

export interface TestPushResult {
  deviceId: string;
  provider: PushProvider;
  status: "SENT" | "FAILED" | "SKIPPED";
  providerMessageId?: string;
  error?: string;
}

/**
 * Send a test notification to every enabled device of the user. Backs the
 * `POST /devices/test-push` endpoint so clients can validate the push pipeline
 * end-to-end without creating a real message or call. Skips devices with no
 * usable token and reports per-device outcomes.
 */
export async function sendTestPushToUser(userId: string): Promise<{
  deviceCount: number;
  results: TestPushResult[];
}> {
  const devices = await prisma.userDevice.findMany({
    where: { userId, enabled: true },
  });

  if (devices.length === 0) {
    return { deviceCount: 0, results: [] };
  }

  const payload: PushPayload = sanitizePushData({
    type: "NEW_MESSAGE",
    messageId: `push-test-${Date.now()}`,
    conversationId: "push-test",
    senderId: "system",
    senderName: "Diaspora Sync",
    messageType: "TEXT",
    previewBody: "This is a test push notification",
    preview: "This is a test push notification",
    route: "/(connect)/chat/[id]",
    schemaVersion: "1",
  });

  const results: TestPushResult[] = [];
  for (const device of devices) {
    const target = providerForDevice(device, payload);
    if (!target) {
      results.push({
        deviceId: device.id,
        provider: "EXPO",
        status: "SKIPPED",
        error: "no_usable_token",
      });
      continue;
    }

    const result = await sendToDevice(target.provider, target.token, payload, 1, device.id);
    results.push({
      deviceId: device.id,
      provider: target.provider,
      status: result.errorCode ? "FAILED" : "SENT",
      ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
      ...(result.errorCode ? { error: result.errorCode } : {}),
    });
  }

  return { deviceCount: devices.length, results };
}

// ---------------------------------------------------------------------------
// Legacy entry points (kept for API compatibility)
// ---------------------------------------------------------------------------

/** Enqueues the incoming-call push durably and kicks an immediate send. */
export async function sendIncomingCallPush(call: Call, caller: CallerProfile): Promise<void> {
  await enqueueIncomingCallPush(call, caller);
}

/** Enqueues a missed-call state push to both participants. */
export async function sendMissedCallPush(call: Call): Promise<void> {
  await enqueueCallStatePush(call);
}
