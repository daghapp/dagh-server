import session from "express-session";
import pg from "pg";
import connectPgSimple from "connect-pg-simple";

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
    pool: new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    }),
    tableName: "session",
    createTableIfMissing: true,
    pruneSessionInterval: 30 * 60, // minutes
  }),
});
