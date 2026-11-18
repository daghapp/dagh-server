import cron from "node-cron";
import { withDistributedLock } from "../helpers/jobLock.js";
import { sendDatingProximityAlerts } from "../services/dating-proximity.service.js";

/**
 * Dating proximity worker.
 *
 * Every 30 minutes it scans recently-refreshed dating locations and sends a
 * non-identifying "someone nearby" push to users who are within range of each
 * other. A per-pair 24h cooldown prevents repeated alerts.
 */
export function datingProximityJob() {
  cron.schedule(
    "*/30 * * * *",
    async () => {
      await withDistributedLock("dating-proximity", 5 * 60 * 1000, async () => {
        try {
          const sent = await sendDatingProximityAlerts();
          if (sent > 0) {
            console.log(`✓ Dating proximity alerts sent: ${sent}`);
          }
        } catch (error) {
          console.error("[dating-proximity] scan failed:", error);
        }
      });
    },
    { timezone: "UTC" },
  );

  console.log("✓ Dating proximity cron job initialized (every 30 min)");
}
