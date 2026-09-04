interface LogContext {
  [key: string]: unknown;
}

function log(event: string, data: LogContext = {}) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...data,
    }),
  );
}

export function logCallInitiated(data: {
  callId: string;
  callerId: string;
  receiverId: string;
  callType: string;
  idempotencyKey?: string;
}) {
  log("call.initiated", data);
}

export function logCallTransition(data: {
  callId: string;
  priorState: string;
  newState: string;
  actorId: string;
  requestId?: string;
  durationMs?: number;
}) {
  log("call.transition", data);
}

export function logCallPushSent(data: {
  callId: string;
  deviceCount?: number;
  deviceId?: string;
  provider?: string;
  providerMessageId?: string | null;
}) {
  log("call.push_sent", data);
}

export function logCallPushFailed(data: {
  callId: string;
  deviceId: string;
  provider?: string;
  errorCode: string;
  tokenInvalidated: boolean;
}) {
  log("call.push_failed", data);
}

export function logCallPushEnqueued(data: { callId: string; userId: string; deviceCount: number }) {
  log("call.push_enqueued", data);
}

export function logCallPushReceipt(data: {
  callId: string;
  deviceId: string;
  provider: string;
  status: string;
  errorCode?: string;
}) {
  log("call.push_receipt", data);
}

export function logCallSocketDelivered(data: {
  callId: string;
  event: string;
  recipientOnline: boolean;
}) {
  log("call.socket_delivered", data);
}

export function logCallTokenGenerated(data: {
  callId: string;
  userId: string;
  role: "caller" | "receiver";
  ttlSec: number;
}) {
  log("call.token_generated", data);
}

export function logCallExpired(data: { callId: string; ringDurationMs: number }) {
  log("call.expired", data);
}

export function logCallAnswerTime(data: { callId: string; ringDurationMs: number }) {
  log("call.answer_time", data);
}

export function logCallDuration(data: {
  callId: string;
  durationSec: number;
  endedBy: string;
  endReason: string;
}) {
  log("call.total_duration", data);
}

// ---------------------------------------------------------------------------
// Message push notification events
// ---------------------------------------------------------------------------

export function logMessagePushEnqueued(data: {
  messageId: string;
  userId: string;
  deviceCount: number;
  conversationId?: string;
}) {
  log("message.push_enqueued", data);
}

export function logMessagePushSent(data: {
  messageId: string;
  deviceId?: string;
  provider?: string;
  providerMessageId?: string | null;
  conversationId?: string;
  attempt?: number;
}) {
  log("message.push_sent", data);
}

export function logMessagePushFailed(data: {
  messageId: string;
  deviceId: string;
  provider?: string;
  errorCode: string;
  tokenInvalidated: boolean;
  conversationId?: string;
  attempt?: number;
}) {
  log("message.push_failed", data);
}

export function logMessagePushReceipt(data: {
  messageId: string;
  deviceId: string;
  provider: string;
  status: string;
  errorCode?: string;
  conversationId?: string;
}) {
  log("message.push_receipt", data);
}
