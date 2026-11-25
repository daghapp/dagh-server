import cron from "node-cron";
import { prisma } from "../config/prisma.js";
import { withDistributedLock } from "../helpers/jobLock.js";

export function dataRetentionJob() {
  cron.schedule(
    "0 3 * * *",
    async () => {
      await withDistributedLock("data-retention", 10 * 60 * 1000, async () => {
        try {
          const now = new Date();
          const expired = await prisma.identityVerification.findMany({
            where: { retentionUntil: { lt: now } },
          });
          for (const row of expired) {
            await prisma.identityVerification.update({
              where: { id: row.id },
              data: {
                idFrontUrl: null,
                idBackUrl: null,
                selfieUrl: null,
                idNumberHash: null,
                livenessScore: null,
                faceMatchScore: null,
              },
            });
          }
          console.log(`✓ Data retention purge: ${expired.length} identity records anonymized`);
        } catch (e) {
          console.error("Data retention job failed", e);
        }
      });
    },
    { timezone: "Africa/Accra" },
  );
  console.log("✓ Data retention cron job initialized (daily 03:00 Africa/Accra)");
}
