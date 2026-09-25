# Payment Gateway Settings — Frontend Integration Guide

Integration guide for the **admin payment gateway settings screen**. The backend
is complete, deployed, and documented in
[`payment-gateway-settings.md`](./payment-gateway-settings.md) (implementation
record — read it if you need the _why_).

This document covers what the frontend team needs: the contracts, the state
machine you must reflect in the UI, the error cases you must handle, and the
rules that will otherwise look like backend bugs.

---

## Table of Contents

1. [Who Can Use This](#who-can-use-this)
2. [The One Concept That Drives Everything](#the-one-concept-that-drives-everything)
3. [Response Envelope](#response-envelope)
4. [TypeScript Types](#typescript-types)
5. [Endpoint 1 — Read Settings](#endpoint-1--read-settings)
6. [Endpoint 2 — Save Credentials](#endpoint-2--save-credentials)
7. [Endpoint 3 — Test Connection](#endpoint-3--test-connection)
8. [Endpoint 4 — Connect](#endpoint-4--connect)
9. [Endpoint 5 — Processing Switch](#endpoint-5--processing-switch)
10. [Recommended UI Flow](#recommended-ui-flow)
11. [Error Handling](#error-handling)
12. [Rules That Will Bite You](#rules-that-will-bite-you)
13. [Reference Client](#reference-client)
14. [Testing Checklist](#testing-checklist)

---

## 1. Who Can Use This

**`SUPER_ADMIN` only.** All five endpoints return `403` for every other admin
role — including `FINANCE`, `ADMIN`, and `SUPPORT`.

The server enforces this. Hiding the nav item is cosmetic, so **also handle
`403` gracefully**: render an "insufficient permissions" state rather than a
blank screen, and don't rely on the nav guard as your only check.

```ts
if (response.status === 403) {
  showAccessDenied(); // role check is server-side; do not rely on hiding the menu
}
```

---

## 2. The One Concept That Drives Everything

There are **two independent facts**, and conflating them is the most common
integration mistake:

| Fact                       | Field              | Meaning                                          |
| -------------------------- | ------------------ | ------------------------------------------------ |
| Credentials are valid      | `connectionStatus` | "These credentials were verified at some point"  |
| They are valid _right now_ | `connected`        | "And for the **currently selected** environment" |

`connected` is derived by the server:

```ts
connected = connectionStatus === "CONNECTED" && connectedEnvironment === environment;
```

So after switching `TEST → LIVE`, you can legitimately see:

```json
{
  "connectionStatus": "CONNECTED",
  "connectedEnvironment": "TEST",
  "environment": "LIVE",
  "connected": false
}
```

**Use `connected` for every UI decision.** If you branch on `connectionStatus`
you will show a green "Connected" badge while payment processing is actually
switched off.

### The state machine

```
                        save new credentials
                       ┌──────────────────────────┐
                       │                          ▼
  (nothing saved) ──save──▶ configured ──connect──▶ CONNECTED ──enable──▶ processing ON
                       │        │                  │    ▲                    │
                  test │        │ (test alone)     │    │ connect             │ disable
                       ▼        ▼                  ▼    │                    ▼
                   lastTestedAt only        NOT_CONNECTED               processing OFF
                                          (or ERROR)
```

Three rules to encode in the UI:

1. **Processing cannot be switched on unless `connected` is `true`.** The
   server returns `409`. Disable the switch in the UI and explain why.
2. **Saving credentials or switching environment auto-disables processing.**
   Re-read the response and show the reason.
3. **Testing is not connecting.** A passing test updates `lastTestedAt` only. It
   does **not** change `connectionStatus`.

---

## 3. Response Envelope

Every endpoint uses the repository-wide envelope.

```ts
// Success
{ "success": true, "data": { ... }, "message"?: string }

// Error
{ "success": false, "error": string | { code: string, message: string } }
```

**`error` is not always a string.** Gate errors (`409`, and the credential guard
`400`) return an object:

```json
{
  "success": false,
  "error": {
    "code": "GATEWAY_NOT_CONNECTED",
    "message": "Payment processing cannot be enabled until…"
  }
}
```

Write your error extractor to handle both — this is a genuine trap:

```ts
function errorMessage(body: unknown): string {
  const err = (body as any)?.error;
  if (typeof err === "string") return err;
  if (err && typeof err.message === "string") return err.message;
  return "Something went wrong";
}

function errorCode(body: unknown): string | null {
  const err = (body as any)?.error;
  return err && typeof err === "object" && typeof err.code === "string" ? err.code : null;
}
```

### Validation errors are different again

`PUT` and `PATCH` are validated by middleware **before** the controller runs, and
that middleware uses a _different_ shape — an `errors` array, not `error`:

```json
{
  "success": false,
  "errors": [{ "path": "environment", "message": "Invalid enum value…" }]
}
```

```ts
function firstFieldError(body: any): { field: string; message: string } | null {
  const list = body?.errors;
  if (Array.isArray(list) && list.length > 0) {
    return { field: list[0].path, message: list[0].message };
  }
  return null;
}
```

So a `400` can arrive in **three** shapes depending on the endpoint. Handle all
three, or map them centrally in your API client.

---

## 4. TypeScript Types

Drop this in as-is.

```ts
export type GatewayEnvironment = "TEST" | "LIVE";
export type ConnectionStatus = "NOT_CONNECTED" | "CONNECTED" | "ERROR";
export type CredentialSource = "database" | "environment";

/** Shape of `GET /admin/settings/payment-gateway` → `data`. */
export interface SanitizedGatewayConfig {
  provider: "HUBTEL";
  environment: GatewayEnvironment;
  connectionStatus: ConnectionStatus;
  /** Environment the stored verification belongs to. May differ from `environment`. */
  connectedEnvironment: GatewayEnvironment | null;
  /** Authoritative: is the CURRENT environment verified? Use this in the UI. */
  connected: boolean;
  paymentProcessingEnabled: boolean;
  /** Presence flags only. The secret itself is never returned. */
  hasClientId: boolean;
  hasClientSecret: boolean;
  configured: boolean;
  credentialSource: CredentialSource;
  lastTestedAt: string | null;
  lastConnectedAt: string | null;
  /** "invalid_credentials" | "network" | "timeout" | "provider_error" | null */
  lastErrorCategory: string | null;
  processingDisabledReason: string | null;
  updatedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type GatewayErrorCode = "GATEWAY_NOT_CONNECTED" | "WOULD_LEAVE_NO_CREDENTIALS";
```

**There is no `clientSecret` field, and there never will be.** The secret is
write-only. Display it as a masked placeholder once `hasClientSecret` is `true`,
and never attempt to "edit" it — you can only replace or clear it.

---

## 5. Endpoint 1 — Read Settings

```
GET /admin/settings/payment-gateway
```

Bearer token required. No body.

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

| Status | Meaning           |
| ------ | ----------------- |
| `200`  | OK                |
| `401`  | Not authenticated |
| `403`  | Not `SUPER_ADMIN` |

### Interpreting the fresh-install case

Before anyone has saved anything, there is no database row. The endpoint
**still returns `200`** and describes the server's environment variables:

```json
{
  "environment": "TEST",
  "connectionStatus": "NOT_CONNECTED",
  "connected": false,
  "configured": false,
  "credentialSource": "environment",
  "createdAt": null,
  "updatedAt": null
}
```

This is deliberate — the screen should show the real deployment state rather
than an empty form for a gateway that is in fact working. Do **not** treat
`createdAt: null` as an error; it just means "no row yet".

`credentialSource: "environment"` means payments are running off env vars. A
banner prompting the admin to save credentials to the console is a nice touch.

---

## 6. Endpoint 2 — Save Credentials

```
PUT /admin/settings/payment-gateway
```

| Field               | Type               | Rules                                                   |
| ------------------- | ------------------ | ------------------------------------------------------- |
| `clientId`          | `string`           | Max 128. Trimmed server-side. Blank/omitted = no change |
| `clientSecret`      | `string`           | Max 512. Blank/omitted = **no change**                  |
| `clearClientSecret` | `boolean`          | The only way to remove a stored secret                  |
| `environment`       | `"TEST" \| "LIVE"` | Also needs `settings.payment.environment.manage`        |

At least one field must be present, or you get `400`.

### The most important rule in this document

> **A blank string means "no change", not "clear it".**

This is on purpose. A form that submits `clientSecret: ""` when the admin edits
the client ID must not destroy a working secret.

Consequences for your form:

- If the secret field is untouched, **omit the key entirely** — do not send `""`.
- To clear the secret, send an explicit `clearClientSecret: true`.
- After `clearClientSecret: true`, re-render the field as empty and disabled
  until a new secret is entered. The response's `hasClientSecret` will be
  `false`.

```ts
// Build the body: only include fields the admin actually filled in.
const body: Record<string, unknown> = {};
if (clientId.trim()) body.clientId = clientId.trim();
if (newSecret) body.clientSecret = newSecret; // never send ""
if (wantsToClearSecret) body.clearClientSecret = true; // explicit
if (newEnvironment) body.environment = newEnvironment;
```

### Clearing the last credential is rejected

`clearClientSecret: true` with no client ID stored returns `400`:

```json
{
  "success": false,
  "error": {
    "code": "WOULD_LEAVE_NO_CREDENTIALS",
    "message": "Cannot clear the client secret while no client ID is stored. Enter a Client ID first."
  }
}
```

Disable the clear button in that state rather than letting the admin hit it.

To be clear about the common case: clearing the secret **while a client ID is
stored is allowed** — that is the normal "rotate just the secret" path. Only the
case that would leave the row with no credentials at all is rejected.

### Response is the new state — re-render from it

`200` returns the full sanitized config, so you do not need a follow-up `GET`.
But **read it carefully**, because saving has side effects:

```ts
const { data } = await api.put("/admin/settings/payment-gateway", body);

// If the admin just changed credentials, processing was auto-disabled.
if (data.paymentProcessingEnabled === false && data.processingDisabledReason) {
  toast.warning(data.processingDisabledReason); // explain, don't silently re-enable
}
```

`processingDisabledReason` will be one of:

- `"Automatically disabled because payment credentials changed."`
- `"Automatically disabled because the gateway environment changed."`

Surfaces this so the admin understands why their switch flipped off. **Do not
auto-re-enable it** — that is a deliberate safety decision the backend made.

| Status | Meaning                                           |
| ------ | ------------------------------------------------- |
| `200`  | Saved; `data` is the new state                    |
| `400`  | Validation error, or `WOULD_LEAVE_NO_CREDENTIALS` |
| `401`  | Not authenticated                                 |
| `403`  | Not `SUPER_ADMIN`, or lacks the environment scope |

---

## 7. Endpoint 3 — Test Connection

```
POST /admin/settings/payment-gateway/test
```

**Non-mutating. It cannot move money.** Body is entirely optional.

| Body                         | Meaning                                            |
| ---------------------------- | -------------------------------------------------- |
| `{}` or omitted              | Test the **stored** credentials — the common case  |
| `{ clientId, clientSecret }` | Test credentials the admin has typed but not saved |
| `{ environment }`            | Test in a specific environment                     |

Testing unsaved credentials is a genuinely useful UX affordance: the admin can
verify what they just pasted **before** committing it to the database.

```ts
// Test what is stored
await api.post("/admin/settings/payment-gateway/test");

// Test what the admin just typed, without saving
await api.post("/admin/settings/payment-gateway/test", {
  clientId: form.clientId,
  clientSecret: form.clientSecret,
  environment: form.environment,
});
```

### Response

```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "Hubtel accepted the credentials.",
    "checkedAt": "2026-10-04T09:05:00.000Z",
    "retryable": false,
    "lastErrorCategory": null
  }
}
```

On failure the HTTP status carries the meaning, and `data` still describes what
happened:

| Status        | `data.retryable` | Show as                                          |
| ------------- | ---------------- | ------------------------------------------------ |
| `200`         | `false`          | ✅ Credentials accepted                          |
| `400`         | `false`          | ❌ Credentials rejected — fix the input          |
| `503`         | `true`           | ⚠️ Hubtel unreachable — offer a **Retry** button |
| `401` / `403` | —                | Auth / permission problem                        |

`400` vs `503` is the distinction that matters: **`400` is the admin's fault,
`503` is Hubtel's, and only `503` should show a retry affordance.**

### It does not connect

A passing test updates `lastTestedAt` only. `connectionStatus` is unchanged. If
your "Test" button implies the gateway is now live, you will mislead the admin.
Keep **Test** and **Connect** as separate actions with separate labels:

- "Test credentials" → `POST /test`
- "Connect gateway" → `POST /connect`

---

## 8. Endpoint 4 — Connect

```
POST /admin/settings/payment-gateway/connect
```

No body. Verifies the stored credentials and, only on success, marks the
gateway connected **for the currently selected environment**.

```json
{
  "success": true,
  "data": {
    "connectionStatus": "CONNECTED",
    "connectedAt": "2026-10-04T09:10:00.000Z",
    "environment": "TEST"
  }
}
```

Failure returns `502` with the server-derived state — do **not** optimistically
flip your UI to connected:

```json
{
  "success": false,
  "error": "Hubtel rejected these credentials. Check the Client ID and Client Secret.",
  "data": {
    "connectionStatus": "ERROR",
    "environment": "TEST",
    "lastErrorCategory": "invalid_credentials",
    "checkedAt": "2026-10-04T09:10:00.000Z"
  }
}
```

| Status        | Meaning                                                               |
| ------------- | --------------------------------------------------------------------- |
| `200`         | Connected                                                             |
| `401` / `403` | Auth / permission                                                     |
| `502`         | Verification failed — **including when no credentials are saved yet** |

Note there is **no `400`** here. Calling connect with nothing saved still returns
`502`, with `lastErrorCategory: "invalid_credentials_missing"` and the message
_"Client ID and Client Secret are both required before testing."_ So use
`lastErrorCategory` to distinguish "you haven't entered credentials yet" from
"Hubtel rejected what you entered", and point the admin at the right form:

```ts
if (error.status === 502) {
  const category = error.body?.data?.lastErrorCategory;
  if (category === "invalid_credentials_missing") {
    scrollToCredentialsForm();
  }
}
```

The screen should also just hide the **Connect** button until
`config.configured === true`, so this is rarely hit in practice.

### Error categories you can show

`lastErrorCategory` gives you a stable key for an actionable message:

| Category              | Show                                          |
| --------------------- | --------------------------------------------- |
| `invalid_credentials` | "Hubtel rejected these credentials"           |
| `network`             | "Could not reach Hubtel — check connectivity" |
| `timeout`             | "Hubtel did not respond in time — try again"  |
| `provider_error`      | "Hubtel returned an unexpected response"      |

The backend already sends a human-readable `error` string; prefer it, and use
`lastErrorCategory` for icon/colour selection.

---

## 9. Endpoint 5 — Processing Switch

```
PATCH /admin/settings/payment-gateway/processing
```

| Field     | Type      | Rules             |
| --------- | --------- | ----------------- |
| `enabled` | `boolean` | **Required**      |
| `reason`  | `string`  | Optional, max 500 |

```json
{
  "success": true,
  "data": { "paymentProcessingEnabled": true, "effectiveAt": "2026-10-04T09:15:00.000Z" }
}
```

### The 409 you must handle

Enabling while the current environment is unconnected:

```json
{
  "success": false,
  "error": {
    "code": "GATEWAY_NOT_CONNECTED",
    "message": "Payment processing cannot be enabled until the gateway is connected in the LIVE environment. Use \"Connect\" first."
  }
}
```

```ts
if (response.status === 409) {
  setBanner("Connect the gateway before enabling payment processing.");
  refreshSettings(); // re-read; the server may have auto-disabled something
  return;
}
```

Better: prevent it. Grey out the switch unless `connected === true`, with the
reason as a tooltip. Then the `409` becomes a safety net rather than the
primary flow.

### Disabling always works

Turning processing **off** is never blocked, even when the gateway is
unhealthy. That is deliberate — it is the operational kill switch. **Never
disable the "off" control.**

### Effects are immediate

The switch takes effect within ~10 seconds (server-side cache TTL). No restart,
no deploy. The public `GET /payment/status` reflects it, so the mobile app picks
it up on its next poll.

| Status        | Meaning                            |
| ------------- | ---------------------------------- |
| `200`         | Updated                            |
| `400`         | `enabled` missing or not a boolean |
| `401` / `403` | Auth / permission                  |
| `409`         | Enabling while unconnected         |

### Your public app-side counterpart

If the mobile app also gates payment screens, poll the **public** endpoint:

```
GET /payment/status     →  { "success": true, "data": { "enabled": boolean, "reason": string | null } }
```

When `enabled` is `false`, payment initialization endpoints return `503` and the
app should skip the checkout screen entirely. `reason` is safe to show to users.

---

## 10. Recommended UI Flow

```
        ┌──────────────────────────────┐
        │  GET /payment-gateway        │
        └──────────────┬───────────────┘
                       │
         credentialSource === "environment"?
              │                │
             yes               no
     "Credentials come from    │
      env vars — save here     │
      to manage them"          │
              │                │
              └───────┬────────┘
                      ▼
        ┌──────────────────────────────┐
        │  Credentials section         │
        │  clientId    [___________]   │
        │  clientSecret[••••••••••]    │  ← masked if hasClientSecret
        │                              │
        │  [Test credentials] [Save]   │
        │  [Clear secret]              │
        └──────────────┬───────────────┘
                       ▼
              POST /test  →  ✅ / ❌ / ⚠️
                       │
                       ▼
        ┌──────────────────────────────┐
        │  Environment  [ TEST | LIVE ]│
        │  ⚠️ switching auto-disables   │
        │     payment processing       │
        └──────────────┬───────────────┘
                       ▼
        ┌──────────────────────────────┐
        │  [Connect gateway]           │  → POST /connect
        │  status: ● Connected (TEST)  │
        └──────────────┬───────────────┘
                       │ connected === true
                       ▼
        ┌──────────────────────────────┐
        │  Payment processing  [ ON ]  │  → PATCH /processing
        └──────────────────────────────┘
```

### Component state you need

```ts
const [config, setConfig] = useState<SanitizedGatewayConfig | null>(null);
const [testing, setTesting] = useState(false);
const [connecting, setConnecting] = useState(false);
const [saving, setSaving] = useState(false);
const [toggling, setToggling] = useState(false);
const [banner, setBanner] = useState<{ kind: "error" | "warn" | "info"; text: string } | null>(
  null,
);

// Drive every control from the server state, never from local optimism.
const canConnect = config !== null && config.configured && !config.connected;
const canEnableProcessing = config !== null && config.connected && !config.paymentProcessingEnabled;
```

### Show the environment prominently

The single most valuable piece of information on this screen is **which
environment is active**, because a `LIVE` switch with `TEST` credentials would
be a serious mistake. Render it as a high-contrast badge, not a subtle label.

---

## 11. Error Handling

Complete matrix of what each endpoint can return:

| Endpoint            | `400`                                    | `401` | `403` | `409`           | `502` | `503`       |
| ------------------- | ---------------------------------------- | ----- | ----- | --------------- | ----- | ----------- |
| `GET`               | —                                        | ✔     | ✔     | —               | —     | —           |
| `PUT`               | validation, `WOULD_LEAVE_NO_CREDENTIALS` | ✔     | ✔     | —               | —     | —           |
| `POST /test`        | credentials rejected or missing          | ✔     | ✔     | —               | —     | ✔ retryable |
| `POST /connect`     | —                                        | ✔     | ✔     | —               | ✔     | —           |
| `PATCH /processing` | `enabled` invalid                        | ✔     | ✔     | ✔ not connected | —     | —           |

### Suggested handling

| Status | User-facing behaviour                             |
| ------ | ------------------------------------------------- |
| `400`  | Field-level error on the offending input          |
| `401`  | Redirect to login — the token expired             |
| `403`  | "You don't have permission" screen                |
| `409`  | Banner + re-fetch settings + nudge toward Connect |
| `502`  | Show provider message, keep the form usable       |
| `503`  | "Hubtel is unreachable" + **Retry** button        |
| `500`  | Generic failure, offer retry                      |

### Never optimistically assume success

`POST /connect` and `PATCH /processing` both return the authoritative state.
Render **from the response**, not from an assumption that the call worked. The
server is explicit about this: the returned status is always server-derived.

---

## 12. Rules That Will Otherwise Look Like Backend Bugs

**1. A successful test does not connect.**
`lastTestedAt` updates; `connectionStatus` does not. Separate buttons, separate
labels.

**2. Saving credentials turns processing off.**
This is intentional — money movement must not survive a credential change. Show
`processingDisabledReason` so it doesn't look arbitrary.

**3. Switching environment also turns processing off.**
Same reason, and `connected` becomes `false` because the verification belongs to
the old environment. Warn **before** the admin switches.

**4. Blank does not clear.**
Send nothing rather than `""`. Use `clearClientSecret: true` to remove.

**5. `connectionStatus` can be `CONNECTED` while `connected` is `false`.**
Not a bug — the status is environment-scoped. Trust `connected`.

**6. `error` is sometimes a string and sometimes an object.**
Use the extractor in §3. `400` validation errors use a third shape entirely
(`errors[]`).

**7. The secret is write-only.**
No endpoint returns it. Don't build a "reveal" or "edit" affordance — offer
**replace** and **clear** instead.

**8. Fresh install returns `200`, not `404`.**
`createdAt: null` and `credentialSource: "environment"` are normal.

**9. Disable is never blocked, enable often is.**
Don't grey out the "off" position. Grey out "on" when `connected === false`.

**10. The test/live model has one credential pair.**
`environment` is a single field on one row, so `TEST` and `LIVE` share the same
stored credentials. Only the connection verification is per-environment. If the
business later needs separate test credentials, the API will gain a
per-environment model — keep your UI abstracted away from
`PUT`-one-row assumptions.

---

## 13. Reference Client

A thin wrapper covering the envelope quirks from §3.

```ts
// api/paymentGateway.ts
import type { SanitizedGatewayConfig, GatewayEnvironment } from "../types/paymentGateway";

const BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://dagh-server-fo64.onrender.com";

async function request<T>(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new GatewayApiError(res.status, body);
  }
  return body.data as T;
}

export class GatewayApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: any,
  ) {
    super(errorMessage(body) || `Request failed (${status})`);
    this.name = "GatewayApiError";
  }
  get code(): string | null {
    return errorCode(this.body);
  }
  get fieldError(): { field: string; message: string } | null {
    return firstFieldError(this.body);
  }
  get retryable(): boolean {
    return this.body?.data?.retryable === true;
  }
}

function errorMessage(body: any): string {
  const e = body?.error;
  if (typeof e === "string") return e;
  if (e && typeof e.message === "string") return e.message;
  const list = body?.errors;
  if (Array.isArray(list) && list[0]?.message) return list[0].message;
  return "";
}
function errorCode(body: any): string | null {
  const e = body?.error;
  return e && typeof e === "object" && typeof e.code === "string" ? e.code : null;
}
function firstFieldError(body: any) {
  const list = body?.errors;
  return Array.isArray(list) && list.length
    ? { field: list[0].path, message: list[0].message }
    : null;
}

export const paymentGateway = {
  getSettings: () => request<SanitizedGatewayConfig>("/admin/settings/payment-gateway"),

  /** Send only fields the admin actually changed. Never send `clientSecret: ""`. */
  save: (body: {
    clientId?: string;
    clientSecret?: string;
    clearClientSecret?: boolean;
    environment?: GatewayEnvironment;
  }) =>
    request<SanitizedGatewayConfig>("/admin/settings/payment-gateway", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  /** Omit the body entirely to test the stored credentials. */
  test: (body?: { clientId?: string; clientSecret?: string; environment?: GatewayEnvironment }) =>
    request<{ success: boolean; message: string; checkedAt: string; retryable: boolean }>(
      "/admin/settings/payment-gateway/test",
      { method: "POST", body: JSON.stringify(body ?? {}) },
    ),

  connect: () =>
    request<{
      connectionStatus: string;
      connectedAt: string | null;
      environment: GatewayEnvironment;
    }>("/admin/settings/payment-gateway/connect", { method: "POST" }),

  setProcessing: (enabled: boolean, reason?: string) =>
    request<{ paymentProcessingEnabled: boolean; effectiveAt: string }>(
      "/admin/settings/payment-gateway/processing",
      { method: "PATCH", body: JSON.stringify({ enabled, reason }) },
    ),
};
```

### Usage with the awkward cases handled

```ts
// Save without accidentally clearing the secret
async function onSave(form: FormState) {
  const body: Record<string, unknown> = {};
  if (form.clientId.trim()) body.clientId = form.clientId.trim();
  if (form.newSecret) body.clientSecret = form.newSecret;
  if (form.clearSecret) body.clearClientSecret = true;
  if (form.environment !== current.environment) body.environment = form.environment;

  try {
    const updated = await paymentGateway.save(body);
    setConfig(updated);
    resetSecretField();
    if (!updated.paymentProcessingEnabled && updated.processingDisabledReason) {
      toast.warning(updated.processingDisabledReason);
    }
  } catch (e) {
    if (e instanceof GatewayApiError && e.code === "WOULD_LEAVE_NO_CREDENTIALS") {
      setFieldError("clientId", e.message);
    } else if (e instanceof GatewayApiError && e.fieldError) {
      setFieldError(e.fieldError.field, e.fieldError.message);
    } else {
      toast.error((e as Error).message);
    }
  }
}

// Test, distinguishing "wrong password" from "Hubtel is down"
async function onTest(inFlight?: { clientId: string; clientSecret: string }) {
  setTesting(true);
  try {
    await paymentGateway.test(inFlight);
    toast.success("Hubtel accepted these credentials.");
  } catch (e) {
    if (e instanceof GatewayApiError && e.retryable) {
      toast.warning("Hubtel is unreachable. Please try again.");
    } else {
      toast.error((e as Error).message);
    }
  } finally {
    setTesting(false);
  }
}

// Enable, with the 409 handled as a nudge rather than an error
async function onEnableProcessing() {
  try {
    const data = await paymentGateway.setProcessing(true);
    setConfig((c) => (c ? { ...c, paymentProcessingEnabled: data.paymentProcessingEnabled } : c));
  } catch (e) {
    if (e instanceof GatewayApiError && e.status === 409) {
      setBanner({ kind: "warn", text: "Connect the gateway before enabling payments." });
      await reload();
    } else {
      toast.error((e as Error).message);
    }
  }
}
```

---

## 14. Testing Checklist

**Read path**

- [ ] Screen loads with `GET` returning `200` on a fresh install
- [ ] `credentialSource: "environment"` surfaces a hint banner
- [ ] Secret renders masked when `hasClientSecret` is `true`, with no reveal action
- [ ] Active environment is visually prominent

**Credentials**

- [ ] Editing the client ID and saving does **not** clear the stored secret
- [ ] Sending an untouched secret field changes nothing
- [ ] "Clear secret" requires an explicit confirm step
- [ ] Clear is disabled when it would leave no credentials
- [ ] Over-length input surfaces a field-level `400`

**Test connection**

- [ ] Empty body tests the stored credentials
- [ ] Typed-but-unsaved credentials can be tested
- [ ] `200` shows success, `400` shows "rejected", `503` shows a **Retry** button
- [ ] Success does **not** change the connected indicator

**Connect**

- [ ] Success updates the badge to Connected
- [ ] `502` shows the provider message and leaves the form usable
- [ ] No optimistic flip before the response arrives

**Processing switch**

- [ ] Switch is disabled with a tooltip when `connected === false`
- [ ] `409` shows a banner and refreshes state
- [ ] Turning **off** is always available, even when unhealthy
- [ ] Auto-disable after a credential or environment change is explained via
      `processingDisabledReason`

**Access**

- [ ] Non-`SUPER_ADMIN` accounts get a permission screen, not a blank screen
- [ ] `401` redirects to login

**Cross-cutting**

- [ ] `error` handled as both string and object
- [ ] `errors[]` validation shape handled
- [ ] No secret ever written to logs, analytics, or error reporting
- [ ] Re-check `GET /payment/status` in the mobile app to confirm the switch
      propagates within ~10s

---

## Related Documentation

| Document                                                       | Contents                                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`payment-gateway-settings.md`](./payment-gateway-settings.md) | Implementation record: schema, encryption design, state machine, probe internals, deployment |
| [`payment-control-system.md`](./payment-control-system.md)     | The legacy `PAYMENTS_ENABLED` toggle, public status endpoint, enforcement points             |
| [`admin-console-api.md`](./admin-console-api.md)               | Wider admin console surface and frontend wiring patterns                                     |
| `/api-docs`                                                    | Live Swagger UI with request/response schemas for all five endpoints                         |
