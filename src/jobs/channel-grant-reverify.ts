import cron from "node-cron";
import { withDistributedLock, tryAcquireWorkItem } from "../helpers/jobLock.js";
import {
  reverifyChannelGrants,
  getReverifyBudgetMs,
} from "../services/community.service.js";

// The lock must outlive the sweep or expire first, which is what let two replicas
// run the same pass concurrently and spend the quota twice. Tied to the pass's
// own budget with headroom for the summary queries and logging.
const ITEM_CLAIM_TTL_MS = 10 * 60 * 1000;

/**
 * Re-confirms YouTube channel grants and revokes the ones whose subscription was
 * cancelled.
 *
 * A grant is written from a positive verdict, but the underlying subscription is
 * mutable from outside our system, so a grant written once is not authoritative
 * forever. Without this sweep, unsubscribing on YouTube leaves the feed open
 * indefinitely. This is the automatic revocation path; the only other writer of
 * `revokedAt` is an admin's manual revoke, which does not consult YouTube.
 *
 * Runs daily under a distributed lock so only one instance sweeps at a time, and
 * claims each grant in Redis before checking it so a second instance catching up
 * cannot check the same grant twice and spend the quota twice.
 *
 * A pass drains the due queue in batches of 200 until it is empty or the
 * wall-clock budget (YOUTUBE_REVERIFY_BUDGET_MS, default 10 minutes) runs out,
 * so throughput tracks the subscriber base. It is budget-bounded rather than
 * count-bounded because a fixed count cannot promise to finish inside the lock
 * TTL: 200 sequential checks at a 10s per-request timeout can take over an hour.
 *
 * The sweep fails open by design: a grant whose verdict could not be obtained is
 * left intact and retried on the next pass, so a YouTube outage or a spent
 * refresh token never locks out a paying subscriber.
 */
export const channelGrantReverifyJob = () => {
  const budgetMs = getReverifyBudgetMs();
  const jobLockTtlMs = budgetMs + 5 * 60 * 1000;

  console.log(
    `✓ Channel grant re-verification cron job initialized (daily, ` +
      `${Math.round(budgetMs / 60000)}m budget per pass)`,
  );

  cron.schedule("17 3 * * *", async () => {
    // Outside the lock callback: withDistributedLock acquires before the inner try
    // runs, so a Redis failure here would escape as an unhandled rejection with
    // nothing logging it.
    try {
      await withDistributedLock("channel-grant-reverify", jobLockTtlMs, async () => {
        try {
          const summary = await reverifyChannelGrants({
            budgetMs,
            shouldProcess: (grantId) =>
              tryAcquireWorkItem(`channel-grant:${grantId}`, ITEM_CLAIM_TTL_MS),
          });

          // Distinguished from "no grants due": a sweep that cannot run at all is
          // a silent outage otherwise, and reads identically to an empty queue.
          if (!summary.configured) {
            console.error(
              "[Channel Reverify] SKIPPED — YouTube OAuth is not configured, so no grant can " +
                "be re-verified or revoked. Set YOUTUBE_OAUTH_CLIENT_ID / _CLIENT_SECRET.",
            );
            return;
          }

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
              `[Channel Reverify] ${summary.unverifiable} active grant(s) hold no usable refresh ` +
                `token and are not re-verified; they become re-verifiable if the user re-runs the ` +
                `OAuth flow`,
            );
          }
          if (summary.undecryptable > 0) {
            console.error(
              `[Channel Reverify] ${summary.undecryptable} grant(s) hold a token that cannot be ` +
                `decrypted — the encryption key has probably been rotated. Access is intact but ` +
                `these can no longer be revoked.`,
            );
          }
          if (summary.failed > 0) {
            console.warn(
              `[Channel Reverify] ${summary.failed} grant(s) could not be checked and keep access`,
            );
          }
          if (summary.budgetExhausted) {
            // Not an error, but it is the signal that matters once the subscriber
            // base outgrows a pass: revocation latency is growing past the
            // configured interval and the answer is a bigger budget, not a retry.
            console.warn(
              `[Channel Reverify] Ran out of budget after ${summary.checked} grant(s); grants are ` +
                `still due. Revocation latency is now longer than ` +
                `YOUTUBE_CHANNEL_REVERIFY_INTERVAL_MS — raise YOUTUBE_REVERIFY_BUDGET_MS.`,
            );
          } else if (summary.checked === 0) {
            console.log("[Channel Reverify] No grants due for re-verification");
          }
        } catch (error) {
          console.error("[Channel Reverify] Failed to re-verify channel grants:", error);
        }
      });
    } catch (error) {
      console.error("[Channel Reverify] Could not acquire the job lock:", error);
    }
  });
};
