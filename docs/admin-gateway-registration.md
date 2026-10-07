# Admin Gateway — Registration Guide

Documentation for the **Admin Gateway** self-registration flow in `dagh-server`:
creating an admin console account with a department and role in a single call.

- **Base URL (dev):** `http://localhost:5000`
- **Endpoint:** `POST /admin/auth/register` (public)
- **Interactive docs:** Swagger UI at `GET /api-docs`
- **Demo admin (seed):** `admin@dagh.app` / `Admin@12345` — `SUPER_ADMIN` · `OPERATIONS_AND_MEMBERSHIP`

---

## 1. Overview

The standard `POST /auth/register` always creates a `USER` account that needs email
verification. The Admin Gateway lets console staff register directly as an **admin**,
attaching a `department` and `role` from the start.

| Step | Where | What happens |
|------|-------|--------------|
| 1 | `POST /admin/auth/register` | Creates the `User` + a 1:1 `AdminProfile` in one write |
| 2 | — | The account is created as `accountType = ADMIN` and `accountStatus = PENDING` |
| 3 | User Management | A staff admin approves the account (§3.7 of the Admin Panel spec); approval sets `accountStatus = ACTIVE` |
| 4 | `POST /auth/login` | Once `ACTIVE`, the admin signs in with the same public login endpoint |

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
| `acceptedTerms` | boolean | no | Data-policy consent from the sign-up form |

**Role ↔ department (strict 1:1).** Each of the four roles belongs to exactly one
department (Admin Panel spec §3.1, §4). Any other combination is rejected with a
`400` from the validator:

| Role | Department |
|------|-----------|
| `SUPER_ADMIN` | `EXECUTIVE_MANAGEMENT` |
| `OPERATIONS` | `OPERATIONS_AND_MEMBERSHIP` |
| `FINANCE` | `FINANCE_AND_COMPLIANCE` |
| `SUPPORT` | `TECHNICAL_SUPPORT` |

**Example**

```jsonc
{
  "fullName": "Ama Mensah",
  "email": "ama@dagh.app",
  "phoneNumber": "+233201234567",
  "password": "Password123!",
  "department": "OPERATIONS_AND_MEMBERSHIP",
  "role": "OPERATIONS"
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
    "department": "OPERATIONS_AND_MEMBERSHIP",
    "role": "OPERATIONS"
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
    "accountStatus": "PENDING",
    "accountType": "ADMIN",
    "fullName": "Ama Mensah",
    "email": "ama@dagh.app",
    "phoneNumber": "+233201234567",
    "createdAt": "2026-08-16T07:31:00.000Z",
    "updatedAt": "2026-08-16T07:31:00.000Z",
    "adminProfile": {
      "id": "…",
      "userId": "123e4567-…",
      "department": "OPERATIONS_AND_MEMBERSHIP",
      "role": "OPERATIONS",
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

The four departments from the Admin Panel spec (§4):

| Value | Intended use |
|-------|--------------|
| `EXECUTIVE_MANAGEMENT` | Executive management |
| `OPERATIONS_AND_MEMBERSHIP` | Operations and membership |
| `FINANCE_AND_COMPLIANCE` | Finance and compliance |
| `TECHNICAL_SUPPORT` | Technical support |

### `AdminRole`

The four roles from the Admin Panel spec (§4):

| Value | Notes |
|-------|-------|
| `SUPER_ADMIN` | Full console access (demo seed admin) |
| `OPERATIONS` | Operations and membership staff |
| `FINANCE` | Payments / ledger |
| `SUPPORT` | Support desk |

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

Because the account is created `PENDING` it cannot sign in yet — login rejects any
non-`ACTIVE` account (`password-auth.controller.ts`). A staff admin must first
approve the account in User Management (§3.7), which flips it to `ACTIVE`. From
then on the standard flow works unchanged:

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
    "adminRole": "OPERATIONS",
    "department": "OPERATIONS_AND_MEMBERSHIP",
    "permissions": [/* permission keys from src/middleware/permissions.ts */],
    "accessToken": "eyJ…",
    "refreshToken": "eyJ…"
  }
}
```

The console should gate protected screens on `accountType === "ADMIN"` and shape
the sidebar from `adminRole` / `permissions`. Admin routes are protected with
`requirePermission("<module>.<action>")` (see `src/middleware/permissions.ts`).

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

// Department / role dropdowns — response of GET /admin/departments
const DEPARTMENTS = [
  "EXECUTIVE_MANAGEMENT", "OPERATIONS_AND_MEMBERSHIP",
  "FINANCE_AND_COMPLIANCE", "TECHNICAL_SUPPORT",
] as const;

const ROLES = [
  "SUPER_ADMIN", "OPERATIONS", "FINANCE", "SUPPORT",
] as const;

// The role select should only offer the single role each department admits.
const rolesByDepartment: Record<string, string[]> = {
  EXECUTIVE_MANAGEMENT: ["SUPER_ADMIN"],
  OPERATIONS_AND_MEMBERSHIP: ["OPERATIONS"],
  FINANCE_AND_COMPLIANCE: ["FINANCE"],
  TECHNICAL_SUPPORT: ["SUPPORT"],
};
// selecting a department => set dropdown to rolesByDepartment[department]
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
- **Created PENDING.** Self-registered admins must be approved by a staff admin in
  User Management before they can sign in.
- **RBAC.** Routes are gated with `requirePermission("<module>.<action>")` backed
  by the permission matrix in `src/middleware/permissions.ts` (Admin Panel spec §4).
- **One admin profile per user.** `userId` is unique on `admin_profiles`; a user
  cannot hold multiple departments/roles.
- **Seed.** The demo `admin@dagh.app` is seeded with a `SUPER_ADMIN` /
  `OPERATIONS_AND_MEMBERSHIP` profile.
