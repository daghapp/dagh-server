import type { Server } from "socket.io";

export function adminRoom(adminId: string): string {
  return `admin:${adminId}`;
}

export function emitAdminNotification(io: Server, adminId: string, payload: unknown): void {
  try {
    io.to(adminRoom(adminId)).emit("admin:notification", payload);
  } catch (error) {
    console.error("[Socket] Failed to emit admin notification:", error);
  }
}
