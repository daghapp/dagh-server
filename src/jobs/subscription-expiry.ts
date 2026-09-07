import cron from "node-cron";
import { withDistributedLock } from "../helpers/jobLock.js";
import { expireExpiredSubscriptions, renewSubscriptions } from "../services/membership.service.js";

const JOB_LOCK_TTL_MS = 15 * 60 * 1000;

/**
 * Durable cron job that manages subscription lifecycle:
 *  - Renews ACTIVE autoRenew subscriptions whose endDate has passed (grace extension).
 *  - Expires remaining ACTIVE subscriptions whose endDate has passed.
 * Runs every 10 minutes under a distributed lock so only one instance processes
 * the batch when scaled horizontally. Idempotent — only ACTIVE rows are touched.
 */
export const subscriptionExpiryJob = () => {
  console.log("✓ Subscription lifecycle cron job initialized (every 10 min)");
  cron.schedule("*/10 * * * *", async () => {
    await withDistributedLock("subscription-expiry", JOB_LOCK_TTL_MS, async () => {
      try {
        const renewed = await renewSubscriptions();
        if (renewed > 0) {
          console.log(`[Subscription Lifecycle] Renewed ${renewed} autoRenew subscription(s)`);
        }

        const count = await expireExpiredSubscriptions();
        if (count > 0) {
          console.log(`[Subscription Lifecycle] Expired ${count} subscription(s)`);
        }
      } catch (error) {
        console.error("[Subscription Lifecycle] Failed to process subscriptions:", error);
      }
    });
  });
};
