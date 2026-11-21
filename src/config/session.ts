import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { createPgPool } from "./pg-pool.js";

if (!process.env.SESSIONSECRET && process.env.NODE_ENV !== "test") {
  throw new Error("Missing SESSIONSECRET environment variable. Please set it in your environment.");
}

const PgSession = connectPgSimple(session);

// Persistent session store (Postgres) instead of the default in-memory
// MemoryStore so OAuth/passport sessions survive restarts and are shared
// across instances. The table is created automatically on first boot.
export const sessionConfig = session({
  secret: process.env.SESSIONSECRET!,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 24 * 60 * 60 * 1000,
  },
  store: new PgSession({
    pool: createPgPool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
    }),
    tableName: "session",
    createTableIfMissing: true,
    pruneSessionInterval: 30 * 60, // minutes
  }),
});
