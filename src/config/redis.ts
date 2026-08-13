import "dotenv/config";
import { createClient, type RedisClientType } from "redis";

const REDIS_URL = process.env.REDIS_URL || "";

let mainClient: RedisClientType | null = null;
let pubClient: RedisClientType | null = null;
let subClient: RedisClientType | null = null;

const clients: RedisClientType[] = [];

function makeClient(name: string): RedisClientType {
  const client = createClient({ url: REDIS_URL });
  client.on("error", (err) => {
    console.error(`[redis:${name}] error:`, err.message);
  });
  clients.push(client);
  return client;
}

/**
 * Connect the Redis clients. Call once during server startup before wiring the
 * Socket.IO adapter / session store / rate limiters.
 *
 * Returns false (without throwing) when REDIS_URL is unset so the app still
 * runs in single-instance mode — with in-memory presence, the default
 * MemoryStore rate limiters, and unlocked cron jobs.
 */
export async function connectRedis(): Promise<boolean> {
  if (!REDIS_URL) {
    console.warn("[redis] REDIS_URL not set — running without Redis (single-instance mode).");
    return false;
  }

  try {
    mainClient = makeClient("main");
    pubClient = makeClient("pub");
    subClient = makeClient("sub");

    await Promise.all([mainClient.connect(), pubClient.connect(), subClient.connect()]);

    // Redis 6.0+ requires at least one client to be in subscribe mode for the
    // Socket.IO adapter's pub/sub channels; the subClient is used for that.
    await subClient.subscribe("__dagh_keepalive__", () => {});

    console.log("[redis] connected.");
    return true;
  } catch (error) {
    console.error("[redis] failed to connect:", error);
    for (const c of clients) {
      c.disconnect().catch(() => {});
    }
    mainClient = null;
    pubClient = null;
    subClient = null;
    return false;
  }
}

export function redisEnabled(): boolean {
  return Boolean(REDIS_URL) && mainClient !== null;
}

export function getRedisClient(): RedisClientType | null {
  return mainClient;
}

export function getRedisPubClient(): RedisClientType | null {
  return pubClient;
}

export function getRedisSubClient(): RedisClientType | null {
  return subClient;
}

export async function disconnectRedis(): Promise<void> {
  await Promise.all(clients.map((c) => c.disconnect().catch(() => {})));
  clients.length = 0;
  mainClient = null;
  pubClient = null;
  subClient = null;
}
