import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";
import pg from "pg";
import net from "node:net";

const connectionString = process.env.DATABASE_URL!;

// Force IPv4 at the socket level. `family: 4` on the pool config is silently
// ignored by pg (it never reaches net.connect), so Node's Happy Eyeballs still
// tries the (blackholed) IPv6 addresses and can hang past the connect timeout.
// Overriding the stream's connect method is the only reliable way to pin IPv4.
function createSocket() {
  const socket = new net.Socket();
  (socket as any).connect = function (port: number, host: string) {
    return (net.Socket.prototype.connect as any).call(this, { port, host, family: 4 });
  };
  return socket;
}

const pool = new pg.Pool({
  connectionString,
  stream: createSocket,
  // Bound the pg pool so a slow/paused database fails fast instead of hanging
  // the request queue (previously defaulted to 10 connections, no timeouts).
  max: Number(process.env.DATABASE_POOL_MAX) || 10,
  connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS) || 5000,
  idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS) || 30000,
  query_timeout: Number(process.env.DATABASE_QUERY_TIMEOUT_MS) || 10000,
  statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS) || 10000,
} as pg.PoolConfig);

const adapter = new PrismaPg(pool);

const basePrisma = new PrismaClient({ adapter });

const RETRYABLE_CODES = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "P1001"]);

// Only reads are retried — retrying writes could double-commit.
const READ_OPERATIONS = new Set([
  "findMany",
  "findFirst",
  "findUnique",
  "count",
  "aggregate",
  "groupBy",
]);

const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ operation, args, query }) {
        const maxRetries = 2;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            return await query(args);
          } catch (error) {
            const code = (error as { code?: string })?.code;
            const isTransient = code !== undefined && RETRYABLE_CODES.has(code);
            const isRead = READ_OPERATIONS.has(operation);

            if (!isTransient || !isRead || attempt === maxRetries) throw error;

            await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
          }
        }
        throw new Error("unreachable");
      },
    },
  },
});

export { prisma };
