import cron from "node-cron";
import { withDistributedLock } from "../helpers/jobLock.js";
import { sendPendingPushDeliveries, fetchExpoPushReceipts } from "../helpers/pushNotifications.js";

/**
 * Durable push delivery worker.
 *
 * Runs every 10 seconds under a distributed lock. Two responsibilities:
 *   1. Deliver PENDING outbox rows (with bounded exponential backoff).
 *   2. Fetch Expo push receipts for SENT EXPO rows and invalidate stale tokens.
 *
 * The outbox rows are written synchronously when a call is created or changes
 * state, so a backend restart between commit and delivery never loses the
 * notification — this worker picks it back up.
 */
export const pushDeliveryJob = () => {
  cron.schedule("*/10 * * * * *", async () => {
    await withDistributedLock("push-delivery", 8000, async () => {
      await sendPendingPushDeliveries();
      await fetchExpoPushReceipts();
    });
  });

  console.log("Push delivery worker initialized (every 10s)");
};
