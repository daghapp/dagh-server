import rateLimit, { type Options } from "express-rate-limit";
import { getRedisClient, redisEnabled } from "../config/redis.js";

/**
 * Redis-backed store for express-rate-limit so counters are shared across
 * instances instead of being per-process (per-instance limits multiply by the
 * number of replicas).
 *
 * Uses INCR + PTTL atomically. When REDIS_URL is unset the default MemoryStore
 * is used instead.
 */
export class RedisRateLimitStore {
  localKeys = false;

  readonly prefix: string;
  windowMs: number;

  constructor(prefix: string, windowMs: number) {
    this.prefix = prefix;
    this.windowMs = windowMs;
  }

  private key(key: string): string {
    return `rl:${this.prefix}:${key}`;
  }

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date | undefined }> {
    const redis = getRedisClient();
    const fullKey = this.key(key);
    if (!redis) {
      return { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs) };
    }

    const result = await redis.multi().incr(fullKey).pTTL(fullKey).exec();
    const totalHits = Number(result?.[0] ?? 1);
    let ttlMs = Number(result?.[1] ?? -2);

    if (ttlMs < 0) {
      await redis.pExpire(fullKey, this.windowMs);
      ttlMs = this.windowMs;
    }

    return { totalHits, resetTime: new Date(Date.now() + ttlMs) };
  }

  async decrement(key: string): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;
    await redis.decr(this.key(key));
  }

  async resetKey(key: string): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;
    await redis.del(this.key(key));
  }

  async resetAll(): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;
    for await (const key of redis.scanIterator({ MATCH: `rl:${this.prefix}:*`, COUNT: 500 })) {
      await redis.del(key);
    }
  }

  shutdown(): void {
    // Redis clients are shared process-wide and closed via disconnectRedis().
  }
}

/**
 * Create a rate limiter backed by Redis when available, falling back to the
 * in-memory store otherwise.
 */
export function createRateLimiter(prefix: string, windowMs: number, options: Partial<Options>) {
  const store = redisEnabled() ? new RedisRateLimitStore(prefix, windowMs) : undefined;
  return rateLimit({
    ...options,
    ...(store ? { store } : {}),
  });
}
