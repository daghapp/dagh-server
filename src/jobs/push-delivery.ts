import cron from "node-cron";
import { withDistributedLock } from "../helpers/jobLock.js";
import {
  sendPendingPushDeliveries,
  fetchExpoPushReceipts,
  sendPendingMessagePushDeliveries,
  fetchMessageExpoPushReceipts,
  dispatchNotificationOutbox,
} from "../helpers/pushNotifications.js";

/**
 * Durable push delivery worker.
 *
 * Runs every 10 seconds under a distributed lock. Responsibilities:
 *   1. Deliver PENDING call push outbox rows (with bounded exponential backoff).
 *   2. Fetch Expo push receipts for SENT EXPO call rows and invalidate stale tokens.
 *   3. Deliver PENDING message push outbox rows.
 *   4. Fetch Expo push receipts for SENT EXPO message rows.
 *
 * The outbox rows are written synchronously when a call/message is created or
 * changes state, so a backend restart between commit and delivery never loses
 * the notification — this worker picks it back up.
 */
export const pushDeliveryJob = () => {
  cron.schedule("*/10 * * * * *", async () => {
    await withDistributedLock("push-delivery", 8000, async () => {
      await sendPendingPushDeliveries();
      await dispatchNotificationOutbox();
      await sendPendingMessagePushDeliveries();
      await fetchExpoPushReceipts();
      await fetchMessageExpoPushReceipts();
    });
  });

  console.log("Push delivery worker initialized (every 10s)");
};
