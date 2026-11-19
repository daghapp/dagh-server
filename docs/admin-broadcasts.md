# Admin Push Broadcasts

**Status:** Implemented  
**Scope:** Backend (`dagh-server`) admin-authored push notifications to app users  
**Related docs:** `docs/admin-endpoints.md`, `docs/push-notifications.md`

This document describes the admin broadcast feature: service announcements and
promotional messages delivered through the existing Expo/FCM/APNs push pipeline.

## 1. What was added

| Area | Change |
|---|---|
| Data model | `Announcement` and `AnnouncementDelivery` tables |
| Preferences | `announcementsEnabled` (default on) and `promotionsEnabled` (default off) on `user_notification_preferences` |
| Admin API | `/admin/notifications/broadcasts*` endpoints |
| Delivery | Chunked, retried, opt-in-aware worker integrated into the existing push job |
| Payload | New `type: "ANNOUNCEMENT"` push payload |
| Audit | `ANNOUNCEMENT` admin activity entries for create/schedule/cancel |
| Tests | `tests/announcement.test.ts` (payload, consent, validation) |

## 2. Host and store policy rules

The implementation follows Expo push, FCM, APNs, and app-store expectations:

- **Promotions require explicit opt-in.** A `PROMOTION` is sent only to users
  whose `promotionsEnabled` is `true`. A missing preference row counts as
  opted out.
- **Service announcements are opt-out.** `ANNOUNCEMENT` is delivered unless the
  user sets `announcementsEnabled: false`.
- **No push to inactive accounts.** Suspended, terminated, and soft-deleted
  accounts are excluded. The default audience is `ACTIVE`.
- **No sensitive data in payloads.** Announcement data contains only the title,
  body, category, announcement ID, and an optional in-app route. No email,
  phone, token, or user-specific data is included.
- **No token storage in broadcast rows.** Delivery rows reference the
  installation (`deviceId`) and resolve the token at send time, so revoked or
  rotated tokens are never reused.
- **Expo rate guidance.** Messages are sent in chunks of 100 per request, and
  the worker processes at most 400 deliveries per 10-second tick — well below
  Expo's 600 notifications/second guideline.
- **FCM concurrency limit.** Native sends run with a concurrency of 10.
- **Invalid-token cleanup.** Expo/FCM token-invalid errors disable the device,
  clear the rejected token, and increment `failureCount`.
- **Receipt handling.** Expo tickets are not treated as delivery. Receipts are
  checked after a 60-second delay; `DeviceNotRegistered` receipts invalidate the
  token.
- **Accident protection.** An identical immediate broadcast from the same admin
  within 10 minutes returns `409 Conflict`.

## 3. Data model

### `Announcement`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID text | Primary key |
| `title` | text | Max 120 chars (API validation) |
| `body` | text | Max 500 chars (API validation) |
| `category` | text | `ANNOUNCEMENT` or `PROMOTION` |
| `audience` | text | `ACTIVE`, `VERIFIED`, or `ALL` |
| `route` | text nullable | In-app path, must start with `/` |
| `status` | text | `DRAFT`, `SCHEDULED`, `SENDING`, `SENT`, `FAILED`, `CANCELLED` |
| `scheduledAt` | timestamp nullable | Required when `sendNow` is false |
| `startedAt` / `completedAt` | timestamp nullable | Send lifecycle |
| `createdBy` | text | Admin user ID (audit; no FK) |
| `recipientCount` | integer | Distinct users queued |
| `deviceCount` | integer | Installations queued |
| `sentCount` / `failedCount` / `skippedCount` | integer | Delivery totals |
| `lastError` | text nullable | Enqueue/send failure summary |

Indexes: `(status, scheduledAt)`, `(createdAt)`.

### `AnnouncementDelivery`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID text | Primary key |
| `announcementId` | text | FK to `announcements`, cascade delete |
| `userId` | text | Recipient (indexed via announcement queries) |
| `deviceId` | text | `user_devices.id`; token is not stored |
| `provider` | text | `EXPO` or `FCM` |
| `status` | text | `PENDING`, `SENDING`, `SENT`, `DELIVERED`, `FAILED`, `SKIPPED`, `RETRY_PENDING` |
| `attemptCount` | integer | Incremented before each provider attempt |
| `providerMessageId` | text nullable | Expo ticket / FCM message ID |
| `errorCode` | text nullable | Provider or local error |
| `availableAt` | timestamp | Retry backoff eligibility |
| `sentAt` | timestamp nullable | Provider acceptance time |
| `receiptsFetchedAt` | timestamp nullable | Expo receipt check marker |

Unique constraint: `(announcementId, deviceId, provider)` prevents duplicate
deliveries. Indexes support the worker's pending-row and receipt queries.

## 4. Preference API changes

`GET /devices/notifications/preferences` now returns:

```json
{
  "success": true,
  "data": {
    "messagesEnabled": true,
    "announcementsEnabled": true,
    "promotionsEnabled": false
  }
}
```

`PATCH /devices/notifications/preferences` accepts any subset of the three
booleans. At least one field must be supplied.

```json
{
  "announcementsEnabled": false,
  "promotionsEnabled": true
}
```

`messagesEnabled` continues to control chat pushes. Broadcasts do not use it.

## 5. Admin API

All broadcast endpoints require `notifications.manage`, which is granted to
`SUPER_ADMIN` only. They are mounted under `/admin/notifications/broadcasts`.

### 5.1 Preview audience

```http
GET /admin/notifications/broadcasts/audience-preview?category=PROMOTION&audience=ACTIVE
Authorization: Bearer <admin access token>
```

```json
{
  "success": true,
  "data": {
    "category": "PROMOTION",
    "audience": "ACTIVE",
    "recipientCount": 142,
    "deviceCount": 173,
    "skippedCount": 0
  }
}
```

`skippedCount` counts installations excluded by preference, missing tokens, or
an unsupported provider. No rows are created.

### 5.2 Create or schedule a broadcast

```http
POST /admin/notifications/broadcasts
Authorization: Bearer <admin access token>
Content-Type: application/json
```

Immediate:

```json
{
  "title": "New itinerary planner",
  "body": "Plan multi-city trips in minutes. Open the app to try it.",
  "category": "PROMOTION",
  "audience": "ACTIVE",
  "route": "/itinerary",
  "sendNow": true
}
```

Scheduled:

```json
{
  "title": "Scheduled maintenance",
  "body": "The app will be briefly unavailable tonight at 22:00 GMT.",
  "category": "ANNOUNCEMENT",
  "audience": "ALL",
  "scheduledAt": "2026-11-20T22:00:00.000Z",
  "sendNow": false
}
```

Validation:

| Field | Rule |
|---|---|
| `title` | Required, trimmed, 1–120 characters |
| `body` | Required, trimmed, 1–500 characters |
| `category` | `ANNOUNCEMENT` or `PROMOTION` |
| `audience` | `ACTIVE` (default), `VERIFIED`, or `ALL` |
| `route` | Optional, ≤200 chars, must start with `/`; empty string becomes null |
| `sendNow` | Boolean, default `true` |
| `scheduledAt` | ISO date-time; required and future when `sendNow` is false; must be omitted when `sendNow` is true |
| Unknown fields | Rejected (`400`) |

Response (`201`):

```json
{
  "success": true,
  "data": {
    "announcement": {
      "id": "8a1c...",
      "title": "New itinerary planner",
      "status": "SENDING",
      "category": "PROMOTION",
      "audience": "ACTIVE",
      "recipientCount": 142,
      "deviceCount": 173,
      "skippedCount": 0
    },
    "audience": {
      "recipientCount": 142,
      "deviceCount": 173,
      "skippedCount": 0
    }
  },
  "message": "Broadcast queued for delivery"
}
```

Scheduled rows return `201` with `status: "SCHEDULED"` and
`message: "Broadcast scheduled"`.

Errors: `400` validation; `403` missing permission; `409` duplicate immediate
broadcast; `500` queue failure (the row is marked `FAILED` with `lastError`).

### 5.3 List broadcasts

```http
GET /admin/notifications/broadcasts?status=SENT&page=1&limit=20
```

Uses the standard paginated envelope. `status` is optional; unknown values
return `400`.

### 5.4 Broadcast detail

```http
GET /admin/notifications/broadcasts/:id
```

Returns the announcement, `_count.deliveries`, and the latest 100 delivery rows.
Each delivery row exposes `deviceId`, `provider`, `status`, `attemptCount`,
`errorCode`, and timestamps. Tokens are never returned.

### 5.5 Cancel

```http
POST /admin/notifications/broadcasts/:id/cancel
```

Allowed for `DRAFT`, `SCHEDULED`, and `SENDING`. Unsent deliveries become
`SKIPPED` with `errorCode: "ANNOUNCEMENT_CANCELLED"`. Returns `409` for any other
status and `404` for an unknown ID. A concurrent `finalize` will not overwrite
`CANCELLED`.

## 6. Delivery lifecycle

1. **Create** — row starts as `DRAFT` (immediate) or `SCHEDULED`.
2. **Enqueue** — the audience is paged in batches of 500 devices, filtered by
   account status, verification, and category consent. `AnnouncementDelivery`
   rows are inserted with `skipDuplicates`. The announcement becomes `SENDING`.
3. **Dispatch** — the push worker (every 10 seconds, distributed lock) selects
   one `SENDING` announcement and up to 400 due `PENDING`/`RETRY_PENDING` rows.
4. **Send** — Expo rows are chunked at 100; FCM rows run with concurrency 10.
   Successful sends become `SENT`; temporary failures become `RETRY_PENDING`
   with exponential backoff (max 4 attempts); permanent failures become
   `FAILED`; missing tokens become `SKIPPED`.
5. **Receipts** — after 60 seconds, Expo receipts are fetched for `SENT` rows.
   `ok` becomes `DELIVERED`; errors become `FAILED`; invalid tokens are cleared.
6. **Finalize** — when no pending/retry rows remain, the announcement becomes
   `SENT` and `sentCount`/`failedCount`/`skippedCount` are refreshed.

Crash recovery: rows stuck in `SENDING` for more than 15 minutes are reset to
`RETRY_PENDING`. Scheduled broadcasts are promoted by the same worker when
`scheduledAt <= now`.

Cancellation is terminal even if a provider request was already in flight; a
later finalize will not change the status.

## 7. Push payload contract

Announcement pushes contain:

```json
{
  "type": "ANNOUNCEMENT",
  "announcementId": "8a1c...",
  "title": "New itinerary planner",
  "body": "Plan multi-city trips in minutes.",
  "category": "PROMOTION",
  "route": "/itinerary",
  "schemaVersion": "1"
}
```

Client requirements:

- Handle `type: "ANNOUNCEMENT"` in the background/foreground notification
  handler.
- Use `route` when present to deep-link; ignore it when empty.
- Treat `category` as display/analytics metadata, not as authorization.
- The Android channel remains `messages` (the existing app channel) to avoid
  delivering to an unregistered channel.

## 8. Files

| File | Purpose |
|---|---|
| `prisma/schema.prisma` | `Announcement`, `AnnouncementDelivery`, preference columns |
| `prisma/migrations/20261118000001_add_announcement_broadcasts/migration.sql` | Migration |
| `src/services/announcement.service.ts` | Enqueue, dispatch, receipts, cancel, preview |
| `src/modules/admin/announcement.controller.ts` | Admin endpoints |
| `src/routes/admin-announcements.routes.ts` | Route guards |
| `src/validator/announcementValidation.ts` | Input schema and consent helper |
| `src/helpers/pushPayload.ts` | `ANNOUNCEMENT` payload builder and title/body |
| `src/jobs/push-delivery.ts` | Worker integration |
| `src/modules/devices/devices.controller.ts` | Preference API |
| `tests/announcement.test.ts` | Unit tests |

## 9. Deployment

1. Apply the migration:

   ```bash
   npx prisma migrate deploy
   ```

   `npm start` already runs `prisma migrate deploy` before starting the server.

2. Generate the client if the generated output is not committed:

   ```bash
   npm run db:generate
   ```

3. Ensure the existing push configuration is present (`EXPO`, Firebase
   credentials for native FCM, APNs keys for VoIP). Broadcasts do not use VoIP.

4. Keep the process running: the push worker is scheduled in-process in
   `src/server.ts`. If the instance is stopped, queued rows resume on restart.

## 10. Tests and verification

```bash
npx tsc --noEmit
npm run lint
npx vitest run tests/announcement.test.ts
npm test
```

Current result: TypeScript clean, lint 0 errors, full suite 948 tests passing.

## 11. Known limitations and follow-ups

- Announcement and delivery rows have no automatic retention/cleanup job yet.
  Add one if the tables grow large.
- There is no per-admin hourly broadcast quota beyond the existing `/admin`
  rate limiter and the 10-minute duplicate guard.
- Promotions are checked for consent at enqueue time. A user opting out during
  the short enqueue-to-send window may still receive that one send.
- Cancellation does not abort an in-flight provider request; it prevents
  unsent rows from being delivered.
- Client-side rendering and deep-link handling must be implemented in the app.
