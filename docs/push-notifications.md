# Push Notifications

This document describes how push notifications are delivered in the dagh-server backend.

## Table of Contents

1. [Providers](#providers)
2. [Notification Types](#notification-types)
3. [Trigger Points](#trigger-points)
4. [Delivery Flow](#delivery-flow)
5. [Durable Outbox Pattern](#durable-outbox-pattern)
6. [Cron Worker](#cron-worker)
7. [Device Registration](#device-registration)
8. [Notification Preferences](#notification-preferences)
9. [Configuration](#configuration)
10. [Key Files](#key-files)

---

## Providers

The server supports two push providers, selected per-device:

| Provider | Library | When Used |
|----------|---------|-----------|
| **Firebase Cloud Messaging (FCM)** | `firebase-admin` | Android devices with an `fcmToken` |
| **Expo Push Notifications** | `expo-server-sdk` | All iOS devices; Android devices without an `fcmToken` |

Selection logic (`src/helpers/pushPayload.ts:119-129`):
- **Android** + `fcmToken` → FCM
- **Android** without `fcmToken` → Expo
- **iOS** → Expo (wraps APNs)

FCM is optional. If Firebase env vars are missing, the server logs a warning and all devices fall back to Expo.

---

## Notification Types

| Type | When Sent | Payload Key |
|------|-----------|-------------|
| **Incoming Call** | Call initiated to receiver | `INCOMING_CALL` |
| **Call State Changed** | Terminal call events (DECLINED, CANCELLED, MISSED, ENDED, FAILED) | `CALL_STATE_CHANGED` |
| **New Message** | New chat message or voice note | `NEW_MESSAGE` |

Call notifications on FCM are **data-only** (wakes the app for custom call-screen handling). On Expo they include a visible notification block.

Message notifications include a visible `notification` block on both providers.

---

## Trigger Points

| API Endpoint | Notification Sent |
|--------------|-------------------|
| `POST /calls` (initiate) | `INCOMING_CALL` → receiver |
| `POST /calls/:callId/decline` | `CALL_STATE_CHANGED(DECLINED)` → both participants |
| `POST /calls/:callId/cancel` | `CALL_STATE_CHANGED(CANCELLED)` → both participants |
| `POST /calls/:callId/end` | `CALL_STATE_CHANGED(ENDED)` → both participants |
| Call expiry cron (ring timeout) | `CALL_STATE_CHANGED(MISSED)` → both participants |
| `POST /messages` (text/media) | `NEW_MESSAGE` → recipient |
| `POST /messages/voice-note` | `NEW_MESSAGE` → recipient |

---

## Delivery Flow

### Messages

```
1. POST /messages
   │
2. Controller creates Message + NotificationOutbox row in one DB transaction
   │
3. dispatchNotificationOutbox() (fire-and-forget)
   │
4. Reads PENDING NotificationOutbox rows
   │
5. enqueueMessagePushDeliveries()
   ├─ Checks UserNotificationPreference (messagesEnabled)
   ├─ Fetches all enabled UserDevice rows for recipient
   ├─ Selects provider per device (FCM vs Expo)
   ├─ Deduplicates identical tokens
   └─ Writes MessagePushDelivery rows (status: PENDING)
   │
6. dispatchMessageDeliveries()
   └─ sendToDevice()
       ├─ FCM: messaging.send(buildFcmMessage(...))
       └─ Expo: expo.sendPushNotificationsAsync([...])
```

### Calls

```
1. POST /calls
   │
2. Controller creates Call, emits Socket.IO events
   │
3. sendIncomingCallPush() (fire-and-forget)
   │
4. enqueueIncomingCallPush()
   ├─ Builds INCOMING_CALL payload
   ├─ Fetches all enabled UserDevice rows for receiver
   └─ Writes CallPushDelivery rows (status: PENDING)
   │
5. dispatchCallDeliveries()
   └─ sendToDevice() (same path as messages)
```

---

## Durable Outbox Pattern

Push deliveries are written to the database **synchronously** within the same transaction as the business operation (message send, call state change). This means:

- A server restart between commit and delivery never loses a notification
- The cron worker picks up any undelivered rows
- Notifications survive process crashes

**Transaction boundary:**
```
BEGIN
  INSERT INTO messages (...)
  INSERT INTO notification_outbox (eventType: "MESSAGE_CREATED", ...)
COMMIT
-- then fire-and-forget dispatch
```

---

## Cron Worker

`src/jobs/push-delivery.ts` runs every **10 seconds** via `node-cron`:

| Task | Description |
|------|-------------|
| `sendPendingPushDeliveries()` | Retries pending call push deliveries |
| `dispatchNotificationOutbox()` | Processes queued message outbox events |
| `sendPendingMessagePushDeliveries()` | Retries pending message deliveries |
| `fetchExpoPushReceipts()` | Polls Expo for call delivery confirmations |
| `fetchMessageExpoPushReceipts()` | Polls Expo for message delivery confirmations |

**Distributed lock:** Uses Redis (`src/helpers/jobLock.ts`) to ensure only one instance runs the cron in multi-instance deployments. Without Redis, the lock is bypassed (single-instance mode).

**Retry backoff:** Transient failures use bounded exponential backoff: 2s → 4s → 8s → 16s → 32s → 60s (capped). Maximum 5 attempts per delivery.

**Invalid token handling:** When a provider rejects a token (e.g., `DeviceNotRegistered`), the device is disabled and the stale token is cleared. The device can re-register later.

---

## Device Registration

Devices register via `POST /devices/register` (authenticated):

```json
{
  "deviceId": "unique-device-id",
  "platform": "IOS" | "ANDROID",
  "expoPushToken": "ExpoPushToken[...]",
  "fcmToken": "...",        // optional, Android only
  "apnsToken": "...",       // optional
  "voipPushToken": "..."    // optional, for VoIP calls
}
```

- Upserts into `UserDevice` (unique on `userId` + `deviceId`)
- Enables the device and updates `lastSeenAt`

**Other endpoints:**
- `DELETE /devices/:deviceId` — unregisters a device
- `GET /devices/notifications/preferences` — reads notification settings
- `PATCH /devices/notifications/preferences` — toggles `messagesEnabled`

---

## Notification Preferences

Per-user opt-out via `UserNotificationPreference`:

| Field | Default | Effect |
|-------|---------|--------|
| `messagesEnabled` | `true` | When `false`, message push notifications are skipped |

Call notifications are **not** opt-out-able — they are always sent.

---

## Configuration

Environment variables (see `.env.example`):

| Variable | Required | Purpose |
|----------|----------|---------|
| `FIREBASE_PROJECT_ID` | No | Firebase project ID |
| `FIREBASE_PRIVATE_KEY` | No | Service account private key (PEM) |
| `FIREBASE_CLIENT_EMAIL` | No | Service account email |
| `REDIS_URL` | No | Distributed lock for cron (single-instance if omitted) |

If any Firebase variable is missing, FCM is silently disabled and all devices use Expo.

---

## Key Files

| File | Role |
|------|------|
| `src/config/firebase.ts` | Firebase Admin SDK initialization |
| `src/helpers/pushPayload.ts` | Payload builders, provider selection, error classification |
| `src/helpers/pushNotifications.ts` | Core engine: enqueue, dispatch, send, receipt polling, token invalidation |
| `src/jobs/push-delivery.ts` | Cron worker (every 10s) for durable push delivery |
| `src/jobs/call-expiry.ts` | Expires unanswered calls, triggers MISSED pushes |
| `src/helpers/jobLock.ts` | Redis-based distributed lock |
| `src/helpers/callLogger.ts` | Structured logging for push events |
| `src/modules/devices/devices.controller.ts` | Device registration API |
| `src/modules/messages/calls.controller.ts` | Call lifecycle endpoints |
| `src/modules/messages/messages.controller.ts` | Message send endpoints |
| `prisma/schema.prisma` | Data models: `UserDevice`, `CallPushDelivery`, `MessagePushDelivery`, `NotificationOutbox` |
