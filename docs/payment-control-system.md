# Payment Control System

Reference for the **database-persisted payment toggle** shipped in commit `8e49574`.

This replaces the static `PAYMENTS_ENABLED` environment-flag behavior with a
runtime toggle that admins can flip without redeploying, then enforces it at the
payment-service layer.

> **Superseded (partially) by
> [`payment-gateway-settings.md`](./payment-gateway-settings.md).** The toggle
> documented here is now a thin compatibility layer. When a `PaymentGatewayConfig`
> row exists, the authoritative state is
> `payment_gateway_configs.paymentProcessingEnabled`, and
> `getPaymentControlDetails()` / `setPaymentControlStatus()` read and write
> through to it. The `PAYMENTS_ENABLED` system setting is still honoured as a
> fallback for deployments that have never used the settings screen, and
> `GET`/`PATCH /admin/payments/status` continue to work unchanged.
>
> This document remains accurate for the legacy path, the public
> `GET /payment/status` contract, and the enforcement points (§6). See the
> gateway document for how the switch is now kept consistent with the gateway
> credentials.

---

## 1. How it works

Previously, payment availability was locked at process start:

```ts
export const paymentsEnabled = process.env.PAYMENTS_ENABLED === "true";
```

Now the state lives in a `system_settings` DB row (`key = "PAYMENTS_ENABLED"`)
and is read through an in-memory cache:

```
+--------+     10s TTL       +------------------+      upsert       +--------------------+
|  Admin | ----------------->|  config/payments  | ----------------->|  system_settings    |
|  API   |  PATCH (enabled,  |  .ts read/write   |  (enabled,reason) |  key="PAYMENTS_…"   |
+--------+  reason, adminId) +------------------+      fetch        +--------------------+
                                        |  ^
                                read (public) |
                                        |  |
        GET /payment/status  <-----------+  |
        (frontend skips payment            |
        screens when disabled)         +----+
                                        v
                                initializePayment / initializePaymentMOMO / subscriptionPayment
                                        |            ^
                                        |            | isPaymentsEnabled() guard
                                        v            |
                                 Hubtel / MOMO init blocked when disabled (503)
```

- **Cache:** 10-second in-memory TTL. Writes (`setPaymentControlStatus`) refresh
  the cache immediately.
- **Fallback:** if no DB row exists (or the DB is unreachable), the module falls
  back to `process.env.PAYMENTS_ENABLED === "true"`.
- **Verification/status endpoints are NOT gated** — callbacks and status checks
  for already-initiated payments keep working while the system is disabled.

## 2. Storage

### New table

Prisma model (`prisma/schema.prisma`):

```prisma
model SystemSetting {
  id          String   @id @default(uuid())
  key         String   @unique
  value       String   @db.Text
  description String?
  updatedBy   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("system_settings")
}
```

The `PAYMENTS_ENABLED` row stores a JSON string:

```json
{ "enabled": true, "reason": null }
```

`parseSettingValue` also accepts legacy formats: a raw `"true"`/`"false"`
string or a bare JSON boolean.

### Deployment

The migration is committed under
`prisma/migrations/20260914_add_system_settings/`. Run it before or at deploy:

```bash
npx prisma migrate deploy
```

## 3. Config layer — `src/config/payments.ts`

| Export                           | Type                             | Purpose                                                                                                     |
| -------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `PAYMENT_SETTING_KEY`            | `string`                         | Constant `"PAYMENTS_ENABLED"`                                                                               |
| `PAYMENTS_DISABLED_MESSAGE`      | `string`                         | User-facing message returned when blocked                                                                   |
| `paymentsEnabled`                | `boolean` (mutable)              | Module-level snapshot, kept in sync on read/write                                                           |
| `isPaymentsEnabled()`            | `Promise<boolean>`               | Quick check; hits cache then DB                                                                             |
| `getPaymentControlDetails()`     | `Promise<PaymentControlDetails>` | Full state incl. `reason`, `updatedAt`, `updatedBy`                                                         |
| `setPaymentControlStatus(input)` | `Promise<PaymentControlDetails>` | Writes through to the gateway row when one exists, otherwise upserts `{ enabled, reason }`; refreshes cache |
| `_resetPaymentControlCache()`    | `void`                           | Test-only cache reset                                                                                       |

`PaymentControlDetails` shape returned by the API:

```ts
interface PaymentControlDetails {
  enabled: boolean;
  reason: string | null;
  updatedAt: Date;
  updatedBy: string | null; // admin user id, if recorded
}
```

## 4. Admin API

All routes require an authenticated `ADMIN` account (Bearer token).

### GET `/admin/payments/status`

Returns current payment control state.

```json
{
  "success": true,
  "data": {
    "enabled": false,
    "reason": "Scheduled maintenance until 14:00 GMT",
    "updatedAt": "2026-09-14T10:00:00.000Z",
    "updatedBy": "9f1c…user-id"
  }
}
```

### PATCH `/admin/payments/status`

Enable or disable the payment system.

Request body (validated by `updatePaymentControlSchema`):

| Field     | Type      | Rules                        |
| --------- | --------- | ---------------------------- |
| `enabled` | `boolean` | **Required**                 |
| `reason`  | `string`  | Optional, max 500 characters |

```bash
curl -X PATCH $API_URL/admin/payments/status \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false, "reason": "Hubtel incident; ETA 16:00 GMT"}'
```

Response:

```json
{
  "success": true,
  "data": {
    "enabled": false,
    "reason": "Hubtel incident; ETA 16:00 GMT",
    "updatedAt": "2026-09-14T10:05:00.000Z",
    "updatedBy": "9f1c…user-id"
  },
  "message": "Payment system disabled successfully"
}
```

Success messages: `"Payment system enabled successfully"` /
`"Payment system disabled successfully"`.

**Audit:** every successful PATCH writes an `adminActivityLog` row with action
`ENABLE_PAYMENTS` or `DISABLE_PAYMENTS` (entity type `PAYMENT`) and the reason as
the note. The log write is fire-and-forget — a logging failure never fails the
request.

> On the gateway path this endpoint is an alias: the switch state is enforced
> against the gateway connection, so enabling through `/admin/payments/status`
> while the selected environment is unconnected returns `409`. See
> [`payment-gateway-settings.md`](./payment-gateway-settings.md) §4.

### Errors

| Code  | Case                                                              |
| ----- | ----------------------------------------------------------------- |
| `400` | Invalid body (missing `enabled`, non-boolean, reason > 500 chars) |
| `401` | Missing / invalid / expired token                                 |
| `403` | Non-admin user                                                    |
| `500` | DB write/fetch failure                                            |

## 5. Public status endpoint

Used by the frontend to **skip payment screens when payments are disabled** — check
it before rendering checkout and redirect/short-circuit when `enabled` is `false`.

### GET `/payment/status`

Public — no auth required.

```json
{
  "success": true,
  "data": {
    "enabled": false,
    "reason": "Scheduled maintenance until 16:00 GMT"
  },
  "message": "Payments are temporarily disabled. Please try again later."
}
```

- `message` is `PAYMENTS_DISABLED_MESSAGE` when disabled, `"Payments are enabled"` otherwise.
- **Only `enabled` and `reason` are exposed** — never `updatedBy` or `updatedAt`.
- Served from the same 10-second-cached `getPaymentControlDetails()` as the admin API, so it stays fast and always matches what the enforcement layer sees.

Frontend pattern:

```ts
const { data } = await fetch(`${API_URL}/payment/status`).then((r) => r.json());
if (!data.enabled) {
  // skip checkout — show data.reason or data.message and offer re-enable feedback
} else {
  // proceed to the payment screen
}
```

## 6. Enforcement points

Blocked with HTTP **503** + `PAYMENTS_DISABLED_MESSAGE` when disabled:

| Endpoint / function                 | Where checked                                           |
| ----------------------------------- | ------------------------------------------------------- |
| `initializePayment` (card checkout) | `src/services/payment.service.ts:60` — first operation  |
| `initializePaymentMOMO` (MOMO)      | `src/services/payment.service.ts:159` — first operation |
| `subscriptionPayment`               | Inline guard at `payment.controller.ts:65`              |

Behaviors when disabled:

- `initializePayment` / `initializePaymentMOMO` return early — **no** DB write,
  **no** Hubtel call. Response `{ success: false, message: PAYMENTS_DISABLED_MESSAGE, paymentId: "", … }`.
- `subscriptionPayment` returns `503` immediately.

**Not gated (by design):**

- `verifyPayment`
- `checkTransactionStatus`
- Hubtel callbacks / cancellations

These remain available so in-flight payments can always be resolved.

## 7. Migration / rollback

- **Upgrade:** `npx prisma migrate deploy` creates the `system_settings` table.
- **Toggle:** do NOT rely on autoscaling to this new mechanism until the
  migration is applied — the module falls back to the env var until a DB row
  exists, so the rollout is safe.
- **Rollback:** reverting to the previous commit restores read-only
  `PAYMENTS_ENABLED` env behavior; the DB row is simply ignored. To re-seed the
  env behavior you can `DELETE FROM system_settings WHERE key='PAYMENTS_ENABLED';`
  (table can stay for future settings).

## 8. Tests

`tests/admin-payment-control.test.ts` — Vitest suite (10 tests):

| Group               | Covers                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------- |
| Schema Validation   | `updatePaymentControlSchema` accept/reject cases incl. 500-char limit                  |
| State & Persistence | `setPaymentControlStatus` writes DB, reads back correctly, toggle on/off               |
| Service Integration | `initializePayment` & `initializePaymentMOMO` return the disabled message early        |
| Admin Controller    | `getControlStatus` / `updateControlStatus` shapes, 400 on bad body, activity-log write |

```bash
npx vitest run tests/admin-payment-control.test.ts
```

The suite creates a throwaway admin user, persists/reads real DB state, and
cleans up (`systemSettings`, `adminActivityLogs`, user) in `afterAll`.
