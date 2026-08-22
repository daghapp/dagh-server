import { getRedisClient } from "../config/redis.js";

/**
 * Run a job body under a distributed mutex so scheduled jobs execute on only
 * one instance when Redis is available. Without Redis it degrades to running
 * the body directly (single-instance mode).
 *
 * Returns the job result, or null when the lock could not be acquired because
 * another instance is already running the job.
 */
export async function withDistributedLock<T>(
  lockKey: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const redis = getRedisClient();
  if (!redis) return fn();

  const lockKeyFull = `joblock:${lockKey}`;
  const acquired = await redis.set(lockKeyFull, "1", { NX: true, PX: ttlMs });

  if (!acquired) {
    console.log(`[joblock] ${lockKey} skipped — already running on another instance`);
    return null;
  }

  try {
    return await fn();
  } finally {
    await redis.del(lockKeyFull).catch(() => {});
  }
}

/**
 * Claim a single work item (e.g. one pending payment) so concurrent runs /
 * restarts can't process it twice. Returns true only for the first claimant.
 */
export async function tryAcquireWorkItem(itemKey: string, ttlMs: number): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return true;

  const acquired = await redis.set(`work:${itemKey}`, "1", { NX: true, PX: ttlMs });
  return acquired === "OK";
}
