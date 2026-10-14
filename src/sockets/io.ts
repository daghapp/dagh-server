import type { Server } from "socket.io";

/** Process-wide Socket.IO handle so HTTP controllers can emit admin events. */
let io: Server | null = null;

export function setSocketIO(instance: Server): void {
  io = instance;
}

/** Historic alias for setSocketIO. */
export function setIo(instance: Server): void {
  io = instance;
}

export function getSocketIO(): Server | null {
  return io;
}

/** Legacy aliases used by community event emitters. */
export function getIo(): Server | null {
  return io;
}

/** Per-user room name (`user:{id}`), mirroring socketHandlers join. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}
