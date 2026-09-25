# Payment Gateway Settings

Reference for the **Hubtel payment-gateway settings console** — the encrypted,
DB-backed credential store, connection verification, and payment master switch
that let an administrator configure the live payment provider without a
redeploy or an environment-variable edit.

This document is the implementation record for that work, aimed at backend
maintainers. Frontend developers building the settings screen should start with
[`payment-gateway-frontend-guide.md`](./payment-gateway-frontend-guide.md) —
it has the API contracts, the UI state machine, the error cases, a reference
client, and a testing checklist.

For the toggle alone, see
[`payment-control-system.md`](./payment-control-system.md) (the earlier
`PAYMENTS_ENABLED` feature that this supersedes at runtime but remains
supported as a fallback).

---

## 1. What shipped

| Area          | Change                                                                             |
| ------------- | ---------------------------------------------------------------------------------- |
| Storage       | New `PaymentGatewayConfig` model + `20261004_add_payment_gateway_config` migration |
| Secrets       | AES-256-GCM encryption at rest, AAD-bound to a per-field context                   |
| Admin API     | 5 new endpoints under `/admin/settings/payment-gateway`                            |
| Authorization | 6-scope permission vocabulary, enforced server-side                                |
| Verification  | Non-mutating Hubtel connection probe                                               |
| Runtime       | Hubtel clients resolve credentials from the DB (10s cache) with env fallback       |
| Observability | Structured, credential-safe event log + admin audit trail                          |
| Tests         | 38 new tests (26 settings + 12 encryption)                                         |

### Problems it solves

1. **Credentials lived only in `.env`.** Rotating a Hubtel secret meant editing
   Render's dashboard and restarting — a window where the app is down, and no
   record of who changed what.
2. **No way to confirm credentials before taking money.** A misconfigured
   secret surfaced as a failed checkout, discovered by a customer.
3. **`PAYMENTS_ENABLED` was a separate switch** from the credentials, so the two
   could disagree: processing enabled against credentials nobody had verified.
4. **`requireAdmin` was the only gate.** Every admin account — including roles
   like `SUPPORT` and `MODERATOR` — could in principle read and rewrite the live
   payment provider keys.

---

## 2. Data model

`prisma/schema.prisma`:

```prisma
enum PaymentGatewayProvider { HUBTEL }
enum PaymentGatewayEnvironment { TEST, LIVE }
enum PaymentGatewayConnectionStatus { NOT_CONNECTED, CONNECTED, ERROR }

model PaymentGatewayConfig {
  id                       String                          @id @default(uuid())
  provider                 PaymentGatewayProvider          @unique
  clientIdEncrypted        String?                         @db.Text
  clientSecretEncrypted    String?                         @db.Text
  environment              PaymentGatewayEnvironment        @default(TEST)
  connectionStatus         PaymentGatewayConnectionStatus  @default(NOT_CONNECTED)
  connectedEnvironment     PaymentGatewayEnvironment?
  lastTestedAt             DateTime?
  lastConnectedAt          DateTime?
  lastErrorCategory        String?
  paymentProcessingEnabled Boolean                         @default(false)
  processingDisabledReason String?
  updatedBy                String?
  createdAt                DateTime                        @default(now())
  updatedAt                DateTime                        @updatedAt

  @@map("payment_gateway_configs")
}
```

Design notes:

- `provider` is `@unique`, so this is a **one-row-per-provider** table. A new
  provider is a new row, not a schema change.
- `connectionStatus` and `connectedEnvironment` are **separate on purpose** (see
  §6). The environment is recorded alongside the status so the API can report
  both "was this ever verified" and "is it verified _right now_".
- `lastErrorCategory` is a **coarse, non-secret classification** (`String`, not an
  enum, so a category can be added without a migration). It is never a provider
  error body.
- `AdminActivityLog` gained `metadata Json?` for structured, non-secret
  before/after context.
- `AdminEntityType` gained `PAYMENT_GATEWAY`.

### Migration

`prisma/migrations/20261004_add_payment_gateway_config/migration.sql` is
**re-runnable** — the enum creation, the `admin_activity_logs` column, the table,
and the unique index are each guarded (`IF NOT EXISTS`). Executed twice against
the same database with no error, so a partially-applied previous attempt is
recoverable.

```bash
npx prisma migrate deploy
```

---

## 3. Credential encryption

`src/helpers/encryption.ts`. AES-256-GCM, and **GCM additional authenticated
data (AAD)** binds each ciphertext to a context string:

```
v1:<iv>:<authTag>:<ciphertext>     // all segments base64
```

- Contexts are `hubtel:clientId` and `hubtel:clientSecret`. A value encrypted
  for `hubtel:clientSecret` **cannot be decrypted** as `hubtel:clientId` — a
  swapped-column bug fails loudly instead of silently returning garbage.
- Tampering with the ciphertext, the tag, or the context fails the auth tag
  check and throws. Covered by `tests/encryption.test.ts`.
- The **client ID is encrypted too**, even though the handoff described it as
  arguably not secret. It is an authentication input; leaving one half of a
  credential pair in plaintext buys nothing.

### Key handling

`PAYMENT_GATEWAY_ENCRYPTION_KEY` — exactly 32 bytes, supplied as 64 hex
characters or base64.

- **Required** in any non-test environment. Missing → `throw`, by design. A
  silent fallback key would mean production secrets protected by a public
  constant.
- `NODE_ENV=test` uses a fixed fallback so the suite does not need a secret.
- **Rotating the key makes stored secrets undecryptable.** Rotate credentials
  through the settings screen _after_ changing it.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 4. Admin API

Mounted at `/admin` in `src/server.ts`. Every endpoint is
`protectedRoute` → `requireAdminPermission(scope)`.

| Method | Path                                         | Scope                                 | Purpose                           |
| ------ | -------------------------------------------- | ------------------------------------- | --------------------------------- |
| GET    | `/admin/settings/payment-gateway`            | `settings.payment.view`               | Read sanitized config             |
| PUT    | `/admin/settings/payment-gateway`            | `settings.payment.credentials.manage` | Update credentials / environment  |
| POST   | `/admin/settings/payment-gateway/test`       | `settings.payment.connection.test`    | Test credentials, no state change |
| POST   | `/admin/settings/payment-gateway/connect`    | `settings.payment.connection.manage`  | Verify **and** mark connected     |
| PATCH  | `/admin/settings/payment-gateway/processing` | `settings.payment.processing.manage`  | Master switch                     |

### GET `/admin/settings/payment-gateway`

```json
{
  "success": true,
  "data": {
    "provider": "HUBTEL",
    "environment": "TEST",
    "connectionStatus": "CONNECTED",
    "connectedEnvironment": "TEST",
    "connected": true,
    "paymentProcessingEnabled": true,
    "hasClientId": true,
    "hasClientSecret": true,
    "configured": true,
    "credentialSource": "database",
    "lastTestedAt": "2026-10-04T09:00:00.000Z",
    "lastConnectedAt": "2026-10-04T09:00:05.000Z",
    "lastErrorCategory": null,
    "processingDisabledReason": null,
    "updatedBy": "9f1c…user-id",
    "createdAt": "2026-10-04T08:00:00.000Z",
    "updatedAt": "2026-10-04T09:00:05.000Z"
  }
}
```

**The secret is write-only.** `hasClientSecret` is a boolean presence flag; the
value is never returned, not even masked. There is no endpoint that can read
it back.

When no row exists yet, the response describes the `HUBTEL_*` environment
variables instead, with `credentialSource: "environment"` and `configured`
reflecting whether both are present — so the console renders correctly before
anyone has saved anything.

`connected` is **derived, not stored**:
`connectionStatus === "CONNECTED" && connectedEnvironment === environment`.
See §6.

### PUT `/admin/settings/payment-gateway`

Partial update. Every field is optional.

| Field               | Type               | Rules                                               |
| ------------------- | ------------------ | --------------------------------------------------- |
| `clientId`          | `string`           | Max 128. Trimmed. Blank/omitted = no change         |
| `clientSecret`      | `string`           | Max 512. Blank/omitted = **no change**              |
| `clearClientSecret` | `boolean`          | The only way to remove a stored secret              |
| `environment`       | `"TEST" \| "LIVE"` | Also requires `settings.payment.environment.manage` |

Blank and omitted are treated identically and deliberately: a frontend that
submits an empty password field must not wipe a working credential. Removal
requires the explicit `clearClientSecret: true` flag.

Clearing the **last** remaining credential is rejected with `400` — a row with
no credentials cannot be verified, so it is always a mistake.

Because one `PUT` can change credentials _and_ the environment, the environment
half is re-checked in-controller with `assertAdminPermission`; route-level
middleware cannot inspect a body it has not read yet.

### POST `/admin/settings/payment-gateway/test`

Non-mutating. **An empty body is valid** and means "test whatever is stored" —
the common case. An admin can alternatively pass unsaved in-flight credentials
to check them before committing them to the database.

| Status | Meaning                                                |
| ------ | ------------------------------------------------------ |
| `200`  | Credentials accepted                                   |
| `400`  | Rejected by Hubtel, or missing locally (not retryable) |
| `403`  | Insufficient permission                                |
| `503`  | Hubtel unreachable or timed out (**retryable**)        |

On success it updates `lastTestedAt` only. It does **not** change
`connectionStatus` — that is what `/connect` is for. Idempotent; safe to retry.

### POST `/admin/settings/payment-gateway/connect`

Verifies the stored credentials and, only if that passes, sets
`connectionStatus = CONNECTED` and `connectedEnvironment = <current env>`.

The returned status is always server-derived. A client must not assume success.

| Status | Meaning                                          |
| ------ | ------------------------------------------------ |
| `200`  | Connected                                        |
| `400`  | No credentials stored                            |
| `403`  | Insufficient permission                          |
| `502`  | Verification failed (rejected or provider error) |

### PATCH `/admin/settings/payment-gateway/processing`

```json
{ "enabled": true, "reason": "Optional, max 500" }
```

The master switch. **Enabling is rejected with `409` when the currently selected
environment has no verified connection.** Disabling is _always_ permitted,
including while the gateway is unhealthy, so it stays usable as an operational
kill switch.

### Errors

| Code  | Case                                                             |
| ----- | ---------------------------------------------------------------- |
| `400` | Invalid body; clearing the last credential; credentials rejected |
| `401` | Missing / invalid / expired token                                |
| `403` | Insufficient scope — includes the missing scope in the payload   |
| `409` | Enabling while the selected environment is unconnected           |
| `502` | Connect failed — rejected credentials or provider error          |
| `503` | Hubtel unreachable or timed out (retryable)                      |

---

## 5. Authorization

`src/middleware/admin-permission.ts`. `requireAdmin` only asserts
`accountType === "ADMIN"`, which is far too coarse for payment credentials.

```ts
export const PAYMENT_GATEWAY_PERMISSIONS = {
  VIEW: "settings.payment.view",
  MANAGE_CREDENTIALS: "settings.payment.credentials.manage",
  TEST_CONNECTION: "settings.payment.connection.test",
  MANAGE_CONNECTION: "settings.payment.connection.manage",
  MANAGE_ENVIRONMENT: "settings.payment.environment.manage",
  MANAGE_PROCESSING: "settings.payment.processing.manage",
} as const;
```

Every scope currently resolves to **`SUPER_ADMIN` only**. That is deliberate:
the repository has no permission table, and inventing one alongside 30+
ungated admin routes would create two competing authorization models. The
role → scope mapping is isolated in a single `ROLE_SCOPES` object, so widening
it later (for example letting `FINANCE` hold `view` + `processing.manage`) is a
one-function change with no call-site edits.

An `ADMIN` account with **no `AdminProfile` row has no role** and is therefore
denied — it is not treated as an implicit super admin. The role lookup is
memoised per request, so a route needing two scope checks queries once.

The check is server-side and independent of what the admin UI renders. Hiding a
button is not authorization.

---

## 6. The state machine

The subtle part of this feature is that four fields must stay mutually
consistent:

```
                        PUT (credentials changed)
                       ┌──────────────────────────┐
                       │                          ▼
  (none) ──PUT──▶ configured ──connect──▶ CONNECTED ──enable──▶ enabled
                       │                          ▲                     │
                       │                     PUT (env changed)        │ disable
                       └──test──▶ lastTestedAt   │                     ▼
                                                │            auto-disabled
                                       connected = false
```

### Why `connected` is derived

`connectionStatus` records **"these credentials were verified"**.
`connectedEnvironment` records **"for which environment"**. Deriving
`connected` from both means switching `TEST` → `LIVE` immediately reports
`connected: false` without lying about the stored verification — the
`TEST` verification is still on record, just not effective.

### Auto-disable

Money movement must not survive anything that invalidates the connection for the
current environment. `paymentProcessingEnabled` is therefore forced to `false`
on **either** a credential change **or** an environment switch, with
`processingDisabledReason` recording which.

> This is worth calling out because it was a real bug caught in review: the
> first implementation only auto-disabled on credential changes, so an admin
> could enable processing in `TEST`, flip to `LIVE`, and leave real money
> movement enabled against a connection verified for a _different_ environment.
> Fixed in `payment-gateway-config.service.ts` and locked down by
> _"auto-disables processing when the environment changes"_.

### The invariant

> `paymentProcessingEnabled === true` implies the current environment's
> connection is verified.

`setProcessingEnabled` enforces it at write time (409). Auto-disable preserves
it on every path that could otherwise break it.

---

## 7. Connection probe

`src/services/hubtel-connection.service.ts`. Answers one question — _are these
credentials accepted?_ — without moving money.

Hubtel's REST API uses HTTP Basic auth on every request and has **no
token-exchange or "whoami" endpoint**, so there is no dedicated
credential-check call. The probe issues a read-only lookup against the
transaction-status API with a client reference that cannot exist:

```
GET {HUBTEL_STATUS_API_BASE}/transactions/{merchant}/status
    ?clientReference=00000000-0000-4000-8000-000000000000&_probe={uuid}
```

Hubtel authorises **before** it validates the payload, so the status code alone
settles the question:

| Response                 | Interpretation                               |
| ------------------------ | -------------------------------------------- |
| `401` / `403`            | Credentials rejected → `invalid_credentials` |
| Anything else            | Auth layer passed → success                  |
| Connection refused / DNS | `network`                                    |
| > 10s                    | `timeout`                                    |

That rule deliberately does **not** enumerate Hubtel's "unknown reference"
codes. `200`, `404` and `400` all prove the auth layer passed; treating them as
failures would report healthy credentials as broken.

Safety properties:

- A `GET` against a status resource for a reference that was never issued
  **cannot create, capture, or reverse a payment**.
- Credentials appear only in the `Authorization` header — never in the URL.
- A unique `_probe` UUID per call prevents a proxy or CDN from replaying a
  cached response and masking a credential change.
- **Provider response bodies are deliberately never surfaced to callers**,
  because an upstream error payload could echo the submitted credentials.
- `validateStatus: () => true` so status codes are inspected rather than thrown.

Error categories: `invalid_credentials`, `invalid_credentials_missing`,
`network`, `timeout`, `provider_error` — each mapped to a human-readable
message and a `retryable` flag.

> **Open item:** the `401`/`403` rule is an assumption derived from the
> documented auth-first behaviour, not from observed sandbox responses. It is
> worth confirming against real sandbox credentials before relying on it to
> distinguish "wrong password" from "Hubtel is down".

---

## 8. Runtime integration

### Credential resolution

`src/config/hubtel.ts` no longer exports a statically-built Axios client. The
previous `hubtelClient` was constructed at import time from `process.env`,
which meant a rotated credential required a restart.

| Export                          | Purpose                     |
| ------------------------------- | --------------------------- |
| `getHubtelClient()`             | Authenticated API client    |
| `getHubtelStatusClient()`       | Transaction-status client   |
| `getHubtelDirectMoneyReceive()` | Direct money receive client |

All three are now `async`, resolve credentials through
`getRuntimeCredentials()`, and cache the result for **10 seconds** so a burst of
payment calls does not become a burst of DB reads. A credential write
invalidates the cache, so a new secret takes effect immediately instead of
after the TTL.

Resolution order: **`PaymentGatewayConfig` row first, `HUBTEL_*` env vars as
fallback.** Every call site was updated: `payment.service.ts`,
`payment-management/payment.controller.ts`, `hubtel-callback.ts`, and the
`check-pending-payments` job.

### One switch, not two

`src/config/payments.ts` keeps its public API, but `getPaymentControlDetails()`
now prefers the gateway row and `setPaymentControlStatus()` writes through to
it when one exists:

```
                    GET /payment/status  ·  GET /admin/payments/status
                                    │
                                    v
                    isPaymentsEnabled()  ──▶  PaymentGatewayConfig.paymentProcessingEnabled
                              │                        (if a row exists)
                              └──▶ SystemSetting["PAYMENTS_ENABLED"]
                                   (legacy fallback)
```

The legacy `PAYMENTS_ENABLED` system setting is **left untouched, not deleted**
— it is only consulted when no gateway row exists, and removing it would
silently change behaviour for any deployment still on the legacy path. A
deployment that has never opened the settings screen behaves exactly as before.

The legacy `GET`/`PATCH /admin/payments/status` endpoints keep working as thin
aliases, so existing admin clients do not break.

> Two writers, one reader would let the switches disagree — the exact failure
> mode this feature removes. Writing through to the gateway row when one exists
> is what keeps them unified.

---

## 9. Observability

### Structured events

`src/helpers/paymentGatewayLogger.ts` emits single-line JSON with
`timestamp`, `event`, `actorId`, `requestId`, `environment`, and
change-specific fields:

```
payment_gateway.credentials_updated
payment_gateway.connection_test_result
payment_gateway.connect_started
payment_gateway.connect_result
payment_gateway.processing_toggled
payment_gateway.environment_changed
```

Credentials are structurally excluded — there is no code path that accepts a
secret as a log field, and `clientIdChanged` / `clientSecretChanged` are
booleans.

### Audit trail

`AdminActivityLog` rows with `entityType: "PAYMENT_GATEWAY"`:

| Action                       | When                               |
| ---------------------------- | ---------------------------------- |
| `CREDENTIALS_UPDATED`        | Credentials or environment changed |
| `CONNECTED`                  | `/connect` verified successfully   |
| `CONNECT_FAILED`             | `/connect` failed                  |
| `ENABLE_PAYMENT_PROCESSING`  | Switch turned on                   |
| `DISABLE_PAYMENT_PROCESSING` | Switch turned off                  |

`metadata` carries structured, non-secret before/after context — for example
`{"environment": {"from": "TEST", "to": "LIVE"}, "requestId": "…",
"processingAutoDisabled": true}` — and **never** credentials.

### Request correlation

`src/middleware/request-id.ts` assigns or forwards an `X-Request-Id`, echoes it
on the response, and exposes it as `req.requestId`. It is mounted early in
`server.ts` so it flows into the audit metadata above.

---

## 10. Testing

| File                                     | Tests | Covers                                                                                   |
| ---------------------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| `tests/encryption.test.ts`               | 12    | Round-trip, AAD context binding, tamper detection, key validation                        |
| `tests/payment-gateway-settings.test.ts` | 26    | State machine, sanitization, env fallback, audit metadata, controller status codes, RBAC |
| `tests/admin-payment-control.test.ts`    | 13    | Legacy toggle still correct, including the inherited 409                                 |

The settings suite drives a **real local PostgreSQL** and a **real local HTTP
stub** standing in for Hubtel, so the genuine error mapping is exercised
instead of a mocked Axios.

```bash
npx vitest run tests/payment-gateway-settings.test.ts
npx vitest run tests/encryption.test.ts
```

### A note on `fileParallelism`

`vitest.config.ts` sets `fileParallelism: false`. Test files share one
PostgreSQL database, and several assert on global singleton rows. When files
ran in parallel, the payment-gateway fixtures overwrote the legacy payment
toggle's expectations — order-dependent failures that passed in isolation. It
costs nothing (23s either way; parallel imports were serializing on the DB
anyway).

---

## 11. Verification performed

| Check                    | Result                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `npx tsc --noEmit`       | clean                                                                                                              |
| `npm run lint`           | 0 errors (3 pre-existing warnings)                                                                                 |
| `npx prettier --check`   | clean                                                                                                              |
| Full suite               | **424 passed / 26 files**                                                                                          |
| Migration re-runnability | executed twice, no error                                                                                           |
| OpenAPI spec             | 5 new operations registered; `SanitizedGatewayConfig` contains no secret field                                     |
| Credential leak audit    | canary secret absent from **all** console output, **all** DB columns, **all** audit rows across the full lifecycle |
| Fail-closed key guard    | throws as designed when the key is absent                                                                          |

The leak audit ran the complete lifecycle (save → test → connect → enable →
switch environment → failed probe) against a stubbed Hubtel with a canary
secret, and asserted the value never reached a log line, a database column, or
an audit row.

---

## 12. Deployment

### Required

```bash
npx prisma migrate deploy   # runs automatically via Render preDeployCommand
```

**`PAYMENT_GATEWAY_ENCRYPTION_KEY` must be set in the environment before
deploying.** Without it the first credential save throws. Generate one with the
command in §3.

### Optional

| Variable                                     | Purpose                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `HUBTEL_STATUS_API_BASE`                     | Override the status host (sandbox/staging). Defaults to `https://api-txnstatus.hubtel.com` |
| `HUBTEL_CLIENT_ID` / `HUBTEL_CLIENT_SECRET`  | Fallback credentials for deployments that never use the settings screen                    |
| `HUBTEL_MERCHANT_NUMBER` / `HUBTEL_BASE_URL` | Deployment topology — **environment-only, not managed in the console**                     |
| `PAYMENTS_ENABLED`                           | Legacy fallback toggle                                                                     |

### Rollback

Reverting to the previous commit restores static `HUBTEL_*` behavior; the
`payment_gateway_configs` row is simply ignored and the code falls back to
environment variables. The new table and column can stay. Because
`paymentProcessingEnabled` defaults to `false`, a fresh install after rollback
resumes the env-var path unchanged.

> **One row per provider, one environment field.** If Hubtel test and live
> require _separate_ credential pairs, this model must become
> per-environment (one row per `provider` + `environment`). That was the
> handoff's stated scope; the assumption is recorded here so it is not a
> surprise later.

---

## 13. Follow-ups

Not blocking, but worth tracking:

1. **Confirm the probe's `401`/`403` rule** against real sandbox credentials.
2. **Widen the role → scope map** if `FINANCE` should be able to manage
   processing without holding credentials.
3. **Transactional audit writes.** Config updates and their audit rows are
   separate operations; a crash between them leaves a state change with no
   audit entry. A single `prisma.$transaction` would close the gap.
4. **Optimistic concurrency.** Two admins editing simultaneously is last-write-
   wins. A `version` column or `updatedAt` precondition would surface the
   conflict.
5. **Connection validity TTL.** A `CONNECTED` status does not expire on its own.
6. **Rate limiting** the settings endpoints specifically.
7. **One row per environment** if test/live credentials diverge (§12).
