import { Expo, type ExpoPushReceipt } from "expo-server-sdk";
import { prisma } from "../config/index.js";
import { getFirebaseMessaging } from "../config/firebase.js";
import {
  buildIncomingCallPayload,
  buildCallStatePayload,
  buildExpoMessage,
  buildFcmMessage,
  providerForDevice,
  isInvalidTokenError,
  isTransientProviderError,
  type CallerProfile,
  type PushPayload,
  type PushProvider,
} from "./pushPayload.js";
import {
  logCallPushEnqueued,
  logCallPushSent,
  logCallPushFailed,
  logCallPushReceipt,
} from "./callLogger.js";
import type { Call, CallPushDelivery } from "../../generated/prisma/client.js";

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
    const target = providerForDevice(device);
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
  await enqueueForUser(call, call.receiverId, payload);
  void dispatchCallDeliveries(call.id).catch((error) => {
    console.error("[push] dispatchCallDeliveries error:", error);
  });
}

/**
 * Queue a state-change push (declined / cancelled / missed / ended / failed) to
 * both participants so they can dismiss an obsolete incoming-call screen.
 */
export async function enqueueCallStatePush(call: Call): Promise<void> {
  const payload = buildCallStatePayload(call);
  await enqueueForUser(call, call.callerId, payload);
  await enqueueForUser(call, call.receiverId, payload);
  void dispatchCallDeliveries(call.id).catch((error) => {
    console.error("[push] dispatchCallDeliveries error:", error);
  });
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
): Promise<SendResult> {
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
      const messageId = await messaging.send(buildFcmMessage(token, payload));
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
      return {
        providerMessageId: null,
        errorCode: code,
        transient: isTransientProviderError(error),
        invalidToken: isInvalidTokenError(error),
      };
    }
  }

  try {
    const message = buildExpoMessage(token, payload);
    const [ticket] = await expo.sendPushNotificationsAsync([message]);
    if (ticket && ticket.status === "error") {
      return {
        providerMessageId: null,
        errorCode: [ticket.message, ticket.details?.error && `ExpoError:${ticket.details.error}`]
          .filter(Boolean)
          .join(" | "),
        transient: isTransientProviderError(ticket),
        invalidToken: isInvalidTokenError(ticket),
      };
    }
    return {
      providerMessageId: ticket?.id ?? null,
      errorCode: null,
      transient: false,
      invalidToken: false,
    };
  } catch (error) {
    return {
      providerMessageId: null,
      errorCode: (error as { message?: string })?.message || String(error),
      transient: isTransientProviderError(error),
      invalidToken: isInvalidTokenError(error),
    };
  }
}

/**
 * Invalidate a token that the provider rejected. The installation stays (it can
 * re-register) but the stale token is removed and the device disabled so we
 * never target it again.
 */
async function invalidateToken(deviceId: string, provider: PushProvider): Promise<void> {
  const tokenField = provider === "FCM" ? { fcmToken: null } : { expoPushToken: null };
  await prisma.userDevice
    .updateMany({
      where: { id: deviceId, enabled: true },
      data: { enabled: false, ...tokenField },
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

  const result = await sendToDevice(row.provider, row.token, row.payload as PushPayload);
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
  }
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
