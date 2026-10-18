# DAGH Admin API — Endpoint Reference

**Generated from the registered Express routes and their controllers**  
**API base:** `https://<API_HOST>` (local development: `http://localhost:5000`)  
**Route prefix:** `/admin` unless another prefix is shown  
**Last reviewed:** 9 October 2026

This document describes the admin-facing endpoints currently implemented in this repository. It includes the `/admin/*` API, admin-only community content operations, and other admin-gated endpoints mounted under `/tours`, `/faq`, and `/data-policy`. It documents the runtime controller behavior where it differs from older Swagger comments or handoff notes.

## 1. Conventions and access

### Authentication

Protected endpoints require a completed admin session:

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

The admin login flow starts at the application's `POST /auth/login`. Admin MFA can return a short-lived `mfaToken`; that token is only for the MFA verification endpoints and is not accepted as an access token. After MFA succeeds, use the returned `accessToken` and `refreshToken` as the session credentials.

`GET /admin/departments` and `POST /admin/auth/register` are public. The registration endpoint creates an admin account with `accountStatus: "PENDING"`; an authorized admin must approve it using `PATCH /admin/users/:userId/approve` before normal access is available. If `ADMIN_OFFICIAL_EMAIL_DOMAIN` is configured, registration is limited to that email domain.

Authorization is role-scoped. Admin-only routes generally return `403` when the account or role lacks the required permission. The payment gateway configuration routes use an additional scope guard; currently those scopes are granted only to `SUPER_ADMIN`. A missing/invalid/expired access token is normally rejected by `protectedRoute` with `401`.

### Response envelopes

Most endpoints use these helpers:

```json
{ "success": true, "data": {}, "message": "Optional status message" }
```

```json
{ "success": false, "error": "Readable error or error object", "details": {} }
```

Paginated endpoints return:

```json
{
  "success": true,
  "data": [],
  "pagination": { "total": 0, "page": 1, "limit": 20, "totalPages": 0 }
}
```

Created resources generally use HTTP `201`; ordinary success is `200`. Exceptions are noted below (for example, `/admin/settings/payment-gateway/test` returns `503` for retryable provider failures). A few legacy routes have a different response shape; those are explicitly called out.

### Common query behavior

- Pagination is 1-based, defaults to `page=1` and `limit=20`, and clamps the limit to 1–100, unless noted otherwise.
- Date filters use `from` and `to` on `createdAt`; the end date is inclusive through the end of that day.
- Unknown enum filters are ignored in the visa and payment console list routes.
- Timestamps are ISO-8601 date-time strings. Amounts use the payment record currency (normally `GHS`).

### Common errors

- `400 Bad Request`: invalid input, unsupported action, or a state/business rule that prevents the operation.
- `401 Unauthorized`: protected route called without a valid access token.
- `403 Forbidden`: admin account or required permission is missing. Permission middleware uses `{ success:false, error:{ code:"INSUFFICIENT_PERMISSION", message, scope? } }`.
- `404 Not Found`: referenced user, request, report, grant, plan, video, FAQ, or policy does not exist.
- `409 Conflict`: duplicate resource, already-revoked grant, or payment gateway not connected when attempting to enable processing.
- `500 Internal Server Error`: unexpected database or server failure. The error message is usually safe to show; log server diagnostics separately.

## 2. Endpoint index

| Group | Routes |
|---|---|
| Admin registration and MFA | `GET /admin/departments`; `POST /admin/auth/register`; `/admin/auth/2fa/*` |
| Dashboard and users | `/admin/dashboard/summary`; `/admin/users*` |
| Visa requests | `/admin/visa-requests*` |
| Payments and gateway | `/admin/payments*`; `/admin/settings/payment-gateway*` |
| Plans and access grants | `/admin/plans*`; `/admin/access-grants*`; `/admin/users/:userId/access` |
| Moderation and verification | `/admin/reports*`; `/admin/profile-verifications*` |
| Roles and notifications | `/admin/roles`; `/admin/notifications*` |
| Community content | `/community/admin/*`; `/community/videos/:videoId/analytics` |
| Other admin-gated resources | `/tours*`; `/faq/admin*`; `/data-policy/admin/policy` |

## 3. Registration, departments, and MFA

### `GET /admin/departments` — public

Returns data for the admin registration form:

```json
{
  "success": true,
  "data": {
    "departments": ["EXECUTIVE_MANAGEMENT", "OPERATIONS_AND_MEMBERSHIP", "FINANCE_AND_COMPLIANCE", "TECHNICAL_SUPPORT"],
    "roles": ["SUPER_ADMIN", "OPERATIONS", "FINANCE", "SUPPORT"],
    "rolesByDepartment": {
      "EXECUTIVE_MANAGEMENT": ["SUPER_ADMIN"],
      "OPERATIONS_AND_MEMBERSHIP": ["OPERATIONS"],
      "FINANCE_AND_COMPLIANCE": ["FINANCE"],
      "TECHNICAL_SUPPORT": ["SUPPORT"]
    }
  }
}
```

There is no controller-level error response for this static lookup.

### `POST /admin/auth/register` — public

Creates a pending administrator. Required JSON fields: `fullName` (at least 2 characters), `email`, `password` (at least 8 characters, uppercase, lowercase, number, and special character), `department`, and `role`. Optional `phoneNumber` must be E.164. The selected role must belong to the selected department.

Success is `201` with `{ success:true, data: <created user plus adminProfile>, message:"Admin registered successfully" }`. `passwordHash` is omitted. `accountType` is `ADMIN` and `accountStatus` is `PENDING`.

Errors: `400` invalid registration, existing email (`User already exists`), or duplicate phone (`Phone number already in use`); `403` configured official-email-domain restriction; `500` `Admin registration failed`.

### MFA sign-in endpoints

- `POST /admin/auth/2fa/verify` — Body: `{ "mfaToken":"…", "code":"123456", "method":"SMS|TOTP", "useBackupCode":false }`. Verifies the factor and returns `data` with user identity, `adminRole`, `department`, `permissions`, `accessToken`, and `refreshToken`. `method` may be omitted to use the configured method. To use a backup code, set `useBackupCode:true` or use `/admin/auth/2fa/backup-codes/verify`. Errors: `400` missing required values or TOTP not configured; `401` invalid/expired MFA token or invalid code; `403` not an admin; `500` verification failure.
- `POST /admin/auth/2fa/resend` — Body: `{ "mfaToken":"…" }`. Creates a new SMS challenge and returns `{ success:true, data:{ sent:true }, message:"Verification code sent" }`. The code itself is not returned. Errors: `400` missing token, `401` invalid/expired token, `429` resend cooldown (30 seconds), `500` resend failure.
- `POST /admin/auth/2fa/backup-codes/verify` — Body: `{ "mfaToken":"…", "code":"DAGH-XXXX-XXXX" }`. A valid code can only be used once. Success returns the same session payload as MFA verify. Errors: `400` missing values; `401` invalid/expired MFA token or invalid backup code; `403` not an admin; `500` verification failure.

### Authenticated MFA settings

These three endpoints require an access token and `settings.view` permission.

- `POST /admin/auth/2fa/totp/setup` — no body. Returns provisioning data in `data` (including the authenticator URI, manual key, and shared secret). It stores a pending secret; MFA is not enabled until verified. Errors: `401`, `403`, `500`.
- `POST /admin/auth/2fa/totp/verify` — Body: `{ "code":"123456" }`. Confirms the secret and returns `{ mfaEnabled:true, mfaMethod:"TOTP" }`. Errors: `400` missing code, setup not started, or invalid code; `401`, `403`, `500`.
- `POST /admin/auth/2fa/backup-codes` — no body. Returns `201` with `{ backupCodes:["…", ...] }` (10 plaintext codes, shown once; only hashes are stored). Save these at generation time. Errors: `401`, `403`, `500`.

## 4. Dashboard and user management

### `GET /admin/dashboard/summary`

Requires `dashboard.view`. No query parameters. Returns aggregate KPI data:

```json
{
  "success": true,
  "data": {
    "tours": { "total": 4, "bulk": 4, "custom": 0 },
    "pendingVisaRequests": 4,
    "successfulPaymentsAmount": 8906,
    "successfulPaymentsMoMPercent": 12.5,
    "alerts": {
      "pendingVisaRequests": 4,
      "pendingReports": 0,
      "pendingProfileVerifications": 0,
      "failedPaymentsLast24h": 1
    }
  }
}
```

Revenue is successful payments only; month-over-month compares this calendar month to the previous month. Reviewable visa statuses are `PENDING`, `READY_FOR_GIS_SUBMISSION`, and `EXPEDITED_AIRPORT_PAYMENT_PENDING`. Errors: `403`, `500` (`Failed to build dashboard summary`).

### `GET /admin/users/verified?page=1&limit=20`

Requires `users.view`. Returns `{ success:true, data:{ data:[...], pagination:{...}, counts:{ verifiedUsers, totalUsers } } }`. Each item includes verification `id`, `isVerified`, `verifiedAt`, section booleans (`phoneVerified`, `ipAddressVerified`, `bioProfileVerified`, `documentVerified`), and a nullable `user` with `id`, `fullName`, `email`, `phoneNumber`, `accountStatus`, and `createdAt`. Errors: `403`, `500`.

### User directory: `GET /admin/users?page=1&limit=20`

Requires `users.view`. Returns a standard paginated list ordered newest first. Each user has `id`, `fullName`, `email`, `phoneNumber`, `accountType`, `accountStatus`, `authProvider`, `createdAt`, and `lastLoginAt`. No search or status filters are implemented. Errors: `401`/`403`; `500` with `error:"Failed to fetch users"` and optional `details`.

### User actions

All paths use `:userId`. Mutations return `{ success:true, data:<selected updated user>, message:<status> }`, unless noted.

- `PATCH /admin/users/:userId/promote` — Requires `users.edit`. Sets `accountType=ADMIN`. Data: `{id, fullName, email, accountType}`. Errors: `400` already an admin; `404` user not found; `403`; `500`.
- `PATCH /admin/users/:userId/demote` — Requires `users.edit`. Sets `accountType=USER`. Same data shape. Errors: `400` already a regular user; `404`; `403`; `500`.
- `PATCH /admin/users/:userId/suspend` — Requires `users.suspend`. Sets `accountStatus=SUSPENDED`. Data: `{id, fullName, email, accountStatus}`. Errors: `400` already suspended; `404`; `403`; `500`.
- `PATCH /admin/users/:userId/reactivate` — Requires `users.edit`. Sets `accountStatus=ACTIVE`. Same data shape. Errors: `400` already active; `404`; `403`; `500`.
- `PATCH /admin/users/:userId/terminate` — Requires `users.terminate`. Body: `{ "reason":"Required explanation" }`. Sets `accountStatus=TERMINATED`; returns `{id,fullName,email,accountStatus}`. Errors: `400` missing reason or already terminated; `404`; `403`; `500`.
- `PATCH /admin/users/:userId/approve` — Requires `users.approve`. Only a `PENDING` user can be approved; status becomes `ACTIVE`. Returns `{id,fullName,email,accountStatus}`. Errors: `400` not pending; `404`; `403`; `500`.
- `PATCH /admin/users/:userId/reject` — Requires `users.reject`. Body: `{ "reason":"Required explanation" }`. Only a `PENDING` user can be rejected; status becomes `SUSPENDED`. Returns `{id,fullName,email,accountStatus}`. Errors: `400` missing reason or not pending; `404`; `403`; `500`.
- `DELETE /admin/users/:userId` — Requires `users.delete`. Permanently removes the account and returns `{success:true,data:null,message:"User deleted successfully"}`. Errors: `404` user not found; `403`; `500` (`Failed to delete user`).

## 5. Visa request management

These endpoints require `settings.full`.

### `GET /admin/visa-requests`

Paginated newest-first queue. Filters: `page`, `limit`, `status` (any defined visa-request status), `q` (passport number, trip purpose, applicant name/email), `from`, and `to`.

List row includes the visa request fields plus `user:{id,fullName,email,phoneNumber}`, `visaData:{passport_number,purpose_of_trip,date_of_arrival,date_of_departure}`, `approval:{status,approvedAt,notes}` or null, and `payment:{id,amount,status}` or null. The payment is looked up from `paymentId`. Response uses the standard paginated envelope. Errors: `403`, `500` (`Failed to list visa requests`).

### `GET /admin/visa-requests/stats?from=YYYY-MM-DD&to=YYYY-MM-DD`

Returns `data:{ total, pendingReview, rejected, approvedToday, rejectionRate }`. `pendingReview` counts `PENDING`, `READY_FOR_GIS_SUBMISSION`, and `EXPEDITED_AIRPORT_PAYMENT_PENDING`; `rejectionRate` is a percentage. Errors: `403`, `500`.

### `GET /admin/visa-requests/:id`

Returns `{ success:true, data:<request> }` with full user details, complete `visaData`, `payment` row or null, `approval` row or null, and `activityLogs` newest first (each log includes actor identity). Errors: `404` `Visa request not found`; `403`; `500`.

### `POST /admin/visa-requests/:id/approve` and `/reject`

Optional JSON body: `{ "note":"Optional review note" }`. These actions update the request and approval row transactionally and add an admin activity record. Success returns `data:{ request, approval }` and a message. Repeating the same decision succeeds idempotently and returns the existing request with an “already approved/rejected” message. Errors: `404` request not found; `403`; `500`.

### Legacy visa routes

- `GET /admin/visa-requests/paid` — Returns `data:[...]` (not paginated), limited to `READY_FOR_GIS_SUBMISSION` and `EXPEDITED_AIRPORT_PAYMENT_PENDING`, with applicant `{id,fullName,email}`, full `visaData`, and approval record. Errors: `403`, `500` (`Failed to get paid visa requests`).
- `POST /admin/visa-requests/approve` — Body `{ "requestId":"…" }`. Returns `{visaRequest,approval}` on a new approval or the current request with an “already approved” message. Errors: `400` missing requestId, `404` request not found, `403`, `500`. Prefer the id-based `/admin/visa-requests/:id/approve` route for new clients.

## 6. Payment monitoring and controls

### `GET /admin/payments`

Requires `payments.view`. Filters: `page`, `limit`, `status` (`INITIALIZED|PENDING|SUCCESS|FAILED`), `targetType`, `q` (reference/user name/email), `from`, `to`. Returns paginated payment rows with `id`, `reference`, `description`, `targetType`, `targetId`, `amount`, `currency`, `status`, `method`, `provider`, `paidAt`, `createdAt`, and `user:{id,fullName,email}`. Errors: `403`, `500`.

### `GET /admin/payments/stats?from=…&to=…`

Requires `payments.view`. Returns `data:{totalRevenue,successCount,pendingCount,pendingAmount,failedCount,successRate}`. Revenue sums successful payments; pending includes `PENDING` and `INITIALIZED`; success rate is successes divided by successes plus failures, as a percentage. Errors: `403`, `500`.

### Legacy payment control: `/admin/payments/status`

- `GET /admin/payments/status` — Requires `payments.view`. Returns current control metadata, including `enabled`, `reason`, `updatedAt`, and `updatedBy`.
- `PATCH /admin/payments/status` — Requires `payments.toggle`. Body `{ "enabled":true, "reason":"Optional note (max 500 chars)" }`. Returns updated details and an enable/disable message. Errors: `400` invalid body; `403`; `409` when enabling while gateway is not connected for the selected environment; `500`.

## 7. Payment gateway configuration

These routes are additionally protected by payment-gateway scopes currently assigned only to `SUPER_ADMIN`. The client secret is write-only: read responses expose only `hasClientSecret`, never the secret itself.

- `GET /admin/settings/payment-gateway` — Requires `settings.payment.view`. Returns sanitized configuration: environment, client ID, `hasClientSecret`, connection and processing state, and relevant update/test timestamps. If no stored configuration exists, values are derived from `HUBTEL_*` environment variables and `credentialSource` is `environment`. Errors: `401`, `403`, `500`.
- `PUT /admin/settings/payment-gateway` — Requires `settings.payment.credentials.manage`; changing `environment` additionally requires `settings.payment.environment.manage`. Partial JSON body may contain `clientId`, `clientSecret`, `clearClientSecret`, and `environment` (`TEST|LIVE`). Empty or omitted credentials mean no change. Removing a stored secret requires `clearClientSecret:true`. Changing credentials revokes verification and disables payment processing. Returns updated sanitized config. Errors: `400` invalid input or attempting to clear the last remaining credential; `403`; `500`.
- `POST /admin/settings/payment-gateway/test` — Requires `settings.payment.connection.test`. Optional body can supply unsaved `clientId`, `clientSecret`, and `environment`; an empty body tests stored credentials. This is a read-only Hubtel check and does not change connection status. Returns `data:{success,message,checkedAt,retryable,lastErrorCategory}`. HTTP status is `200` accepted, `400` locally missing/rejected credentials, `503` retryable provider timeout/unavailable, `403`, or `500`.
- `POST /admin/settings/payment-gateway/connect` — Requires `settings.payment.connection.manage`. Verifies stored credentials and marks the currently selected environment connected. Success returns `data:{connectionStatus:"CONNECTED",connectedAt,environment}`. Errors: `502` verification/provider failure (response includes current state and error category); `403`; `500`.
- `PATCH /admin/settings/payment-gateway/processing` — Requires `settings.payment.processing.manage`. Body `{ "enabled":true, "reason":"Optional reason, max 500 chars" }`. Returns `data:{paymentProcessingEnabled,effectiveAt}`. Disabling is always allowed; enabling requires a verified connection. Errors: `400` validation; `409` not connected; `403`; `500`.

## 8. Membership plans and access grants

### Membership plan routes

All require `settings.full`.

- `GET /admin/plans?active=true|false` — Returns `{success:true,data:[plan...]}` ordered by price. `active` is optional.
- `POST /admin/plans` — Body requires `code`, `name`, `price`, and `interval`; optional `description`, `currency` (default `GHS`), `features` (string array), `isMostPopular`, `isActive`. Tier codes are the supported `MembershipTierCode` values; intervals are `MONTHLY|ANNUAL|BIENNIAL|CUSTOM`. Returns `201` with the created plan.
- `PATCH /admin/plans/:id` — Partial update of name, description, price, currency, interval, features, `isMostPopular`, and `isActive`. Returns updated plan.
- `POST /admin/plans/:id/toggle` — Flips `isActive`; returns updated plan.
- `DELETE /admin/plans/:id` — Permanently deletes the plan; returns `data:null`.

All mutations return the standard success envelope with a message and write an admin activity log. Errors: `400` invalid plan code or billing interval; `404` plan not found; `409` duplicate plan code (`PLAN_ALREADY_EXISTS`); `403`; `500`. Plan deletion may also fail with `500` if a database constraint prevents removal.

### Complimentary access grants

List/read endpoints require `users.view`; create/update/revoke require `users.edit`.

- `GET /admin/access-grants?userId=…&tierCode=…&status=active|revoked|expired` — Returns an array with the grant, target user, granting admin, and revoking admin where applicable. `active` means started, not revoked, and before end date. No pagination is implemented.
- `POST /admin/access-grants` — Required body: `{userId,tierCode,reason}`. Optional `includePaidPerks` (default false), `startDate` (defaults now), and nullable `endDate` (omit/null means perpetual). Grants do not auto-renew and coexist with paid subscriptions. Returns `201` with the grant. A live grant of the same tier is rejected.
- `PATCH /admin/access-grants/:id` — Updates any supplied `tierCode`, `includePaidPerks`, `reason`, `startDate`, and `endDate`. Setting `endDate` in the past ends access while preserving the record. Returns updated grant. Revoked grants cannot be edited.
- `POST /admin/access-grants/:id/revoke` — Optional body `{ "reason":"Optional audit note" }`. Soft-revokes the grant and retains its audit history; returns updated grant.
- `GET /admin/users/:userId/access` — Returns `{user,effectiveAccess,subscription,grants}`. `subscription` is null when absent; grant history includes the granting/revoking administrator.

Errors: `400` invalid payload/date range (`endDate` must be after `startDate`); `404` user or grant not found; `409` an active same-tier grant exists, or a grant is already revoked/cannot be modified; `403`; `500`.

## 9. Moderation and profile verification

### User reports

- `GET /admin/reports?status=PENDING|REVIEWING|RESOLVED|DISMISSED|ALL&page=1&limit=20` — Requires `reports.view`. Returns a paginated list with `reporter:{id,fullName,email}`, `target:{id,fullName,email,accountStatus}`, status, resolution note, and creation time. Missing status and `ALL` return all reports. Errors: `403`, `500`.
- `PATCH /admin/reports/:reportId` — Requires `reports.manage`. Body `{ "status":"REVIEWING|RESOLVED|DISMISSED", "resolutionNote":"Optional" }`. Returns the updated report. Closed statuses set resolver and resolved timestamp; moving to `REVIEWING` clears them. Errors: `404` report not found; `500`. The current route has no schema-validation middleware; unsupported status values may surface as `500` from persistence rather than a clean `400`.
- `POST /admin/reports/:reportId/suspend` — Requires `users.suspend`; no body. Suspends the report target and resolves the report. Returns `data:{user,reportId}`. Errors: `404` report not found; `403`; `500`.

### Profile verifications

- `GET /admin/profile-verifications` — Requires `dating.view`. Returns an unpaginated array newest-updated first. Each row contains verification state, `faceScanUrl`, document URLs/type/number, section summaries (`bioData`, `faceVerification`, `documents` including status/reviewer/timestamp/reason), user identity/status, and `lastUpdatedAt`.
- `PATCH /admin/profile-verifications/:id/bio-data`, `/face`, or `/documents` — Requires `dating.approve`. Body `{ "action":"APPROVED|REJECTED", "reason":"Optional" }`. Returns the raw updated database row in `data` (not the flattened list representation) and a message. Rejection marks overall `isVerified=false`; approval/rejection reviewer and reason fields are updated.
- `POST /admin/profile-verifications/:id/verify` — Requires `dating.approve`; no body. Approves all sections and sets `isVerified=true`. Returns the updated raw database row.

Errors for mutations: `400` invalid/missing action (`Invalid action. Must be APPROVED or REJECTED`); `404` profile verification not found; `403`; `500`. Refetch the list after mutation to restore its flattened item shape.

## 10. Roles and admin notifications

### `GET /admin/roles`

Requires `roles.view`. Read-only. Returns `data:{modules,matrix,roles,departments}`. `modules` lists permission actions; `matrix` maps each permission to a boolean per role; `roles` includes role, department, admin count, permissions and administrator list (`id`, `fullName`, `email`, `accountStatus`, `mfaEnabled`); `departments` maps departments to roles. Errors: `403`, `500`.

### Notifications (`/admin/notifications`)

All require `notifications.view`. Data is scoped to the currently signed-in admin. List supports pagination and optional `category` filter.

- `GET /admin/notifications?page=1&limit=20&category=…` — Paginated notification rows, plus `meta.unreadCount`. The unread count is for all categories belonging to the current admin.
- `PATCH /admin/notifications/:id/read` — Marks that admin's notification read. Returns `data:{id}` and `message:"Marked as read"`. A nonexistent or other-admin notification is not distinguished; request succeeds without modifying it.
- `PATCH /admin/notifications/read-all` — Marks all own notifications read; returns `data:null` and a message.
- `DELETE /admin/notifications` — Permanently clears own notifications; returns `data:null` and a message.

Errors: `401` if unauthenticated; `403` permission missing; `500` with operation-specific message.

## 11. Admin community content and YouTube access

These routes are under `/community` and all require `settings.full`.

- `GET /community/videos/:videoId/analytics` — Returns `data:{videoId,title,interactions,totalUnlocks,youtube,conversionRate,totalWatchTimeMs,avgWatchTimeMs}`. Interaction counts are in-app; `youtube` has channel view/like counts and sync timestamp. Errors: `401`, `403`, `404` video not found, `500`.
- `POST /community/admin/videos` — Required fields: `title`, `description`, `teaserUrl`, `thumbnailUrl`, `youtubeVideoId`. Optional preview start/duration, `isPublished`, and non-negative seed `viewCount`/`likeCount`. Returns `201` with created card. Duplicate YouTube ID: `409`; invalid payload: `422`; `401`, `403`, `500`.
- `PUT /community/admin/videos/:videoId` — Partial update of title, description, teaser/thumbnail URLs, preview bounds, and publication flag. Returns updated card. Errors: `404`, `401`, `403`, `500`.
- `DELETE /community/admin/videos/:videoId` — Unpublishes (soft-deletes) the card; keeps video and analytics. Returns `data:null`. Errors: `404`, `401`, `403`, `500`.
- `POST /community/admin/sync-youtube` — Optional body `{channelId,handle,maxResults}` (`maxResults` 1–20, default 6). Fetches latest uploads, inserts missing cards, refreshes counters on existing cards, and may return cached results within the channel cooldown. Returns `data:{channelId,fetched,created,updated,alreadyPresent,syncedAt,cached}`. Errors: `400` invalid body; `502` YouTube API error; `503` API key/config missing; `401`, `403`, `500`.
- `GET /community/admin/youtube-grants?status=active|revoked|all&page=1&limit=25&q=…` — Paginated grant list (default active) with `meta.summary`. Search matches user name/email. Refresh tokens are never returned; rows expose presence/encryption flags only. Errors: `401`, `403`, `500`.
- `POST /community/admin/youtube-grants/:userId/revoke` — Revokes the active YouTube grant and removes that user's per-video unlock records. Returns `{userId,revoked:true}`. Errors: `404` no active grant; `401`, `403`, `500`.
- `POST /community/admin/youtube-grants/re-encrypt` — Idempotently seals any legacy plaintext refresh tokens. Returns counts such as `{scanned,sealed}` and a message. Errors: `401`, `403`, `500`.

## 12. Other admin-gated endpoint families

These operations use `requirePermission` and require a valid admin session, even though their URL is outside `/admin`.

### Tours (`/tours`)

- `POST /tours` — `tours.edit`; creates a tour from the validated tour schema. Success is `201` with the created tour and message. Errors: `400`, `401`, `403`, `500`.
- `PUT /tours/:id` — `tours.edit`; updates tour details (title, descriptions, category, duration, price, currency, status, featured/trending, cover image). Returns updated tour. Errors: `400`, `401`, `403`, `404`, `500`.
- `DELETE /tours/:id` — `tours.delete`; permanently deletes a tour. Returns a success message. Errors: `401`, `403`, `404`, `500`.
- `POST /tours/:id/itinerary` — `tours.edit`; adds an itinerary day. Body includes `dayNumber`, `title`, optional description/meal booleans/accommodation fields, and optional `activities` array. Returns `201` with the created itinerary and its activity rows. Errors: `400` invalid data, `401`, `403`, `404` tour not found, `500`.
- `PUT /tours/itinerary/:id` — `tours.edit`; updates an itinerary day using the same day/activity fields. Supplying `activities` replaces the existing activity list; an empty array clears it. Returns updated itinerary with activities; decimal values serialize as strings. Errors: `400`, `401`, `403`, `404` itinerary not found, `500`.
- `DELETE /tours/itinerary/:id` — `tours.edit`; deletes the itinerary day. Returns `{success:true,data:null,message:"Tour itinerary deleted successfully"}`. Errors: `401`, `403`, `404` itinerary not found, `500`.

All these handlers return the standard response envelope. Tour create/update schemas and itinerary activity field constraints are documented inline in `src/routes/tour.routes.ts`.

### FAQ (`/faq/admin`)

All listed routes require `settings.full`.

- `GET /faq/admin` — Returns all FAQ rows, including unpublished items.
- `POST /faq/admin` — Body requires `{question,answer}`; optionally `category`, `sortOrder` (default 0), and `published` (default true). Creates and returns the FAQ item.
- `PUT /faq/admin/:id` — Partial update of FAQ fields; returns updated item.
- `DELETE /faq/admin/:id` — Deletes the item; returns success.

Validation errors are `400`; missing items `404` on update/delete; permission/auth failures `401`/`403`; unexpected failures `500`.

### Data policy (`/data-policy/admin/policy`)

Both routes require `settings.full`.

- `GET /data-policy/admin/policy` — Returns the full policy record for editing. Errors: `401`, `403`, `404` if no policy record exists, `500`.
- `PUT /data-policy/admin/policy` — Body requires `content`; optional `title`. Returns the updated policy. Errors: `400` validation, `401`, `403`, `404` (policy must first be seeded), `500`.

## 13. Source of truth and implementation notes

The route mounts are registered in `src/server.ts`; endpoint guards and payload schemas are in `src/routes/`; behavior and output projections are in the corresponding controller files. The main RBAC matrix is `src/middleware/permissions.ts`, and the separate payment-gateway scopes are in `src/middleware/admin-permission.ts`.

Notable implementation details:

- Admin registration currently creates a `PENDING` account (not an active account).
- `/admin/users/:userId/terminate`, `/approve`, and `/reject` are registered routes and are included here despite being absent from some older admin references.
- `/admin/profile-verifications` is unpaginated; mutation responses are raw rows while the list is flattened.
- The payment gateway client secret never appears in a read response. A successful connection test alone does not mark the gateway connected; `/connect` performs that state change.
- There are two route registrations for `GET /admin/departments` (from the auth and departments routers). Both currently return the same static department/role payload.
- Admin actions are guarded by endpoint permission keys, not by frontend-only role checks. Use `403` as the definitive permission outcome.
