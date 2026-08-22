# Admin Console API — Endpoint Reference & Frontend Guide

Reference for the **Diaspora Affairs Admin Console** backend surface served by `dagh-server`.
Use this to wire the React admin SPA against real data.

- **Base URL:** `https://<API_URL>` (local dev: `http://localhost:5000`)
- **Docs:** Swagger UI at `/api-docs`
- **Demo admin:** `admin@dagh.app` / `Admin@12345`

---

## 1. Conventions

### Auth

Every `/admin/*` route requires a **Bearer token** for an `ADMIN` account:

```
Authorization: Bearer <accessToken>
```

1. Login via `POST /auth/login` (public, returns `accessToken`).
2. After login the SPA should check `data.accountType === "ADMIN"` and route
   non-admins away from the console (policy A).
3. On `401` → refresh the token, then retry; on a second `401` → logout.

### Response envelope

All endpoints use one shape:

| Kind | Shape |
|------|-------|
| Success | `{ success: true, data: T, message?: string }` |
| Error | `{ success: false, error: string, details?: unknown }` |
| Paginated | `{ success: true, data: T[], pagination: { total, page, limit, totalPages } }` |

### Shared list query params

All new console lists (`visa-requests`, `payments`) accept the same filters:

| Param | Meaning | Default |
|-------|---------|---------|
| `page` | 1-based page | `1` |
| `limit` | Rows per page, clamped to `[1, 100]` | `20` |
| `status` | Enum filter; `ALL` (or absent) = no filter; invalid values are ignored | — |
| `q` | Free-text search | — |
| `from` / `to` | ISO date range on `createdAt`; `to` is end-of-day inclusive | — |

### Idempotency

`approve` / `reject` are safe to double-submit. A repeat call returns the current
state with `message: "… already approved/rejected"` instead of erroring — treat
`success: true` as done and refetch the list.

### Errors

| Code | Meaning |
|------|---------|
| `400` | Validation / business rule (already approved, already suspended, …) |
| `401` | Missing / invalid / expired token |
| `403` | Valid token but `accountType !== ADMIN` |
| `404` | Entity not found |
| `500` | Server error (include `details` when logging) |

---

## 2. Dashboard

### `GET /admin/dashboard/summary`

One round-trip for the KPI cards on the home screen. **No query params.**

```jsonc
{
  "success": true,
  "data": {
    "tours": { "total": 4, "bulk": 4, "custom": 0 },   // catalog vs TourRequest
    "pendingVisaRequests": 4,                          // reviewable visa queue
    "successfulPaymentsAmount": 8906,                  // all-time SUCCESS sum (GHS)
    "successfulPaymentsMoMPercent": 100,               // this month vs last, %
    "alerts": {
      "pendingVisaRequests": 4,
      "pendingReports": 0,
      "pendingProfileVerifications": 0,
      "failedPaymentsLast24h": 1
    }
  }
}
```

**Frontend:** fetch once per dashboard visit (`staleTime` ~30s). Render the four
KPI cards from `data`, and the alert banner from `alerts` when any count is > 0.
Use `successfulPaymentsMoMPercent` sign for up/down styling.

---

## 3. Visa on Arrival

### `GET /admin/visa-requests`

Paginated queue. Filters: `status`, `q` (passport number, purpose of trip, applicant
name/email), `from`/`to`, `page`/`limit`.

```jsonc
{
  "success": true,
  "data": [
    {
      "id": "536a…", "userId": "c0c…", "status": "PENDING",
      "packageType": "STANDARD",                       // "STANDARD" | "EXPEDITED" | null
      "paymentId": "c92…", "createdAt": "…", "updatedAt": "…",
      "user": { "id": "…", "fullName": "Kofi Mensah", "email": "…", "phoneNumber": "+233…" },
      "visaData": {
        "passport_number": "G000777777",
        "purpose_of_trip": "Tourism",
        "date_of_arrival": "…", "date_of_departure": "…"
      } | null,
      "approval": { "status": "APPROVED", "approvedAt": "…", "notes": "…" } | null,
      "payment": { "id": "…", "amount": 664, "status": "SUCCESS" } | null
    }
  ],
  "pagination": { "total": 7, "page": 1, "limit": 20, "totalPages": 1 }
}
```

### `GET /admin/visa-requests/stats`

KPI counters for the queue. Optional `from`/`to`.

```jsonc
{ "success": true, "data": {
  "total": 7, "pendingReview": 4, "rejected": 1,
  "approvedToday": 1, "rejectionRate": 14.3
}}
```

### `GET /admin/visa-requests/:id`

Full detail for the request screen:

```jsonc
{
  "success": true,
  "data": {
    "id": "…", "userId": "…", "status": "PENDING", "packageType": "STANDARD",
    "paymentId": "…", "createdAt": "…", "updatedAt": "…",
    "user": { "id": "…", "fullName": "…", "email": "…", "phoneNumber": "…", "dateOfBirth": "…", "createdAt": "…" },
    "visaData": {                      // full docs + dates
      "id": "…", "requestId": "…",
      "passport_image_url": "…", "bio_page_image_url": "…", "flight_itinerary_image_url": "…",
      "passport_number": "…", "purpose_of_trip": "…", "date_of_arrival": "…", "date_of_departure": "…"
    } | null,
    "payment": { /* full Payment row */ } | null,
    "approval": { "status": "…", "approvedBy": "…", "approvedAt": "…", "notes": "…" } | null,
    "activityLogs": [                 // newest first
      { "id": "…", "actorId": "…", "entityType": "VISA_REQUEST", "entityId": "…",
        "action": "APPROVED", "note": "Docs OK", "createdAt": "…",
        "actor": { "id": "…", "fullName": "System Administrator", "email": "…" } }
    ]
  }
}
```

### `POST /admin/visa-requests/:id/approve` · `POST /admin/visa-requests/:id/reject`

**Body (both):** `{ "note": "string (optional)" }`

- Sets request status + writes the `VisaApproval` row + an activity log entry.
- **Idempotent** — repeat submissions return the current state.
- Returns `{ success, data: { request, approval }, message }`.

**Frontend flow:** open the detail → prompt for an optional reason (or a canned
dropdown) → `POST` → `queryClient.invalidateQueries(["admin","visa-requests"])`
to refresh both the list and the stats.

### Legacy aliases (kept)

- `GET /admin/visa-requests/paid` — paid queue (READY_FOR_GIS_SUBMISSION + EXPEDITED…).
  Equivalent to `GET /admin/visa-requests?status=READY_FOR_GIS_SUBMISSION` style filtering.
- `POST /admin/visa-requests/approve` — body `{ "requestId": "…" }`. Prefer the
  path-based endpoint above for new UI.

---

## 4. Payments

### `GET /admin/payments`

Paginated transaction list. Filters: `status`, `targetType`, `q` (reference /
user name / email), `from`/`to`, `page`/`limit`.

```jsonc
{
  "success": true,
  "data": [
    {
      "id": "…", "reference": "ADM-SEED-BOOK-CONFIRMED-001",
      "description": "Coastal Heritage Discovery — 2 pax",
      "targetType": "TOUR_BOOKING", "targetId": "…",
      "amount": 4800, "currency": "GHS", "status": "SUCCESS",
      "method": null, "provider": "HUBTEL",
      "paidAt": null, "createdAt": "…",
      "user": { "id": "…", "fullName": "…", "email": "…" }
    }
  ],
  "pagination": { "total": 7, "page": 1, "limit": 20, "totalPages": 1 }
}
```

### `GET /admin/payments/stats`

Optional `from`/`to`. **Formulas documented for the UI labels:**

```jsonc
{ "success": true, "data": {
  "totalRevenue": 8906,     // Σ amount where status = SUCCESS
  "successCount": 6,
  "pendingCount": 1,        // status IN (PENDING, INITIALIZED)
  "pendingAmount": 150,     // Σ amount of the above
  "failedCount": 1,
  "successRate": 85.7       // success / (success + failed), %
}}
```

---

## 5. User Management

All under `/admin/users`.

### `GET /admin/users`

Paginated (`page`, `limit`). **No `q`/`status` filters yet** (Phase 6 adds them).

Item: `{ id, fullName, email, phoneNumber, accountType, accountStatus, authProvider, createdAt, lastLoginAt }`

### Mutations (all take `:userId` in the path)

| Method | Path | Success message |
|--------|------|-----------------|
| `PATCH` | `/admin/users/:userId/promote` | User promoted to admin |
| `PATCH` | `/admin/users/:userId/demote` | Admin demoted to user |
| `PATCH` | `/admin/users/:userId/suspend` | User suspended successfully |
| `PATCH` | `/admin/users/:userId/reactivate` | User reactivated successfully |
| `DELETE` | `/admin/users/:userId` | User deleted successfully |

Each returns `{ success, data, message }`. Notable errors: `400` "User is already
an admin", `400` "User is already suspended", `404` "User not found".

**Frontend:** after any mutation, invalidate the users list. Suspend/reactivate and
promote/demote are two-state toggles — disable the action that matches the current
value (`accountStatus === "SUSPENDED"` hides "Suspend", shows "Reactivate").

---

## 6. Moderation (dating reports)

### `GET /admin/reports`

Query: `status` (`PENDING` | `REVIEWING` | `RESOLVED` | `DISMISSED` | `ALL`), `page`, `limit`.

Returns the standard paginated envelope (`data` array + `pagination`). Each item
carries `reporter` and `target` (id/fullName/email, plus `accountStatus` on target).

### `PATCH /admin/reports/:reportId`

Body: `{ "status": "REVIEWING" | "RESOLVED" | "DISMISSED", "resolutionNote?": "…" }`

### `POST /admin/reports/:reportId/suspend`

Suspend the reported user + mark report `RESOLVED`. No body.

---

## 7. Profile Verification

### `GET /admin/profile-verifications`

Unpaginated array (approval status for each section). Item (flattened):

```jsonc
{
  "id": "…", "isVerified": false, "validationStep": "PHONE_NUMBER_VERIFICATION",
  "verificationMessage": null,
  "phoneVerified": false, "ipAddressVerified": false,
  "bioProfileVerified": false, "documentVerified": false,
  "faceScanUrl": "…", "documentUrls": ["…"], "documentType": "PASSPORT" | "GHANA_CARD" | null,
  "bioData": { "status": "PENDING", "approvedBy": null, "approvedAt": null, "approvalReason": null, "rejectedBy": null, "rejectedAt": null, "rejectionReason": null },
  "faceVerification": { "status": "PENDING", /* same shape as bioData */ },
  "documents": { "status": "PENDING", /* same shape */ },
  "user": { "id": "…", "fullName": "…", "email": "…", "phoneNumber": "…", "accountType": "…", "accountStatus": "…", "createdAt": "…" },
  "lastUpdatedAt": "…"
}
```

### Mutations (`:id` is the verification id)

| Method | Path | Body |
|--------|------|------|
| `PATCH` | `/admin/profile-verifications/:id/bio-data` | `{ action: "APPROVED"\|"REJECTED", reason? }` |
| `PATCH` | `/admin/profile-verifications/:id/face` | same |
| `PATCH` | `/admin/profile-verifications/:id/documents` | same |
| `POST` | `/admin/profile-verifications/:id/verify` | none — approves every section at once |

Each returns `{ success, data: <updated ProfileVerification>, message }`. The
update response is the raw Prisma row (snake_case fields), not the flattened shape
— refetch the list after a mutation rather than merging locally.

---

## 8. Status → Pill mapping

Design tokens: green / yellow / red.

| Entity | Enum value | Pill |
|--------|-----------|------|
| Visa | `APPROVED` | green |
| Visa | `READY_FOR_GIS_SUBMISSION`, `EXPEDITED_AIRPORT_PAYMENT_PENDING`, `PENDING` | yellow |
| Visa | `REJECTED`, `PAYMENT_FAILED` | red |
| Payment | `SUCCESS` | green |
| Payment | `PENDING`, `INITIALIZED` | yellow |
| Payment | `FAILED` | red |
| User | `ACTIVE` | green |
| User | `PENDING_VERIFICATION` | yellow |
| User | `SUSPENDED`, `DEACTIVATED` | red |
| Report | `RESOLVED`, `DISMISSED` | green / grey |
| Report | `REVIEWING` | yellow |
| Report | `PENDING` | red (needs action) |
| Verification | `APPROVED` | green |
| Verification | `PENDING` | yellow |
| Verification | `REJECTED` | red |

---

## 9. Frontend wiring patterns

Assumes **React + React Query** (per plan §6).

### Auth gate

```ts
// after POST /auth/login
if (login.data.accountType !== "ADMIN") { /* redirect to user app */ }
```

### List with filters (visa / payments)

```ts
useQuery({
  queryKey: ["admin", "visa-requests", filters],   // filters: { page, limit, status, q, from, to }
  queryFn: () => api.get("/admin/visa-requests", { params: filters }),
  placeholderData: keepPreviousData,               // avoids table flicker while paging
})
```

Pass `filters` (a stable object) in the key so every filter change refetches.
Derive `totalPages` from `data.pagination.totalPages`.

### Mutations (approve / reject / suspend …)

```ts
const approve = useMutation({
  mutationFn: (id: string) =>
    api.post(`/admin/visa-requests/${id}/approve`, { note: reason }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "visa-requests"] }); // list + stats
    queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });    // KPIs move too
  },
});
```

Because approve/reject are idempotent, you don't need optimistic locking — just
disable the button while the mutation is pending and refetch on success.

### Detail + activity log (visa)

Use `GET /admin/visa-requests/:id`. Render `activityLogs` newest-first with
`actor.fullName` + relative `createdAt`. The detail row itself is refetched after
an approve/reject so the log updates.

### Dashboard

```ts
useQuery({
  queryKey: ["admin", "dashboard"],
  queryFn: () => api.get("/admin/dashboard/summary"),
  staleTime: 30_000,   // cached; refresh on screen focus
})
```

### Known constraints

- `GET /admin/profile-verifications` is unpaginated and returns snake_case fields
  on mutation responses — plan to migrate to the standard envelope.
- `GET /admin/visa-requests/:id` only resolves the request's own payment (there is
  no Prisma relation yet); payment is fetched via `paymentId` server-side.
