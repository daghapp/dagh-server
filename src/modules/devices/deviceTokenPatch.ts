/**
 * Resolve which push-token fields a device-registration request actually touches.
 *
 * The contract: a request may contain only *some* token fields. An omitted
 * field must never erase the token already stored for this installation, while
 * an explicit `null` clears that token (e.g. an iOS device dropping its VoIP
 * token). Using `value ?? undefined` in the upsert would hide explicit `null`
 * from Prisma and keep the stale token, so presence is decided with `in`.
 */

export const DEVICE_TOKEN_FIELDS = [
  "expoPushToken",
  "fcmToken",
  "apnsToken",
  "voipPushToken",
] as const;

export type DeviceTokenField = (typeof DEVICE_TOKEN_FIELDS)[number];

export interface DeviceTokenPatch {
  update: Partial<Record<DeviceTokenField, string | null>>;
  create: Partial<Record<DeviceTokenField, string | null>>;
}

/**
 * Build the token fields to write on update vs create.
 * - Omitted field -> excluded from the patch (preserve on update; null on create).
 * - Explicit null or empty string -> clear the token.
 * - String value -> replace the token.
 */
export function deviceTokenPatch(body: Record<string, unknown>): DeviceTokenPatch {
  const update: DeviceTokenPatch["update"] = {};
  const create: DeviceTokenPatch["create"] = {};

  for (const field of DEVICE_TOKEN_FIELDS) {
    const raw = body[field];
    if (raw === undefined) continue;
    const normalized = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
    update[field] = normalized;
    create[field] = normalized;
  }

  return { update, create };
}
