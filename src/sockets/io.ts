// ─────────────────────────────────────────
// Shared Socket.IO instance
// ─────────────────────────────────────────
// Four modules each kept their own module-local copy of the Socket.IO server and
// their own `setIoInstance` pair, wired at boot from server.ts. That works, but
// it means a fifth emitter has to be added to server.ts, and a module cannot
// reach another's server — so a service-layer publisher (as opposed to a
// controller) has nothing to emit through.
//
// This is the one copy. Existing per-module accessors are left alone: they read
// this same instance, so the behaviour is unchanged, and collapsing them is a
// refactor with no bearing on whether access revocation reaches clients.

import { Server } from "socket.io";

let io: Server | undefined;

export function setIo(ioInstance: Server): void {
  io = ioInstance;
}

/** The Socket.IO server, or undefined before boot wiring has run. */
export function getIo(): Server | undefined {
  return io;
}

/** The room every connected socket of one app user joins. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}
