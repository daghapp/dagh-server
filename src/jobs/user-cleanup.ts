import cron from "node-cron";
import { prisma } from "../config/prisma.js";

/**
 * Cron job to delete users who never verified their email.
 * Runs every hour. Only deletes PENDING_VERIFICATION users older than 24 hours.
 */
export const deleteInactiveUsersJob = () => {
  cron.schedule("0 * * * *", async () => {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const result = await prisma.user.deleteMany({
        where: {
          accountStatus: "PENDING_VERIFICATION",
          createdAt: {
            lte: twentyFourHoursAgo,
          },
        },
      });

      if (result.count > 0) {
        console.log(`[${new Date().toISOString()}] Deleted ${result.count} unverified user(s)`);
      }
    } catch (error) {
      console.error("[Cron Job Error] Failed to delete inactive users:", error);
    }
  });

  console.log("✓ Unverified users cleanup cron job initialized (hourly, 24h threshold)");
};
