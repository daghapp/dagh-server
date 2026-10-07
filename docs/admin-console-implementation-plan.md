# Admin Console — Implementation Plan

Plan to power the **Diaspora Affairs Admin Console** UI (login, register, dashboard, tours, visa on arrival, payments, user management, sightseeing, reports, settings) against `dagh-server`.

**Design system (from mockups):** Inter, forest green (`~#004d2c`), mustard yellow (`~#ffcc00`), white/light grey surfaces, semantic status pills (green / yellow / red).

**Assumption:** A separate admin web app consumes this API. This plan prioritizes **backend endpoint & data gaps** in `dagh-server`, then notes what the frontend must wire.

---

## 1. Screen inventory → API surfaces

| UI screen | Primary data | Backend today | Gap severity |
|-----------|--------------|---------------|--------------|
| Login | Email + password, remember me, forgot password | `POST /auth/login`, reset flows exist | Low — reuse; optionally gate non-ADMIN |
| Admin register | Name, official email, department, role, password | `POST /auth/register` creates USER only | High — no invite/admin-register, no department/role |
| Dashboard | KPIs, payment chart, quick links, recent activity | None | High |
| Tour management list | Stats, filters, paginated table, CRUD actions | Admin CRUD create/update/delete; public list | Medium — no admin list/filters/stats/soft-archive |
| Visa list | KPIs, filters, export, approve/reject | Paid queue + approve only | High |
| Visa detail | Personal/travel info, docs, notes, activity log | Partial via paid list include | High |
| Payments list | KPIs, filters, export, retry/review | User payment init/status only | High |
| User management | Users table, roles, status | List/promote/demote/suspend/reactivate/delete | Medium — filters, search, roles beyond ADMIN/USER |
| Sightseeing | Tour sites / providers | `GET /itinerary/sites`, providers | Medium — no admin CRUD |
| Reports | Dating moderation queue | `GET/PATCH /admin/reports` | Low–Medium — UI polish + export |
| Profile verification | Bio/face/docs approve | `/admin/profile-verifications/*` | Low — already solid |
| System settings | Config | None | High (defer or stub) |

---

## 2. Current backend baseline (keep / extend)

Already usable:

| Area | Routes / modules |
|------|------------------|
| Auth | `password.routes` — register, login, OTP, refresh, logout, forgot/reset |
| Admin gate | `middleware/admin.ts` + `protectedRoute` (`accountType === ADMIN`) |
| Users | `GET/PATCH/DELETE /admin/users…` |
| Tours (admin write) | `POST/PUT/DELETE /tours` (+ itinerary) behind `requireAdmin` |
| Visa (admin) | `GET /admin/visa-requests/paid`, `POST /admin/visa-requests/approve` |
| Profile verification | `admin-profile.routes` |
| Dating reports | `/admin/reports` |
| Payments (user) | Hubtel init + status; `Payment` + ledger models |
| Audit | `AuditLog` model exists but is provider-scoped — not suitable as-is for admin activity |

Demo admin: `admin@dagh.app` / `Admin@12345` (seed).

---

## 3. Delivery phases

### Phase 0 — Foundations (1–2 days)

Shared contracts every admin list screen needs.

1. **Consistent admin list response** — extend `paginated()` usage everywhere: `{ data, meta: { total, page, limit, totalPages } }`.
2. **Query helpers** — shared parsers for `page`, `limit`, `q`, `status`, `from`, `to`, sort.
3. **Admin activity log** — either generalize `AuditLog` or add `AdminActivityLog` (`actorId`, `entityType`, `entityId`, `action`, `note`, `createdAt`). Visa detail “Activity Log” and dashboard “Recent Activity” depend on this.
4. **CORS** — add admin SPA origin to `ALLOWED_ORIGINS`.
5. **Swagger tags** — group all new routes under `Admin - *` tags.
6. **Auth policy decision** (pick one before Phase 1):
   - **A (recommended):** `POST /auth/login` unchanged; admin SPA rejects non-ADMIN after login.
   - **B:** `POST /admin/auth/login` that fails closed for non-ADMIN.

### Phase 1 — Auth & access for the console (2–3 days)

Maps to Login + Admin Gateway register mockups.

| Endpoint | Purpose |
|----------|---------|
| `POST /admin/auth/login` *(optional if policy A)* | Same tokens; enforce `accountType === ADMIN` |
| `POST /admin/auth/register-request` | Staff requests access (pending approval) **or** invite-only signup |
| `POST /admin/invites` | Super-admin creates invite (email, department, role) |
| `POST /admin/auth/register` | Complete registration with invite token |
| `GET /admin/me` | Profile + role for header (“SUPER ADMINISTRATOR”) |

**Schema additions (minimal):**

- `AdminDepartment` enum: `EXECUTIVE_MANAGEMENT`, `OPERATIONS_AND_MEMBERSHIP`, `FINANCE_AND_COMPLIANCE`, `TECHNICAL_SUPPORT`
- `AdminRole` enum: `SUPER_ADMIN`, `OPERATIONS`, `FINANCE`, `SUPPORT` (mockup “Select Level”)
- Store on `User` (nullable for non-admins) **or** separate `AdminProfile` 1:1

**RBAC (v1):** middleware `requireAdminRole(...roles)` on sensitive routes; SUPER_ADMIN bypasses. Ship coarse roles first; fine-grained permissions later.

**Out of scope for v1:** full “Request System Access” email workflow can be stubbed as creating a `PENDING_ADMIN` record reviewed via User Management.

### Phase 2 — Dashboard aggregation (2–3 days)

Maps to Dashboard mockup.

| Endpoint | Returns |
|----------|---------|
| `GET /admin/dashboard/summary` | `totalTours` (bulk vs custom split), `pendingVisaRequests`, `successfulPaymentsAmount` (+ MoM %), alert counts |
| `GET /admin/dashboard/payment-chart?months=5` | Monthly series: successful / pending / failed counts or GHS |
| `GET /admin/dashboard/recent-activity?limit=20` | Unified feed from `AdminActivityLog` (+ optional payment/visa/tour events) |

**Implementation notes:**

- Prefer one round-trip summary endpoint for KPI cards; chart/activity can be separate for caching.
- “Bulk vs Custom” → map to existing tour/request model: `tour_packages` vs `TourRequest` / `systemGenerated` bookings (confirm product mapping with PM).
- Cache summary 30–60s in Redis if multi-instance.

### Phase 3 — Tours admin API (3–4 days)

Maps to Tour Management list (+ create/edit implied by actions).

| Endpoint | Purpose |
|----------|---------|
| `GET /admin/tours` | Paginated list: id, title, cover, locations, type, status, createdAt |
| `GET /admin/tours/stats` | Active, pending drafts, participants, system status |
| `GET /admin/tours/:id` | Full package + itineraries + media |
| Existing | `POST/PUT/DELETE /tours` — keep; optionally remount under `/admin/tours` for consistency |
| `PATCH /admin/tours/:id/status` | `draft` \| `active` \| `archived` without full PUT |
| `GET /admin/tours/export` | CSV of filtered set (optional v1.1) |

**Filters:** status, type (AUTO/CUSTOM), date range, `q` (title/id/region).

**Data gaps:**

- Normalize `tour_packages.status` to enum (`DRAFT`, `ACTIVE`, `ARCHIVED`) if currently free-form string.
- Define **AUTO vs CUSTOM**: e.g. catalog packages = AUTO; admin/custom or `TourRequest`-sourced = CUSTOM — document in API and seed.

**Stats:**

- Active / drafts from package status counts.
- Participants = sum of confirmed booking headcounts (or distinct users).
- System status can be a static/health check field for v1.

### Phase 4 — Visa on Arrival admin API (4–5 days)

Maps to Visa list + Visa Request Detail.

| Endpoint | Purpose |
|----------|---------|
| `GET /admin/visa-requests` | Paginated + filters (status, nationality, date, `q`) |
| `GET /admin/visa-requests/stats` | Total, pending review, approved today, rejection rate |
| `GET /admin/visa-requests/:id` | Full detail: user, visaData, payment, approval, documents, notes, activity |
| `POST /admin/visa-requests/:id/approve` | Prefer path id over body-only (keep old route as alias) |
| `POST /admin/visa-requests/:id/reject` | **Missing today** — set REJECTED + notes |
| `POST /admin/visa-requests/:id/notes` | Append admin note (uses approval.notes and/or activity log) |
| `POST /admin/visa-requests/:id/documents` | Admin upload additional doc (Cloudinary) |
| `GET /admin/visa-requests/export` | CSV |
| `PATCH /admin/visa-requests/:id/status` | e.g. mark In Review |

**Schema / product gaps vs mockup:**

| Mockup field | Current model | Action |
|--------------|---------------|--------|
| Full name, DOB, nationality, email, phone | Mostly on `User` / profile — not all on `VisaOnArrivalData` | Join user + profile; add nationality to visa data if required |
| Passport No. | `passport_number` | OK |
| Arrival/departure, purpose | Present | OK |
| Accommodation proof | Removed in migration | Decide: restore field or drop from UI |
| Document gallery | passport / bio / flight URLs | OK; “Download All” = zip or multi-URL on FE |
| Activity log | None | Use Phase 0 activity log |
| Application ID display | UUID | Optional human code `GHA-YYYY-####-X` |

**Deprecate or narrow** `GET /admin/visa-requests/paid` once the filtered list covers the queue (or keep as convenience filter `status=READY_FOR_GIS_SUBMISSION,...`).

### Phase 5 — Payments admin API (3–4 days)

Maps to Payment Transactions.

| Endpoint | Purpose |
|----------|---------|
| `GET /admin/payments` | Paginated: reference, user, service (`targetType`), amount, status, date |
| `GET /admin/payments/stats` | Total revenue, pending fees, failed count, success rate |
| `GET /admin/payments/:id` | Detail + Hubtel log join if available |
| `POST /admin/payments/:id/retry` | Re-check Hubtel status / re-drive fulfillment (safe idempotent) |
| `GET /admin/payments/export` | CSV |

**Filters:** service (`PaymentTargetType`), status, date range, `q` (reference / email).

**Stats formulas (document in API):**

- Revenue = sum `amount` where `status === SUCCESS`
- Pending = sum/count where `PENDING` \| `INITIALIZED`
- Failed = count `FAILED`
- Success rate = SUCCESS / (SUCCESS + FAILED) over window

**Retry:** wrap existing status-check job logic; never double-credit ledger — reuse payment service idempotency.

### Phase 6 — Users, sightseeing, reports, settings (3–5 days)

**Users (enhance existing):**

| Endpoint | Purpose |
|----------|---------|
| `GET /admin/users` | Add `q`, `accountStatus`, `accountType` / role, date filters |
| `GET /admin/users/:id` | Detail for drawer/page |
| `PATCH /admin/users/:id` | Update department/role (admins), profile fields as allowed |
| Existing promote/demote/suspend/reactivate/delete | Keep |

**Sightseeing (TourSite + Provider admin):**

| Endpoint | Purpose |
|----------|---------|
| `GET/POST/PUT/DELETE /admin/tour-sites` | CRUD on `TourSite` |
| `GET/POST/PUT /admin/providers` | Hotels / guides / rentals as needed for console |

**Reports:**

- Keep dating `/admin/reports`.
- Optional `GET /admin/reports/summary` for dashboard widgets.
- Map sidebar “Reports” to moderation + (later) operational exports.

**System settings (v1 stub):**

- `GET /admin/settings` — read-only feature flags / pricing mirrors from env or DB.
- Full settings write UI deferred unless PM prioritizes.

---

## 4. Suggested route layout

Mount under existing `/admin` (already in `server.ts`):

```
/admin/auth/*
/admin/me
/admin/dashboard/*
/admin/tours/*
/admin/visa-requests/*
/admin/payments/*
/admin/users/*          (existing + filters)
/admin/tour-sites/*
/admin/providers/*
/admin/reports/*        (existing)
/admin/profile-verifications/*  (existing)
/admin/settings
/admin/activity         (optional global feed)
```

Keep legacy tour write routes working; add thin aliases under `/admin/tours` to match the console IA.

---

## 5. Cross-cutting requirements

1. **All mutating admin routes** write `AdminActivityLog`.
2. **Zod validators** for every new body/query; Swagger annotations matching list/detail shapes the UI needs (avoid over-fetching on list).
3. **CSV export** — stream or signed temp URL; cap row count; admin-only.
4. **Rate limits** — stricter on auth; moderate on export.
5. **Idempotency** — approve/reject/retry safe to double-submit.
6. **Tests** — integration tests per phase for happy path + 403 non-admin + pagination filters.
7. **Seed** — expand demo data so KPI cards and tables are non-empty (multiple visa statuses, failed payments, draft tours).

---

## 6. Frontend admin app (parallel track)

Not in this repo today; recommended stack: React + Vite + Tailwind (Inter), React Query, role-aware sidebar.

**Build order aligned to API phases:**

1. Shell (sidebar, header, auth gate) + Login  
2. Dashboard (once Phase 2 lands)  
3. Visa list → detail (highest ops value)  
4. Payments  
5. Tours  
6. Users / Sightseeing / Reports / Settings  

**UI mapping notes:**

- Status pills: map API enums → green/yellow/red tokens.
- Table actions: View → detail route; Approve/Reject → POST then invalidate queries.
- “E” markers in Figma are design annotations — ignore in product UI.

---

## 7. Open decisions (blockers)

- [ ] Admin registration: **invite-only** vs open request + approval  
- [ ] Admin roles beyond binary `USER`/`ADMIN` — confirm enum list  
- [ ] Official email domain restriction (`@diaspora.gov.gh` / `@dagh.app`) — enforce or display-only?  
- [ ] AUTO vs CUSTOM tour definition  
- [ ] Restore accommodation proof on visa or remove from UI  
- [ ] Human-readable visa application IDs  
- [ ] Where the admin SPA is hosted (affects CORS / cookies vs Bearer)  
- [ ] System Settings scope for v1  

---

## 8. Effort estimate (backend)

| Phase | Effort |
|-------|--------|
| 0 Foundations | 1–2 days |
| 1 Auth & RBAC | 2–3 days |
| 2 Dashboard | 2–3 days |
| 3 Tours admin | 3–4 days |
| 4 Visa admin | 4–5 days |
| 5 Payments admin | 3–4 days |
| 6 Users / sites / polish | 3–5 days |
| **Total** | **~3–4 weeks** one engineer |

Frontend console: similar calendar time in parallel once Phase 0–1 contracts are stable.

---

## 9. Recommended first sprint (concrete)

1. Phase 0 activity log + list query helpers  
2. `GET /admin/visa-requests` (+ stats) and `POST …/reject` + `GET …/:id`  
3. `GET /admin/payments` (+ stats)  
4. `GET /admin/dashboard/summary`  
5. Document OpenAPI shapes for the admin SPA  

This unlocks the highest-traffic console screens (visa + payments + home) against real data while tour/user polish follows.
