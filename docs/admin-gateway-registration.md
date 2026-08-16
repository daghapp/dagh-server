# Admin Gateway — Registration Guide

Documentation for the **Admin Gateway** self-registration flow in `dagh-server`:
creating an admin console account with a department and role in a single call.

- **Base URL (dev):** `http://localhost:5000`
- **Endpoint:** `POST /admin/auth/register` (public)
- **Interactive docs:** Swagger UI at `GET /api-docs`
- **Demo admin (seed):** `admin@dagh.app` / `Admin@12345` — `SUPER_ADMIN` · `DIASPORA_AFFAIRS`

---

## 1. Overview

The standard `POST /auth/register` always creates a `USER` account that needs email
verification. The Admin Gateway lets console staff register directly as an **admin**,
attaching a `department` and `role` from the start.

| Step | Where | What happens |
|------|-------|--------------|
| 1 | `POST /admin/auth/register` | Creates the `User` + a 1:1 `AdminProfile` in one write |
| 2 | — | The account is created as `accountType = ADMIN` and `accountStatus = ACTIVE` (no OTP) |
| 3 | `POST /auth/login` | Admin logs in immediately with the same public login endpoint |

Optionally, an official-email-domain gate can be enforced — see §5.

---

## 2. Request

### `POST /admin/auth/register`

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `fullName` | string | yes | ≥ 2 characters |
| `email` | string | yes | Valid email; unique in the system |
| `password` | string | yes | ≥ 8 chars, ≥ 1 uppercase, ≥ 1 lowercase, ≥ 1 number, ≥ 1 special char |
| `department` | enum | yes | `AdminDepartment` — see §4 |
| `role` | enum | yes | `AdminRole` — see §4 |
| `phoneNumber` | string | no | E.164 (`^\+[1-9]\d{1,14}$`); unique if provided |

**Example**

```jsonc
{
  "fullName": "Ama Mensah",
  "email": "ama@dagh.app",
  "phoneNumber": "+233201234567",
  "password": "Password123!",
  "department": "DIASPORA_AFFAIRS",
  "role": "ADMIN"
}
```

**curl**

```bash
curl -X POST http://localhost:5000/admin/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Ama Mensah",
    "email": "ama@dagh.app",
    "password": "Password123!",
    "department": "DIASPORA_AFFAIRS",
    "role": "ADMIN"
  }'
```

---

## 3. Response

### 201 — Created

```jsonc
{
  "success": true,
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "authProvider": "PASSWORD",
    "accountStatus": "ACTIVE",
    "accountType": "ADMIN",
    "fullName": "Ama Mensah",
    "email": "ama@dagh.app",
    "phoneNumber": "+233201234567",
    "createdAt": "2026-08-16T07:31:00.000Z",
    "updatedAt": "2026-08-16T07:31:00.000Z",
    "adminProfile": {
      "id": "…",
      "userId": "123e4567-…",
      "department": "DIASPORA_AFFAIRS",
      "role": "ADMIN",
      "createdBy": null,
      "createdAt": "2026-08-16T07:31:00.000Z",
      "updatedAt": "2026-08-16T07:31:00.000Z"
    }
  },
  "message": "Admin registered successfully"
}
```

The response is the full Prisma `User` row **minus `passwordHash`**, with the
`adminProfile` embedded. No tokens are returned — the admin logs in via
`POST /auth/login` (§6).

### Errors

| Status | Body | When |
|--------|------|------|
| `400` | `{ "success": false, "errors": [{ "path", "message" }] }` | Zod validation failed (bad email, weak password, invalid `department`/`role`, …) |
| `400` | `{ "success": false, "error": "User already exists" }` | Email already registered |
| `400` | `{ "success": false, "error": "Phone number already in use" }` | Phone already registered |
| `403` | `{ "success": false, "error": "Admin registration is restricted to the official email domain @…" }` | Email domain gate is enabled and the address doesn't match |
| `500` | `{ "success": false, "error": "Admin registration failed" }` | Unexpected server error |

---

## 4. Enums

### `AdminDepartment`

| Value | Intended use |
|-------|--------------|
| `DIASPORA_AFFAIRS` | Diaspora Affairs (default demo department) |
| `OPERATIONS` | Operations |
| `VISA` | Visa on Arrival processing |
| `TOURS` | Tour management |
| `FINANCE` | Payments / finance |
| `LEGAL` | Legal |
| `MARKETING` | Marketing |
| `MODERATION` | Content / dating moderation |
| `CUSTOMER_SUPPORT` | Customer support |
| `IT_SUPPORT` | IT / technical support |

### `AdminRole`

| Value | Notes |
|-------|-------|
| `SUPER_ADMIN` | Full console access (demo seed admin) |
| `ADMIN` | General administrator |
| `VISA_OFFICER` | Visa queue / approvals |
| `TOUR_MANAGER` | Tour packages / itineraries |
| `FINANCE` | Payments / ledger |
| `SUPPORT` | Support desk |
| `MODERATOR` | Moderation queue |

Both are stored on the `AdminProfile` model (`admin_profiles` table), 1:1 with the
`users` table via `userId`.

---

## 5. Email domain gate (optional)

Self-registration is **open** by default. To restrict signups to an official domain,
set the environment variable:

```
ADMIN_OFFICIAL_EMAIL_DOMAIN=dagh.app
```

When set, `email` must end with `@dagh.app` (case-insensitive); anything else gets
a `403`. Leave unset to allow any email. This addresses the open decision in
`docs/admin-console-implementation-plan.md` ("official email domain restriction") in
an opt-in way.

---

## 6. Logging in after registration

Because the account is created `ACTIVE`, the standard flow works unchanged:

```bash
curl -X POST http://localhost:5000/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "ama@dagh.app", "password": "Password123!" }'
```

```jsonc
{
  "success": true,
  "data": {
    "id": "…",
    "email": "ama@dagh.app",
    "fullName": "Ama Mensah",
    "accountType": "ADMIN",
    "accessToken": "eyJ…",
    "refreshToken": "eyJ…"
  }
}
```

The console should then gate protected screens on `accountType === "ADMIN"` and use
`role` (from `data.adminProfile.role`) to shape the sidebar.

---

## 7. Frontend wiring

```ts
// Registration form submit (React Query)
const registerAdmin = useMutation({
  mutationFn: (form) => api.post("/admin/auth/register", form),
  onSuccess: () => {
    // navigate to /login with a "registration successful" toast
  },
});

// Department / role dropdowns
const DEPARTMENTS = [
  "DIASPORA_AFFAIRS", "OPERATIONS", "VISA", "TOURS", "FINANCE",
  "LEGAL", "MARKETING", "MODERATION", "CUSTOMER_SUPPORT", "IT_SUPPORT",
] as const;

const ROLES = [
  "SUPER_ADMIN", "ADMIN", "VISA_OFFICER", "TOUR_MANAGER",
  "FINANCE", "SUPPORT", "MODERATOR",
] as const;
```

Display the error envelope directly:

```ts
const errorText = err?.response?.data?.error        // "User already exists", …
  ?? err?.response?.data?.errors?.[0]?.message;     // validation issues
```

---

## 8. Notes & limitations

- **Not invite-based.** Anyone with the endpoint URL can register an admin unless
  `ADMIN_OFFICIAL_EMAIL_DOMAIN` is set. For invite-only or "request + approval"
  flows, see Phase 1 of `docs/admin-console-implementation-plan.md`
  (`POST /admin/invites`, `POST /admin/auth/register-request`).
- **RBAC.** Roles are stored and returned, but no permission middleware
  (`requireAdminRole`) is wired yet — every `/admin/*` route currently checks only
  `accountType === "ADMIN"`. Coarse role gating is a planned Phase 1 follow-up.
- **One admin profile per user.** `userId` is unique on `admin_profiles`; a user
  cannot hold multiple departments/roles.
- **Seed.** The demo `admin@dagh.app` is seeded with a `SUPER_ADMIN` /
  `DIASPORA_AFFAIRS` profile.
