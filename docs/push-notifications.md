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

The server supports three push providers, selected per-device:

| Provider | Library | When Used |
|----------|---------|-----------|
| **Firebase Cloud Messaging (FCM)** | `firebase-admin` | Android devices with an `fcmToken` |
| **APNs VoIP** | built-in `http2` (direct APNs) | iOS devices with a `voipPushToken`, for **call** payloads only |
| **Expo Push Notifications** | `expo-server-sdk` | iOS devices (without a VoIP token), Android devices without an `fcmToken` |

Selection logic (`src/helpers/pushPayload.ts:providerForDevice`):
- **iOS + `voipPushToken` + call payload (`INCOMING_CALL` / `CALL_STATE_CHANGED`)** → VOIP (PushKit)
- **Android** + `fcmToken` → FCM
- **Android** without `fcmToken` → Expo
- **iOS** without a usable VoIP token → Expo (wraps APNs)

FCM is optional. If Firebase env vars are missing, the server logs a warning and Android devices fall back to Expo. APNs VoIP is optional too — a missing APNs key silently disables VoIP pushes and iOS devices fall back to Expo (banner only, no lock-screen call).

---

## Notification Types

| Type | When Sent | Payload Key |
|------|-----------|-------------|
| **Incoming Call** | Call initiated to receiver | `INCOMING_CALL` |
| **Call State Changed** | Terminal call events (DECLINED, CANCELLED, MISSED, ENDED, FAILED) | `CALL_STATE_CHANGED` |
| **New Message** | New chat message or voice note | `NEW_MESSAGE` |

Display behavior per type:

- **Incoming Call (`INCOMING_CALL`)** — Always a **visible alert** so a backgrounded or killed app shows the ring even if JavaScript never wakes: FCM sends a `notification` block on the `calls` channel (custom ringtone, `priority: high`, `tag: incoming-call-<callId>`); Expo sends a visible notification on the `calls` channel. Provider TTL is bounded to the remaining ring window (`min(30000ms, ring remaining)`); once `expiresAt` passes the delivery is skipped (`CALL_EXPIRED`), so alerts never outlive the ringing period.
- **Call State Changed (`CALL_STATE_CHANGED`)** — Silent **data-only** on FCM (no `notification` block) so only the app handler dismisses ringing state; on Expo it necessarily renders a banner because Expo cannot send truly silent pushes today.
- **New Message (`NEW_MESSAGE`)** — Visible notification on both providers, always on the `messages` channel.

On iOS devices with a registered `voipPushToken`, call payloads are delivered as **PushKit VoIP pushes** directly to APNs so the OS can launch the app even when terminated and present a lock-screen incoming-call UI.

Message notifications are **never** sent over the VoIP channel.

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
   ├─ Per device: VOIP (iOS w/ voipPushToken) | FCM (Android) | EXPO (fallback)
   └─ Writes CallPushDelivery rows (status: PENDING)
   │
5. dispatchCallDeliveries()
   └─ sendToDevice() — VOIP goes directly to APNs over HTTP/2
```

`CALL_STATE_CHANGED` uses the same pipeline, targeting **both** participants so a terminated app can dismiss a stale ringing screen over PushKit too.

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
| `APPLE_APNS_KEY_ID` | No | APNs Auth Key ID (10 chars) — required for iOS VoIP |
| `APPLE_APNS_TEAM_ID` | No | Apple Developer team ID — required for iOS VoIP |
| `APPLE_BUNDLE_ID` | No | App bundle ID; PushKit topic is `<bundle-id>.voip` |
| `APPLE_APNS_P8_KEY` | No | Contents of the APNs Auth Key `.p8` file (or use `APPLE_APNS_KEY_PATH`) |
| `APPLE_APNS_KEY_PATH` | No | Filesystem path to the `.p8` key instead of `APPLE_APNS_P8_KEY` |
| `APPLE_APNS_PRODUCTION` | No | `true` targets `api.push.apple.com`; unset/`false` uses the sandbox |
| `REDIS_URL` | No | Distributed lock for cron (single-instance if omitted) |

If any Firebase variable is missing, FCM is silently disabled and Android devices use Expo. If any APNs variable is missing, VoIP pushes are silently disabled and iOS devices use Expo.

---

## Key Files

| File | Role |
|------|------|
| `src/config/firebase.ts` | Firebase Admin SDK initialization |
| `src/config/apns.ts` | Direct APNs HTTP/2 client (JWT ES256) for iOS VoIP pushes |
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
