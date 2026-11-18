import { Expo } from "expo-server-sdk";
import { prisma } from "../config/index.js";
import { getFirebaseMessaging } from "../config/firebase.js";
import {
  buildAnnouncementPayload,
  buildExpoMessage,
  buildFcmMessage,
  isInvalidTokenError,
  isTransientProviderError,
  providerForDevice,
  type PushPayload,
  type PushProvider,
} from "../helpers/pushPayload.js";
import { isEligibleForCategory } from "../validator/announcementValidation.js";
import { AccountStatus, type Prisma } from "../../generated/prisma/client.js";

const expo = new Expo();

const ENQUEUE_PAGE_SIZE = 500;
const SEND_BATCH_SIZE = 400;
const EXPO_CHUNK_SIZE = 100;
const FCM_CONCURRENCY = 10;
const MAX_ATTEMPTS = 4;
const EXPO_RECEIPT_DELAY_MS = 60_000;
const STUCK_SENDING_MS = 15 * 60_000;

type DeliveryStatus = "PENDING" | "SENDING" | "SENT" | "DELIVERED" | "FAILED" | "SKIPPED" | "RETRY_PENDING";

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  category: string;
  audience: string;
  route: string | null;
  status: string;
}

interface DeliveryRow {
  id: string;
  announcementId: string;
  userId: string;
  deviceId: string;
  provider: string;
  status: string;
  attemptCount: number;
  providerMessageId: string | null;
}

interface DeviceRow {
  id: string;
  enabled: boolean;
  platform: string;
  expoPushToken: string | null;
  fcmToken: string | null;
  voipPushToken: string | null;
}

function backoffMs(attemptCount: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attemptCount - 1), 15 * 60_000);
}

function announcementPayload(row: AnnouncementRow): PushPayload {
  return buildAnnouncementPayload({
    id: row.id,
    title: row.title,
    body: row.body,
    category: row.category,
    route: row.route,
  });
}

function tokenForProvider(device: DeviceRow, provider: string): string | null {
  if (provider === "EXPO") return device.expoPushToken;
  if (provider === "FCM") return device.fcmToken;
  return null;
}

async function invalidateDeviceToken(
  deviceId: string,
  provider: PushProvider,
): Promise<void> {
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
      console.error("[announcements] invalidateDeviceToken error:", error);
    });
}

async function updateDelivery(
  id: string,
  data: {
    status: DeliveryStatus;
    errorCode?: string | null;
    providerMessageId?: string | null;
    availableAt?: Date;
    sentAt?: Date | null;
  },
): Promise<void> {
  await prisma.announcementDelivery.update({
    where: { id },
    data: {
      status: data.status,
      ...(data.errorCode !== undefined ? { errorCode: data.errorCode } : {}),
      ...(data.providerMessageId !== undefined
        ? { providerMessageId: data.providerMessageId }
        : {}),
      ...(data.availableAt ? { availableAt: data.availableAt } : {}),
      ...(data.sentAt !== undefined ? { sentAt: data.sentAt } : {}),
    },
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function audienceWhere(audience: string): Prisma.UserDeviceWhereInput {
  const accountStatus =
    audience === "ALL"
      ? {
          in: [
            AccountStatus.ACTIVE,
            AccountStatus.PENDING,
            AccountStatus.PENDING_VERIFICATION,
            AccountStatus.DEACTIVATED,
          ],
        }
      : AccountStatus.ACTIVE;

  return {
    enabled: true,
    OR: [{ expoPushToken: { not: null } }, { fcmToken: { not: null } }],
    user: {
      isDeleted: false,
      accountStatus,
      ...(audience === "VERIFIED"
        ? { verification: { is: { isVerified: true } } }
        : {}),
    },
  };
}

/**
 * Count eligible users/devices for a broadcast without creating deliveries.
 * Promotions are counted only for explicit opt-ins.
 */
export async function previewAnnouncementAudience(
  category: string,
  audience: string,
): Promise<{ recipientCount: number; deviceCount: number; skippedCount: number }> {
  const payload = buildAnnouncementPayload({
    id: "preview",
    title: "preview",
    body: "preview",
    category,
  });
  const recipients = new Set<string>();
  let deviceCount = 0;
  let skippedCount = 0;
  let cursor: string | undefined;

  while (true) {
    const devices = await prisma.userDevice.findMany({
      where: audienceWhere(audience),
      include: {
        user: {
          select: {
            id: true,
            notificationPreferences: {
              select: { announcementsEnabled: true, promotionsEnabled: true },
            },
          },
        },
      },
      orderBy: { id: "asc" },
      take: ENQUEUE_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (devices.length === 0) break;
    cursor = devices[devices.length - 1].id;

    for (const device of devices) {
      const preference = device.user.notificationPreferences;
      if (!isEligibleForCategory(category, preference)) {
        skippedCount += 1;
        continue;
      }
      const target = providerForDevice(device, payload);
      if (!target || target.provider === "VOIP") {
        skippedCount += 1;
        continue;
      }
      recipients.add(device.userId);
      deviceCount += 1;
    }

    if (devices.length < ENQUEUE_PAGE_SIZE) break;
  }

  return { recipientCount: recipients.size, deviceCount, skippedCount };
}

/**
 * Materialize the audience into `AnnouncementDelivery` rows. Users are filtered
 * by account status/verification and, for promotions, by explicit opt-in. No
 * push token is stored here: tokens are read again at send time so a token
 * revoked between enqueue and delivery is never used.
 */
export async function enqueueAnnouncement(
  announcementId: string,
): Promise<{ recipientCount: number; deviceCount: number; skippedCount: number }> {
  const announcement = await prisma.announcement.findUnique({ where: { id: announcementId } });
  if (!announcement) throw new Error("Announcement not found");
  if (!["DRAFT", "SCHEDULED"].includes(announcement.status)) {
    throw new Error(`Announcement cannot be sent from status ${announcement.status}`);
  }

  const where = audienceWhere(announcement.audience);

  const payload = announcementPayload(announcement);
  const recipients = new Set<string>();
  let deviceCount = 0;
  let skippedCount = 0;
  let cursor: string | undefined;

  while (true) {
    const devices = await prisma.userDevice.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            notificationPreferences: {
              select: { announcementsEnabled: true, promotionsEnabled: true },
            },
          },
        },
      },
      orderBy: { id: "asc" },
      take: ENQUEUE_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (devices.length === 0) break;
    cursor = devices[devices.length - 1].id;

    const deliveries: Array<{
      announcementId: string;
      userId: string;
      deviceId: string;
      provider: string;
    }> = [];

    for (const device of devices) {
      const preference = device.user.notificationPreferences;
      if (!isEligibleForCategory(announcement.category, preference)) {
        skippedCount += 1;
        continue;
      }

      const target = providerForDevice(device, payload);
      if (!target || target.provider === "VOIP") {
        skippedCount += 1;
        continue;
      }

      deliveries.push({
        announcementId,
        userId: device.userId,
        deviceId: device.id,
        provider: target.provider,
      });
      recipients.add(device.userId);
      deviceCount += 1;
    }

    if (deliveries.length > 0) {
      await prisma.announcementDelivery.createMany({
        data: deliveries,
        skipDuplicates: true,
      });
    }

    if (devices.length < ENQUEUE_PAGE_SIZE) break;
  }

  await prisma.announcement.update({
    where: { id: announcementId },
    data: {
      status: "SENDING",
      startedAt: new Date(),
      recipientCount: recipients.size,
      deviceCount,
      skippedCount,
    },
  });

  return { recipientCount: recipients.size, deviceCount, skippedCount };
}

/** Promote scheduled broadcasts whose time has arrived into the send queue. */
export async function promoteDueAnnouncements(): Promise<number> {
  const due = await prisma.announcement.findMany({
    where: { status: "SCHEDULED", scheduledAt: { not: null, lte: new Date() } },
    orderBy: { scheduledAt: "asc" },
    take: 5,
  });

  for (const row of due) {
    try {
      await enqueueAnnouncement(row.id);
    } catch (error) {
      console.error(`[announcements] enqueue ${row.id} failed:`, error);
      await prisma.announcement.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          lastError: (error as Error)?.message ?? "Failed to enqueue audience",
        },
      });
    }
  }

  return due.length;
}

/** Reset rows abandoned mid-send by a crash so the next run can retry them. */
async function recoverStuckDeliveries(): Promise<void> {
  await prisma.announcementDelivery.updateMany({
    where: { status: "SENDING", updatedAt: { lt: new Date(Date.now() - STUCK_SENDING_MS) } },
    data: { status: "RETRY_PENDING", availableAt: new Date() },
  });
}

async function finalizeAnnouncement(announcementId: string): Promise<void> {
  const [pending, sent, failed, skipped] = await Promise.all([
    prisma.announcementDelivery.count({
      where: {
        announcementId,
        status: { in: ["PENDING", "SENDING", "RETRY_PENDING"] },
      },
    }),
    prisma.announcementDelivery.count({
      where: { announcementId, status: { in: ["SENT", "DELIVERED"] } },
    }),
    prisma.announcementDelivery.count({ where: { announcementId, status: "FAILED" } }),
    prisma.announcementDelivery.count({ where: { announcementId, status: "SKIPPED" } }),
  ]);

  if (pending > 0) {
    await prisma.announcement.updateMany({
      where: { id: announcementId, status: "SENDING" },
      data: { sentCount: sent, failedCount: failed, skippedCount: skipped },
    });
    return;
  }

  // `updateMany` rejects a concurrent cancellation instead of resurrecting it.
  await prisma.announcement.updateMany({
    where: { id: announcementId, status: "SENDING" },
    data: {
      status: "SENT",
      completedAt: new Date(),
      sentCount: sent,
      failedCount: failed,
      skippedCount: skipped,
    },
  });
}

async function sendExpoRows(
  rows: DeliveryRow[],
  devicesById: Map<string, DeviceRow>,
  payload: PushPayload,
): Promise<void> {
  const ready: Array<{ row: DeliveryRow; token: string }> = [];

  for (const row of rows) {
    const device = devicesById.get(row.deviceId);
    const token = device?.enabled ? tokenForProvider(device, "EXPO") : null;
    if (!token) {
      await updateDelivery(row.id, { status: "SKIPPED", errorCode: "TOKEN_UNAVAILABLE" });
      continue;
    }
    ready.push({ row, token });
  }

  for (let start = 0; start < ready.length; start += EXPO_CHUNK_SIZE) {
    const chunk = ready.slice(start, start + EXPO_CHUNK_SIZE);
    const messages = chunk.map((item) => buildExpoMessage(item.token, payload));

    let tickets;
    try {
      tickets = await expo.sendPushNotificationsAsync(messages);
    } catch (error) {
      const errorCode = (error as Error)?.message ?? String(error);
      const transient = isTransientProviderError(error);
      for (const item of chunk) {
        await recordFailure(item.row, errorCode, transient);
      }
      continue;
    }

    for (let index = 0; index < chunk.length; index++) {
      const item = chunk[index];
      const ticket = tickets[index];

      if (!ticket) {
        await updateDelivery(item.row.id, { status: "FAILED", errorCode: "NO_TICKET" });
        continue;
      }

      if (ticket.status === "ok") {
        await updateDelivery(item.row.id, {
          status: "SENT",
          providerMessageId: ticket.id,
          errorCode: null,
          sentAt: new Date(),
        });
        continue;
      }

      const errorCode =
        [ticket.message, ticket.details?.error && `ExpoError:${ticket.details.error}`]
          .filter(Boolean)
          .join(" | ") || "EXPO_ERROR";

      if (isInvalidTokenError(ticket)) {
        await invalidateDeviceToken(item.row.deviceId, "EXPO");
        await updateDelivery(item.row.id, { status: "FAILED", errorCode });
        continue;
      }

      await recordFailure(item.row, errorCode, isTransientProviderError(ticket));
    }
  }

}

async function sendFcmRows(
  rows: DeliveryRow[],
  devicesById: Map<string, DeviceRow>,
  payload: PushPayload,
): Promise<void> {
  const messaging = getFirebaseMessaging();
  if (!messaging) {
    for (const row of rows) {
      await updateDelivery(row.id, { status: "FAILED", errorCode: "FIREBASE_NOT_CONFIGURED" });
    }
    return;
  }

  await mapWithConcurrency(rows, FCM_CONCURRENCY, async (row) => {
    const device = devicesById.get(row.deviceId);
    const token = device?.enabled ? tokenForProvider(device, "FCM") : null;
    if (!token) {
      await updateDelivery(row.id, { status: "SKIPPED", errorCode: "TOKEN_UNAVAILABLE" });
      return;
    }

    try {
      const messageId = await messaging.send(buildFcmMessage(token, payload));
      await updateDelivery(row.id, {
        status: "SENT",
        providerMessageId: messageId,
        errorCode: null,
        sentAt: new Date(),
      });
    } catch (error) {
      const code =
        (error as { code?: string })?.code ||
        (error as { message?: string })?.message ||
        String(error);

      if (isInvalidTokenError(error)) {
        await invalidateDeviceToken(row.deviceId, "FCM");
        await updateDelivery(row.id, { status: "FAILED", errorCode: code });
        return;
      }

      await recordFailure(row, code, isTransientProviderError(error));
    }
  });
}

async function recordFailure(
  row: DeliveryRow,
  errorCode: string,
  transient: boolean,
): Promise<void> {
  const attempt = row.attemptCount + 1;
  if (transient && attempt < MAX_ATTEMPTS) {
    await updateDelivery(row.id, {
      status: "RETRY_PENDING",
      errorCode,
      availableAt: new Date(Date.now() + backoffMs(attempt)),
    });
    return;
  }

  if (transient) {
    await updateDelivery(row.id, { status: "FAILED", errorCode });
    return;
  }

  await updateDelivery(row.id, { status: "FAILED", errorCode });
}

/**
 * Deliver one page of pending announcement rows. The job runs every 10s, so the
 * page cap also caps provider throughput well below Expo's 600/s guideline.
 */
export async function dispatchAnnouncements(): Promise<{
  processed: number;
  announcements: number;
}> {
  await recoverStuckDeliveries();

  const announcement = await prisma.announcement.findFirst({
    where: { status: "SENDING" },
    orderBy: { startedAt: "asc" },
  });
  if (!announcement) return { processed: 0, announcements: 0 };

  const rows = await prisma.announcementDelivery.findMany({
    where: {
      announcementId: announcement.id,
      status: { in: ["PENDING", "RETRY_PENDING"] },
      availableAt: { lte: new Date() },
    },
    orderBy: { id: "asc" },
    take: SEND_BATCH_SIZE,
  });

  if (rows.length === 0) {
    await finalizeAnnouncement(announcement.id);
    return { processed: 0, announcements: 1 };
  }

  const deviceRows = await prisma.userDevice.findMany({
    where: { id: { in: rows.map((row) => row.deviceId) } },
    select: {
      id: true,
      enabled: true,
      platform: true,
      expoPushToken: true,
      fcmToken: true,
      voipPushToken: true,
    },
  });
  const devicesById = new Map(deviceRows.map((device) => [device.id, device]));

  await prisma.announcementDelivery.updateMany({
    where: { id: { in: rows.map((row) => row.id) }, status: { in: ["PENDING", "RETRY_PENDING"] } },
    data: { status: "SENDING", attemptCount: { increment: 1 } },
  });

  const payload = announcementPayload(announcement);
  const typedRows = rows.map((row) => ({ ...row, attemptCount: row.attemptCount + 1 }));

  const expoRows = typedRows.filter((row) => row.provider === "EXPO");
  const fcmRows = typedRows.filter((row) => row.provider === "FCM");
  const otherRows = typedRows.filter((row) => !["EXPO", "FCM"].includes(row.provider));

  if (expoRows.length > 0) {
    await sendExpoRows(expoRows, devicesById, payload);
  }
  if (fcmRows.length > 0) {
    await sendFcmRows(fcmRows, devicesById, payload);
  }
  for (const row of otherRows) {
    await updateDelivery(row.id, { status: "SKIPPED", errorCode: "PROVIDER_UNSUPPORTED" });
  }

  await finalizeAnnouncement(announcement.id);
  return { processed: rows.length, announcements: 1 };
}

/**
 * Check Expo receipts for accepted announcement tickets after the provider's
 * receipt delay. Invalid tokens are cleared so future broadcasts skip them.
 */
export async function fetchAnnouncementExpoReceipts(): Promise<void> {
  const cutoff = new Date(Date.now() - EXPO_RECEIPT_DELAY_MS);
  const rows = await prisma.announcementDelivery.findMany({
    where: {
      status: "SENT",
      provider: "EXPO",
      receiptsFetchedAt: null,
      providerMessageId: { not: null },
      sentAt: { lte: cutoff },
    },
    take: 1000,
  });

  if (rows.length === 0) return;

  const receipts = new Map<
    string,
    { status: string; message?: string; details?: { error?: string } }
  >();

  const ids = rows
    .map((row) => row.providerMessageId)
    .filter((id): id is string => Boolean(id));

  for (const chunk of expo.chunkPushNotificationReceiptIds(ids)) {
    try {
      const batch = await expo.getPushNotificationReceiptsAsync(chunk);
      for (const [id, receipt] of Object.entries(batch)) {
        receipts.set(id, receipt);
      }
    } catch (error) {
      console.error("[announcements] getPushNotificationReceiptsAsync error:", error);
    }
  }

  const now = new Date();
  for (const row of rows) {
    if (!row.providerMessageId) continue;
    const receipt = receipts.get(row.providerMessageId);
    if (!receipt) continue;

    if (receipt.status === "ok") {
      await prisma.announcementDelivery.update({
        where: { id: row.id },
        data: { status: "DELIVERED", receiptsFetchedAt: now },
      });
      continue;
    }

    const errorCode =
      [receipt.message, receipt.details?.error].filter(Boolean).join(" | ") || "EXPO_ERROR";
    if (isInvalidTokenError(receipt)) {
      await invalidateDeviceToken(row.deviceId, "EXPO");
    }
    await prisma.announcementDelivery.update({
      where: { id: row.id },
      data: { status: "FAILED", errorCode, receiptsFetchedAt: now },
    });
  }
}

/** Cancel a draft, scheduled, or in-flight broadcast and skip its leftovers. */
export async function cancelAnnouncement(announcementId: string): Promise<boolean> {
  const announcement = await prisma.announcement.findUnique({ where: { id: announcementId } });
  if (!announcement) return false;
  if (!["DRAFT", "SCHEDULED", "SENDING"].includes(announcement.status)) return false;

  await prisma.$transaction([
    prisma.announcement.update({
      where: { id: announcementId },
      data: { status: "CANCELLED", completedAt: new Date() },
    }),
    prisma.announcementDelivery.updateMany({
      where: {
        announcementId,
        status: { in: ["PENDING", "RETRY_PENDING", "SENDING"] },
      },
      data: { status: "SKIPPED", errorCode: "ANNOUNCEMENT_CANCELLED" },
    }),
  ]);

  return true;
}
