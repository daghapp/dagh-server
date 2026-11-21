import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";
import { createPgPool } from "./pg-pool.js";

const connectionString = process.env.DATABASE_URL!;

const pool = createPgPool({ connectionString });

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
