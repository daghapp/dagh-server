import cron from "node-cron";
import { withDistributedLock, tryAcquireWorkItem } from "../helpers/jobLock.js";
import { reverifyChannelGrants, getReverifyBudgetMs } from "../services/community.service.js";

// The lock must outlive the sweep or expire first, which is what let two replicas
// run the same pass concurrently and spend the quota twice. Sizing: the pass's own
// budget (from the same getter the sweep uses, so the two cannot disagree) plus
// headroom for the summary queries and logging.
const LOCK_HEADROOM_MS = 5 * 60 * 1000;

/**
 * Re-decides YouTube channel access whose lease has run out, and revokes the ones
 * whose subscription was cancelled.
 *
 * A lease is written from a positive verdict, but the underlying subscription is
 * mutable from outside our system and YouTube publishes no unsubscribe event, so
 * a positive answer is only authoritative until it expires. Without this sweep,
 * unsubscribing on YouTube leaves the feed open until every reader's own lease
 * happens to lapse. This is the automatic revocation path; the only other writer
 * of `revokedAt` is an admin's manual revoke, which does not consult YouTube.
 *
 * Runs daily under a distributed lock so only one instance sweeps at a time, and
 * claims each row in Redis before checking it so a second instance catching up
 * cannot check the same row twice and spend the quota twice.
 *
 * A pass drains the due queue in batches until it is empty or the wall-clock
 * budget (COMMUNITY_REVERIFY_BUDGET_MS, default 10 minutes) runs out, so
 * throughput tracks the subscriber base. It is budget-bounded rather than
 * count-bounded because a fixed count cannot promise to finish inside the lock
 * TTL: 200 sequential checks at a 10s per-request timeout can take over an hour.
 *
 * The sweep does NOT fail open, and the difference matters now that a lease
 * exists. A row it cannot check keeps the expired accessExpiresAt it already had,
 * which means the next read re-checks and clients polling status see CHECK_FAILED.
 * A subscriber is never locked out by a Google outage — they lose the *lease*, and
 * the next successful pass hands it straight back. The previous implementation
 * left grants intact on a failed check, which without a lease was the only
 * defensible choice but converted an outage into indefinite access.
 */
export const channelGrantReverifyJob = () => {
  const budgetMs = getReverifyBudgetMs();
  const jobLockTtlMs = budgetMs + LOCK_HEADROOM_MS;

  console.log(
    `✓ Channel access re-verification cron job initialized (daily, ` +
      `${Math.round(budgetMs / 60000)}m budget per pass)`,
  );

  cron.schedule("17 3 * * *", async () => {
    // Outside the lock callback: withDistributedLock acquires before the inner try
    // runs, so a Redis failure here would escape as an unhandled rejection with
    // nothing logging it.
    try {
      await withDistributedLock("channel-access-reverify", jobLockTtlMs, async () => {
        try {
          const summary = await reverifyChannelGrants({
            budgetMs,
            // Keyed on the access record rather than a row id: the sweep's unit of
            // work is "this user's access to this channel", and there is exactly
            // one of those per pair.
            shouldProcess: (row) =>
              tryAcquireWorkItem(
                `channel-access:${row.userId}:${row.channelId}`,
                budgetMs + LOCK_HEADROOM_MS,
              ),
          });

          if (summary.revoked > 0) {
            console.log(
              `[Channel Reverify] Revoked ${summary.revoked} access record(s) — subscription ` +
                `cancelled on YouTube`,
            );
          }
          if (summary.stillSubscribed > 0) {
            console.log(
              `[Channel Reverify] Re-confirmed ${summary.stillSubscribed} record(s) and renewed ` +
                `their lease`,
            );
          }
          if (summary.unverifiable > 0) {
            console.log(
              `[Channel Reverify] ${summary.unverifiable} record(s) hold no usable Google ` +
                `credential and cannot be re-checked; they stay closed until the user re-runs ` +
                `the OAuth flow`,
            );
          }
          if (summary.failed > 0) {
            // Says "lease not renewed", not "access kept". Those were the same
            // thing when grants had no expiry and are now different things, and a
            // log line claiming otherwise would hide a real behaviour change from
            // whoever is on call during a Google incident.
            console.warn(
              `[Channel Reverify] ${summary.failed} record(s) could not be checked; their lease ` +
                `was not renewed, so reads will re-check and report CHECK_FAILED`,
            );
          }
          if (summary.budgetExhausted) {
            // Not an error, but it is the signal that matters once the subscriber
            // base outgrows a pass: revocation latency is growing past the
            // configured interval and the answer is a bigger budget, not a retry.
            console.warn(
              `[Channel Reverify] Ran out of budget after ${summary.checked} record(s); rows are ` +
                `still due, so revocation latency now exceeds one pass. Raise ` +
                `COMMUNITY_REVERIFY_BUDGET_MS.`,
            );
          } else if (summary.checked === 0) {
            console.log("[Channel Reverify] No access records due for re-verification");
          }
        } catch (error) {
          console.error("[Channel Reverify] Failed to re-verify channel access:", error);
        }
      });
    } catch (error) {
      console.error("[Channel Reverify] Could not acquire the job lock:", error);
    }
  });
};
