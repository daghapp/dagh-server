# Changes Documented

## 1. Environment & Database Setup

### PostgreSQL Configuration
- **Database created**: `ddg`
- **Role created**: `hollali` (superuser)
- **Password set**: `postgres` user password set to `postgres`
- **pg_hba.conf modified**: Added `scram-sha-256` authentication for local TCP connections (before `ident` rules) so Prisma's driver adapter can connect via TCP with username/password
- **Migrations applied**: All 45 existing database migrations deployed to the `ddg` database

### `.env` file
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ddg`

---

## 2. TypeScript Config Fixes (`tsconfig.json`)

### Changes made:
- Removed `generated/prisma/**/*.ts` from `include` array to fix rootDir conflict (generated code outside `src/`)
- Changed `moduleResolution` from `"node"` (deprecated `node10`) to `"bundler"`
- Removed `baseUrl` and `ignoreDeprecations` settings that were causing warnings/errors

---

## 3. Prisma Schema Changes (`prisma/schema.prisma`)

### New Enum
```prisma
enum VerificationStatus {
  PENDING
  APPROVED
  REJECTED
}
```

### Extended `ProfileVerification` Model
Added three independent verification sections, each with full approval/rejection tracking:

**Bio Data section:**
- `bioDataStatus` — `VerificationStatus @default(PENDING)`
- `bioDataApprovedBy`, `bioDataApprovedAt`, `bioDataApprovalReason`
- `bioDataRejectedBy`, `bioDataRejectedAt`, `bioDataRejectionReason`

**Face Verification section:**
- `faceStatus` — `VerificationStatus @default(PENDING)`
- `faceApprovedBy`, `faceApprovedAt`, `faceApprovalReason`
- `faceRejectedBy`, `faceRejectedAt`, `faceRejectionReason`

**Documents section:**
- `documentStatus` — `VerificationStatus @default(PENDING)`
- `documentApprovedBy`, `documentApprovedAt`, `documentApprovalReason`
- `documentRejectedBy`, `documentRejectedAt`, `documentRejectionReason`

### Migration created
`prisma/migrations/20260707154431_add_admin_verification_approval_fields/`

---

## 4. Admin Profile Verification Controller (`src/Modules/profile-management/admin-profile.controller.ts`)

Class `AdminProfileController` with 5 methods:

| Method | Description |
|--------|-------------|
| `getAllVerifications` | Returns all profile verifications with user info and per-section approval status |
| `updateBioDataStatus` | Approve or reject bio data section |
| `updateFaceStatus` | Approve or reject face verification section |
| `updateDocumentStatus` | Approve or reject documents section |
| `verifyUserFully` | Approve all three sections at once and mark user as fully verified |

Each section method accepts `{ action: "APPROVED" | "REJECTED", reason?: string }` in the request body. When approving, rejection fields are cleared (and vice versa) so state remains consistent.

---

## 5. Admin Profile Routes (`src/routes/admin-profile-routes.ts`)

Five endpoints registered under the `/admin` prefix, all protected with `protectedRoute` + `requireAdmin` middleware:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin/profile-verifications` | List all verification requests |
| `PATCH` | `/admin/profile-verifications/:id/bio-data` | Update bio data status |
| `PATCH` | `/admin/profile-verifications/:id/face` | Update face verification status |
| `PATCH` | `/admin/profile-verifications/:id/documents` | Update document status |
| `POST` | `/admin/profile-verifications/:id/verify` | Fully verify user |

---

## 6. Route Registration (`src/server.ts`)

Added import and mount point for the new admin profile routes:

```typescript
import { router as AdminProfileRoutes } from './routes/admin-profile-routes.js';

app.use('/admin', AdminProfileRoutes);
```

---

## 7. Directory Restructuring — Profile Management Module

### Problem
- Typo in directory name: `src/Modules/profile-managemnt` (missing "e")
- Inconsistent casing: `src/modules/` (lowercase) vs `src/Modules/` (uppercase) — uppercase is the dominant convention (10 directories)
- Inconsistent file naming: `admin-profile-controller.ts` (hyphens) vs sibling files using dots (e.g. `profile.controller.ts`)

### Changes
| Path | Action |
|------|--------|
| `src/Modules/profile-managemnt/` → `src/Modules/profile-management/` | Renamed (typo fix) |
| `src/modules/profile-management/admin-profile-controller.ts` | Deleted |
| `src/Modules/profile-management/admin-profile.controller.ts` | Created (moved from above, renamed to dotted convention) |
| `src/routes/admin-profile-routes.ts` | Import updated to `"../Modules/profile-management/admin-profile.controller.js"` |
| `src/modules/` | Removed (now empty) |

### Fixing broken imports from the typo rename

After renaming `profile-managemnt` → `profile-management`, 9 imports across 6 route files still referenced the old path and caused the server to crash:

| File | Lines fixed |
|------|-------------|
| `src/routes/verification.routes.ts` | 4 |
| `src/routes/bio_profile_url.routes.ts` | 1 |
| `src/routes/profile-validation-step.routes.ts` | 1 |
| `src/routes/profile-routes.routes.ts` | 1 |
| `src/routes/bio_profile_document_url.routes.ts` | 1 |
| `src/routes/profile-ethnicity.routes.ts` | 1 |

All updated from `../Modules/profile-managemnt/` → `../Modules/profile-management/`.

### Regenerating Prisma client

After adding `createdAt` to `ProfileVerification`, the Prisma client needed regeneration so TypeScript recognized the new field:

```
npx prisma generate
```

---

## 8. Missing Response Fields — Face/Document URLs & Submission Date

The `GET /admin/profile-verifications` endpoint was missing fields specified in the requirements.

### Changes
- Added `createdAt DateTime @default(now())` to `ProfileVerification` model in `prisma/schema.prisma`
- Migration `20260708074903_add_created_at_to_profile_verification` created and applied
- Updated `getAllVerifications` response to include:
  - `createdAt` — submission date
  - `faceScanUrl` — from `userProfile.bio_profile_image_url`
  - `documentUrls` — from `userProfile.bio_document_urls`
  - `documentType` — from `userProfile.bio_document_type`
- Ran `prisma generate` to update TypeScript types

---

## 9. Directory Restructuring — `src/Modules` → `src/modules`

All module directories renamed from uppercase `Modules` to lowercase `modules` for consistency. All route imports across the codebase updated to reference `../modules/` instead of `../Modules/`.

**Affected route files (import path changes):**
- `src/routes/admin-profile-routes.ts`
- `src/routes/admin.routes.ts`
- `src/routes/bio_profile_document_url.routes.ts`
- `src/routes/bio_profile_url.routes.ts`
- `src/routes/facebook-auth.routes.ts`
- `src/routes/google-auth.routes.ts`
- `src/routes/image-upload.route.ts`
- `src/routes/itinerary.routes.ts`
- `src/routes/message.routes.ts`
- `src/routes/password.routes.ts`
- `src/routes/payment.routes.ts`
- `src/routes/profile-ethnicity.routes.ts`
- `src/routes/profile-routes.routes.ts`
- `src/routes/profile-validation-step.routes.ts`
- `src/routes/provider.routes.ts`
- `src/routes/tour.routes.ts`
- `src/routes/verification.routes.ts`
- `src/routes/visa.routes.ts`

Swagger config (`src/config/swagger.ts`) also updated to scan `./src/modules/**/*.ts`.

---

## 10. Security Hardening

### Rate Limiting (`src/server.ts`)
- **Auth rate limiter**: 20 requests per 15-minute window on `/auth` password routes
- **Payment rate limiter**: 50 requests per 15-minute window on `/payment` routes
- Uses `express-rate-limit` with standard headers

### OTP Hashing (`src/helpers/otp.ts`)
- OTP codes are now **hashed with bcrypt** (10 rounds) before being stored in the database
- New `verifyOtp()` function exported for comparing plain OTP against stored hash

### Password Validation (`src/validator/password-auth-validator.ts`)
- Minimum password length increased from **6 → 8** characters
- `resetPasswordSchema` now enforces the same strength rules as registration:
  - At least one uppercase letter
  - At least one lowercase letter
  - At least one number
  - At least one special character
- Removed redundant `oldPassword` field from reset password schema

### Hubtel Callback Verification (`src/middleware/hubtel-callback.ts`)
- New middleware validates Hubtel payment callbacks by:
  1. Checking payload structure (`ResponseCode`, `Data`, `ClientReference`, `TransactionId`)
  2. Verifying the transaction status with Hubtel's Transaction Status API
  3. Rejecting callbacks for transactions Hubtel reports as `FAILED`
- Applied to all Hubtel callback endpoints:
  - `POST /tours/hubtel-callback`
  - `POST /visa-requests/payment-callback`
  - `POST /itinerary/payment-callback`

### Admin Route Protection (`src/routes/admin.routes.ts`)
- Added `requireAdmin` middleware to all admin-only endpoints:
  - `GET /admin/users`
  - `PATCH /admin/users/:userId/promote`
  - `PATCH /admin/users/:userId/demote`
  - `PATCH /admin/users/:userId/suspend`
  - `PATCH /admin/users/:userId/reactivate`
  - `DELETE /admin/users/:userId`
  - `GET /admin/visa-requests/paid`
  - `POST /admin/visa-requests/approve`

### Other Security Changes
- **Hubtel config** (`src/config/hubtel.ts`): Throws error instead of `console.error` when credentials are missing
- **JWT secret key**: Socket handlers now use `JWT_ACCESS_SECRET` instead of `JWT_SECRET`
- **Socket `mark_read`**: Now validates that the authenticated user is the message receiver before marking as read
- **Removed credential logging**: Deleted commented-out Hubtel credential debug block
- **USD-to-GHS rate** (`src/helpers/stringHelper.ts`): Read from `USD_TO_GHS_RATE` env var instead of hardcoded `12.5`
- **Morgan logging**: Uses `combined` format in production, `dev` in development

---

## 11. Cryptographic Improvements

### Client Reference Generation (`src/helpers/client-ref.ts`)
- `generateClientReference()` and `generateClientReference_targetType()` now use **`crypto.randomBytes()`** instead of `Math.random()`
- Produces cryptographically secure random reference strings

---

## 12. Performance & Database Optimizations

### Database Indexes (`prisma/schema.prisma`)
- `otp`: Added composite index on `[email, purpose]`
- `Message`: Added indexes on `senderId` and `receiverId`
- `Payment`: Added indexes on `status` and `userId`

### Cron Job Adjustments
| Job | Before | After |
|-----|--------|-------|
| `checkPendingPaymentsJob` | Every minute | Every 5 minutes |
| `deleteInactiveUsersJob` | Every minute, 30 min threshold, deletes all non-ACTIVE users | Hourly, 24 hour threshold, deletes only `PENDING_VERIFICATION` users |

---

## 13. New Helper Modules

### `src/helpers/ledger.ts`
Extracted `getAccountId(accountName)` helper — looks up a `LedgerAccount` by name and returns its ID. Replaces inline `UserVisaController.getAccountId()` calls in `check-pending-payments.ts`.

### `src/helpers/payment.ts`
Extracted `paymentStatusFromHubtel(responseCode)` helper — maps Hubtel response codes to `PaymentStatus` enum values (`"0000"` → SUCCESS, `"2001"` → FAILED, default → PENDING).

---

## 14. Graceful Shutdown (`src/index.ts`)
- Added `SIGTERM` and `SIGINT` handlers
- HTTP server closes gracefully before exit
- 10-second timeout forces exit if graceful shutdown stalls

---

## 15. Code Cleanup

### Removed Unused Dependencies (`package.json`)
- `bcryptjs`, `install`, `passport-google-oauth`, `session`, `socket.io-client`, `@types/bcryptjs`

### Removed Commented-Out Code (`prisma/schema.prisma`)
- Deleted commented-out `GovernmentId`, `SelfieVerification`, and `BackgroundCheck` models

### Removed Duplicate Exports (`src/validator/index.ts`)
- Removed duplicate `export * from "./token-validator.js"` and `export * from "./profile-validator.js"`

### Removed Dead Routes (`src/routes/tour.routes.ts`)
- Removed unused `POST /tours/bookings` endpoint and its Swagger documentation

### Removed Console Logs
- Deleted `console.log` statements from:
  - `src/config/resend.config.ts`
  - `src/sockets/socketHandlers.ts`
  - `src/config/hubtel.ts`

### TypeScript Config (`tsconfig.json`)
- Removed `paths` override for `@prisma/client`
- Simplified `include` to just `["src/**/*.ts"]`

### Dockerfile (`Dockerfile`)
- Converted to **multi-stage build** (builder + runner) using `node:20.19-alpine3.21`
- Production image excludes dev dependencies (`npm ci --omit=dev`)
- Changed exposed port from `3000` → `5000`

### Build/Deploy
- `render.yaml`: Changed `npm install` → `npm ci` for reproducible installs
- `.gitignore`: Added `.env.*`, `endpoints.txt`, `hollali.md`, `*.docx`

---

## File Inventory

| File | Status |
|------|--------|
| `.env` | Created |
| `.gitignore` | Modified |
| `Dockerfile` | Modified (multi-stage build) |
| `package.json` | Modified (dependency cleanup) |
| `render.yaml` | Modified |
| `tsconfig.json` | Modified |
| `prisma/schema.prisma` | Modified (indexes, removed commented models) |
| `prisma/migrations/20260707154431_add_admin_verification_approval_fields/` | Created |
| `src/Modules/` | Deleted (renamed to `src/modules/`) |
| `src/modules/` | Created (all module controllers) |
| `src/config/hubtel.ts` | Modified |
| `src/config/resend.config.ts` | Modified |
| `src/config/swagger.ts` | Modified |
| `src/helpers/client-ref.ts` | Modified (crypto.randomBytes) |
| `src/helpers/ledger.ts` | Created |
| `src/helpers/otp.ts` | Modified (bcrypt hashing) |
| `src/helpers/payment.ts` | Created |
| `src/helpers/stringHelper.ts` | Modified |
| `src/index.ts` | Modified (graceful shutdown) |
| `src/jobs/check-pending-payments.ts` | Modified |
| `src/jobs/user-cleanup.ts` | Modified |
| `src/middleware/hubtel-callback.ts` | Created |
| `src/routes/admin-profile-routes.ts` | Modified |
| `src/routes/admin.routes.ts` | Modified (requireAdmin added) |
| `src/routes/itinerary.routes.ts` | Modified |
| `src/routes/tour.routes.ts` | Modified (removed bookings endpoint) |
| `src/routes/visa.routes.ts` | Modified |
| `src/routes/*.ts` (all others) | Modified (import path fix) |
| `src/server.ts` | Modified (rate limiting, cleanup) |
| `src/sockets/socketHandlers.ts` | Modified |
| `src/validator/index.ts` | Modified |
| `src/validator/password-auth-validator.ts` | Modified |
| `src/Modules/profile-management/admin-profile.controller.ts` | Created |
| `src/routes/admin-profile-routes.ts` | Created |
