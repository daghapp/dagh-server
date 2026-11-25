import cron from "node-cron";
import { withDistributedLock } from "../helpers/jobLock.js";
import { runDailyBrief } from "../modules/daily-brief/daily-brief.service.js";

export function dailyBriefJob() {
  cron.schedule(
    "0 6 * * *",
    async () => {
      await withDistributedLock("daily-brief", 10 * 60 * 1000, async () => {
        try {
          const brief = await runDailyBrief();
          console.log(`✓ Daily brief generated: ${brief.id}`);
        } catch (e) {
          console.error("Daily brief job failed", e);
        }
      });
    },
    { timezone: "Africa/Accra" },
  );
  console.log("✓ Daily brief cron job initialized (daily 06:00 Africa/Accra)");
}
