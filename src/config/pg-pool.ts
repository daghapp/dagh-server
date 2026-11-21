import pg from "pg";
import net from "node:net";

function createSocket() {
  const socket = new net.Socket();
  (socket as any).connect = function (port: number, host: string) {
    return (net.Socket.prototype.connect as any).call(this, { port, host, family: 4 });
  };
  return socket;
}

export function createPgPool(config: pg.PoolConfig = {}): pg.Pool {
  return new pg.Pool({
    stream: createSocket,
    max: Number(process.env.DATABASE_POOL_MAX) || 10,
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS) || 5000,
    idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS) || 30000,
    query_timeout: Number(process.env.DATABASE_QUERY_TIMEOUT_MS) || 10000,
    statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS) || 10000,
    ...config,
  } as pg.PoolConfig);
}
