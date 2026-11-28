import cron from "node-cron";
import { withDistributedLock } from "../helpers/jobLock.js";
import { screenPendingPosts } from "../modules/content-moderation/content-moderation.service.js";

const JOB_LOCK_TTL_MS = 5 * 60 * 1000;

export function contentModerationJob() {
  cron.schedule(
    "*/2 * * * *",
    async () => {
      await withDistributedLock("content-moderation", JOB_LOCK_TTL_MS, async () => {
        try {
          const processed = await screenPendingPosts();
          if (processed > 0) {
            console.log(`✓ Content moderation: ${processed} pending post(s) screened`);
          }
        } catch (error) {
          console.error("Content moderation job failed", error);
        }
      });
    },
    { timezone: "Africa/Accra" },
  );
  console.log("✓ Content moderation cron job initialized (every 2 minutes)");
}
