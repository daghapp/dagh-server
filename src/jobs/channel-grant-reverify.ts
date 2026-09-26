import cron from "node-cron";
import { withDistributedLock, tryAcquireWorkItem } from "../helpers/jobLock.js";
import { reverifyChannelGrants } from "../services/community.service.js";

const JOB_LOCK_TTL_MS = 15 * 60 * 1000;
const ITEM_CLAIM_TTL_MS = 10 * 60 * 1000;

/**
 * Re-confirms YouTube channel grants and revokes the ones whose subscription was
 * cancelled.
 *
 * A grant is written from a positive verdict, but the underlying subscription is
 * mutable from outside our system, so a grant written once is not authoritative
 * forever. Without this sweep, unsubscribing on YouTube leaves the feed open
 * indefinitely. This job is the only place revocation happens.
 *
 * Runs daily under a distributed lock so only one instance sweeps at a time, and
 * claims each grant in Redis before checking it so a run that overruns the lock
 * TTL (or a second instance catching up) cannot check the same grant twice and
 * spend the quota twice.
 *
 * The sweep fails open by design: a grant whose verdict could not be obtained is
 * left intact and retried on the next pass, so a YouTube outage or a spent
 * refresh token never locks out a paying subscriber.
 */
export const channelGrantReverifyJob = () => {
  console.log("✓ Channel grant re-verification cron job initialized (daily)");
  cron.schedule("17 3 * * *", async () => {
    await withDistributedLock("channel-grant-reverify", JOB_LOCK_TTL_MS, async () => {
      try {
        const summary = await reverifyChannelGrants({
          shouldProcess: (grantId) =>
            tryAcquireWorkItem(`channel-grant:${grantId}`, ITEM_CLAIM_TTL_MS),
        });

        if (summary.revoked > 0) {
          console.log(
            `[Channel Reverify] Revoked ${summary.revoked} grant(s) — subscription cancelled`,
          );
        }
        if (summary.superseded > 0) {
          console.log(
            `[Channel Reverify] Skipped ${summary.superseded} negative verdict(s) on grants ` +
              `re-confirmed during this pass; the next pass re-decides them`,
          );
        }
        if (summary.stillSubscribed > 0) {
          console.log(`[Channel Reverify] Re-confirmed ${summary.stillSubscribed} grant(s)`);
        }
        if (summary.unverifiable > 0) {
          console.log(
            `[Channel Reverify] ${summary.unverifiable} active grant(s) hold no refresh token and ` +
              `are not re-verified; they become re-verifiable if the user re-runs the OAuth flow`,
          );
        }
        if (summary.failed > 0) {
          console.warn(
            `[Channel Reverify] ${summary.failed} grant(s) could not be checked and keep access`,
          );
        }
        if (summary.checked === 0) {
          console.log("[Channel Reverify] No grants due for re-verification");
        }
      } catch (error) {
        console.error("[Channel Reverify] Failed to re-verify channel grants:", error);
      }
    });
  });
};
