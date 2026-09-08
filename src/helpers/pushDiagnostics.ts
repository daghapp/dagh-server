import type { PushPayload, PushProvider } from "./pushPayload.js";

/**
 * Structured push-delivery diagnostics.
 *
 * Emits the event trace the investigation hand-off requested so a single
 * correlation ID can be followed from event creation -> target selection ->
 * send attempt -> provider result. All payloads are sanitized: message/sender
 * text, names, and avatar URLs are redacted; tokens are logged by suffix only.
 */

interface LogContext {
  [key: string]: unknown;
}

function log(event: string, data: LogContext = {}): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...data,
    }),
  );
}

/** Last 8 characters of a push token — enough to correlate, not enough to reuse. */
export function tokenSuffix(token: string): string | null {
  const t = (token || "").trim();
  return t ? t.slice(-8) : null;
}

const REDACTED_FIELDS = new Set([
  "content",
  "preview",
  "previewBody",
  "senderName",
  "senderImageUrl",
  "senderAvatarUrl",
  "callerName",
  "callerImageUrl",
]);

/** Strip user content/identity fields while keeping routing keys (ids, type). */
export function sanitizePayload(payload: PushPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    out[key] =
      REDACTED_FIELDS.has(key) && typeof value === "string" && value ? "[redacted]" : value;
  }
  return out;
}

export interface PushEventMeta {
  eventType: string;
  eventId: string;
  callId?: string;
  messageId?: string;
  conversationId?: string;
  recipientUserId: string;
  createdAt: string;
}

export function logPushEventCreated(meta: PushEventMeta): void {
  log("push.event_created", { correlationId: meta.eventId, ...meta });
}

export function logPushTargetSelected(data: {
  correlationId: string;
  deviceId: string;
  platform?: string;
  provider?: PushProvider;
  tokenSuffix?: string | null;
  skipReason?: string;
  eventType: string;
}): void {
  log("push.target_selected", data);
}

export function logPushSendAttempt(data: {
  correlationId: string;
  deviceId: string | null;
  provider: PushProvider;
  eventType: string;
  attempt: number;
  tokenSuffix?: string | null;
  priority?: string;
  ttlMs?: number;
  payload: Record<string, unknown>;
}): void {
  log("push.send_attempt", data);
}

export function logPushProviderAccepted(data: {
  correlationId: string;
  deviceId: string | null;
  provider: PushProvider;
  providerMessageId?: string | null;
  eventType: string;
  latencyMs?: number;
}): void {
  log("push.provider_accepted", data);
}

export function logPushProviderError(data: {
  correlationId: string;
  deviceId: string | null;
  provider: PushProvider;
  eventType: string;
  errorCode: string;
  attempt: number;
  retry: boolean;
  tokenInvalidated: boolean;
}): void {
  log("push.provider_error", data);
}

export function logPushReceiptChecked(data: {
  correlationId: string;
  deviceId: string;
  provider: PushProvider;
  status: string;
  errorCode?: string;
}): void {
  log("push.receipt_checked", data);
}
