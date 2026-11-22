import pg from "pg";
import net from "node:net";

function createSocket() {
  const socket = new net.Socket();
  const protoConnect = net.Socket.prototype.connect as (
    this: net.Socket,
    options: { port: number; host: string; family: number },
  ) => net.Socket;
  (socket as unknown as { connect: (port: number, host: string) => net.Socket }).connect =
    function (port: number, host: string) {
      return protoConnect.call(this as net.Socket, { port, host, family: 4 });
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
