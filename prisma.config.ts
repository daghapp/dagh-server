import "dotenv/config";
import { defineConfig } from "prisma/config";

const DATABASE_URL = process.env.DATABASE_URL;
const DIRECT_URL = process.env.DIRECT_URL;

function migrationUrl(): string {
  if (process.env.DIRECT_URL) return process.env.DIRECT_URL;
  if (DATABASE_URL) return DATABASE_URL.replace("-pooler", "");
  return "postgresql://prisma:prisma@localhost:5432/dagh";
}

// Shadow database for non-interactive migration checks and migrate diff.
// Never used by the application; dropped/recreated by Prisma on demand.
function shadowDatabaseUrl(): string {
  if (process.env.SHADOW_DATABASE_URL) return process.env.SHADOW_DATABASE_URL;
  return postgresqlUrlFor("dagh_server_shadow");
}

// Builds a sibling database URL (same host/credentials, different database name).
function postgresqlUrlFor(dbName: string): string {
  const base = process.env.DIRECT_URL || DATABASE_URL;
  if (!base) return `postgresql://prisma:prisma@localhost:5432/${dbName}`;
  const url = new URL(base);
  url.pathname = `/${dbName}`;
  url.searchParams.delete("schema");
  url.searchParams.delete("connect_timeout");
  return url.toString();
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: migrationUrl(),
    shadowDatabaseUrl: shadowDatabaseUrl(),
  },
});
