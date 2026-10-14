import cron from "node-cron";
import { prisma } from "../config/prisma.js";
import { withDistributedLock } from "../helpers/jobLock.js";
import { getSettingTab } from "../helpers/settings.js";
import { notifyAdmins } from "../helpers/notify-admins.js";
import { PaymentStatus } from "../../generated/prisma/client.js";

/**
 * Weekly admin digest (§3.11 Notifications tab: `weeklyDigest`).
 *
 * Every Monday 08:00 Africa/Accra (06:00 UTC) composes platform-health counts
 * and delivers them as in-app admin notifications (one per eligible admin via
 * notifyAdmins fan-out). No-op unless the digest is enabled in settings.
 */
export function weeklyDigestJob() {
  cron.schedule(
    "0 6 * * 1",
    async () => {
      await withDistributedLock("weekly-digest", 60_000, async () => {
        const notifications = await getSettingTab<Record<string, unknown>>("notifications");
        if (notifications.weeklyDigest !== true) return;

        const startOf24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const [pendingUsers, failedPayments24h, pendingDating, pendingNgo, activeSubs] =
          await Promise.all([
            prisma.user.count({ where: { accountStatus: "PENDING", isDeleted: false } }),
            prisma.payment.count({
              where: { status: PaymentStatus.FAILED, createdAt: { gte: startOf24h } },
            }),
            prisma.datingApplication.count({ where: { status: "PENDING" } }),
            prisma.ngoAccessRequest.count({ where: { status: "PENDING" } }),
            prisma.userSubscription.count({ where: { status: "ACTIVE" } }),
          ]);

        await notifyAdmins({
          category: "subscriptions",
          message:
            `Weekly digest: ${pendingUsers} pending approvals, ${failedPayments24h} failed payments (24h), ` +
            `${pendingDating} dating reviews queued, ${pendingNgo} NGO requests pending, ${activeSubs} active subscriptions.`,
          actionUrl: "/admin/dashboard",
          meta: { pendingUsers, failedPayments24h, pendingDating, pendingNgo, activeSubs },
        });
      });
    },
    { timezone: "UTC" },
  );
}
