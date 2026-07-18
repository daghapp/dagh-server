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

---

## 16. Phase 1 — Critical Security Fixes (Commits: 0822ef9)

### 1.1 Stop leaking `passwordHash` in API responses
**File:** `src/modules/authentication/password-auth.controller.ts`
- Registration response now strips `passwordHash` using destructuring: `const { passwordHash: _, ...safeUser } = newUser`
- Only safe fields returned to client

### 1.2 Tighten CORS configuration
**File:** `src/server.ts`
- Removed `|| '*'` fallback from CORS origin
- Now requires `ALLOWED_ORIGINS` env var (comma-separated list)
- If unset, no cross-origin requests are allowed (empty array fallback)
- Applied to both Express CORS middleware and Socket.IO CORS config

### 1.3 Protect file upload endpoint
**File:** `src/routes/image-upload.route.ts`
- Added `protectedRoute` middleware to `POST /upload`
- Previously anyone could upload to Cloudinary without authentication

### 1.4 Stop passing tokens in redirect URLs
**Files:** `src/modules/authentication/google-auth.controller.ts`, `src/modules/authentication/facebook-auth.controller.ts`
- Web OAuth callbacks now store `accessToken` and `refreshToken` in HTTP-only cookies
- Mobile deep links (`daghapp://`, `daghguard://`) still pass tokens in URLs (expected for app-to-app redirect)
- Cookies use `httpOnly: true`, `secure: true` (production), `sameSite: lax`

### 1.5 Fix Hubtel config failure mode
**File:** `src/config/hubtel.ts`
- Now validates all required env vars at boot time
- Throws clear error: `Missing required Hubtel env vars: HUBTEL_CLIENT_ID, ...`
- Previously crashed mid-request with cryptic undefined errors

---

## 17. Phase 2 — Architecture & Wiring Fixes (Commits: f5bbbf0)

### 2.1 Wire up messages module
**File:** `src/server.ts`, `src/modules/messages/messages.controller.ts`
- Registered `MessageRoutes` at `/messages` in server.ts
- Called `setIoInstance(io)` after Socket.IO initialization
- Real-time messaging now functional (previously dead code)

### 2.2 Extract fat controllers into services
**New file:** `src/services/payment.service.ts`
- Extracted `initializePayment()` and `initializePaymentMOMO()` from `PaymentController`
- Both functions use `prisma.$transaction()` for atomic DB writes + Hubtel API calls
- Removed duplicate static/instance method patterns from `payment.controller.ts`
- All controllers (tour, visa, itinerary) now import from payment service

### 2.3 Wrap multi-step payment flows in transactions
**File:** `src/services/payment.service.ts`
- `initializePayment()`: Hubtel API call + Payment record + HubtelDirectReceiveLog all wrapped in `$transaction`
- `initializePaymentMOMO()`: Payment record + Hubtel API call + status update all wrapped in `$transaction`
- If any step fails, entire transaction rolls back

### 2.4 Drive pricing from config
**New file:** `src/config/pricing.ts`
- Replaces hardcoded amounts (464, 1450 GHS, 200 USD) with env-driven config
- Defaults: `VISA_STANDARD_FEE_GHS=464`, `VISA_EXPEDITED_FEE_GHS=1450`, `VISA_STATUTORY_FEE_USD=200`
- Updated in: `check-pending-payments.ts`, `user-visa.controller.ts`, `itinerary.payment.controller.ts`

### 2.5 Fix naming inconsistencies
**Files:** `src/validator/payment-validator.ts`, `src/routes/payment.routes.ts`
- Renamed `SubscribtionPaymentSchema` → `subscriptionPaymentSchema` (typo fix)
- Updated all imports across codebase

---

## 18. Phase 3 — Quality & Developer Experience (Commits: 61ce0fe + unpushed)

### 3.1 Linting and formatting
**New files:** `eslint.config.js`, `.prettierrc`, `.prettierignore`
- ESLint with typescript-eslint + prettier integration
- Prettier config matching existing code style (semi, double quotes, trailing commas, 100 width)
- Scripts added to package.json: `lint`, `lint:fix`, `format`, `format:check`
- `src/views/` excluded from linting (browser scripts, not TypeScript)

### 3.2 Environment template
**New file:** `.env.example`
- Documents all required environment variables with descriptions
- `.gitignore` updated to un-ignore `.env.example` (tracked in git)

### 3.3 Standardized API response format
**New file:** `src/helpers/response.ts`
- Created `ok()`, `created()`, `fail()`, `paginated()` response helpers
- Standardized 22 controllers + 3 middleware files (previously 11 distinct response shapes)
- Success: `{ success: true, data: T, message?: string }`
- Error: `{ success: false, error: string, details?: unknown }`
- Paginated: `{ success: true, data: T[], pagination: { total, page, limit, totalPages } }`

**Updated controllers:**
- `password-auth.controller.ts` — All responses use helpers
- `auth-admin.controller.ts` — Paginated user list uses `paginated()`
- `admin-profile.controller.ts` — All responses standardized
- `profile.verification.controller.ts` — Removed `data: null` from errors
- `profile.init.controller.ts` — Responses standardized
- `profile.bio-url.controller.ts` — Responses standardized
- `profile-ethnicity.controller.ts` — Responses standardized
- `profile-bio-document.controller.ts` — Responses standardized
- `profile.validation-step.controller.ts` — Responses standardized
- `payment.controller.ts` — All responses use helpers
- `user-visa.controller.ts` — Fixed bare `{ error }` shapes, now uses `fail()`
- `admin-visa.controller.ts` — Responses standardized
- `admin-tour.controller.ts` — Fixed bare `{ message }` shapes, now uses `ok()`/`fail()`
- `user-tour.controller.ts` — Fixed bare `{ bookings }` shapes, now uses `ok()`
- `itinerary.controller.ts` — Responses standardized
- `itinerary.payment.controller.ts` — Responses standardized
- `messages.controller.ts` — Fixed bare `{ error }` shapes, now uses `fail()`
- `image-upload.controller.ts` — Fixed bare `{ message }` shapes
- `provider-nearby-hotels.controller.ts` — Responses standardized

**Updated middleware:**
- `protected.ts` — Uses `fail()` for auth errors
- `admin.ts` — Uses `fail()` for role errors
- `hubtel-callback.ts` — Uses `fail()`/`ok()` for callback responses

**Updated server.ts:**
- 404 catch-all and global error handler now use `fail()`
- Rate limiter messages use `{ success: false, error: ... }` (was `{ success, message }`)

### 3.4 README rewrite
**File:** `README.md`
- Fully rewritten to reflect actual schema, endpoints, and tech stack
- Removed references to unimplemented features (dating, reviews, Paystack, Stripe, PostGIS, iCloud auth)
- Added accurate endpoint tables for all modules

### 3.5 Build config
**File:** `.gitignore`
- Added `dist/` to ignore compiled output

**File:** `src/seed.ts`
- Removed unused `@ts-ignore` directive

### 3.6 Swagger documentation
**File:** `src/routes/tour.routes.ts`
- Added missing Swagger JSDoc for `POST /tours/bookings` endpoint

### 3.7 Code formatting
- Entire codebase formatted with Prettier
- All TypeScript files now consistent (semicolons, double quotes, trailing commas, 100-char width)

### 3.8 Dead route cleanup
**Deleted files:**
- `src/routes/bio_profile_url.routes.ts` — Duplicate of `/verification/bio_profile_url` in `verification.routes.ts`, never imported or mounted in `server.ts`
- `src/routes/bio_profile_document_url.routes.ts` — Duplicate of `/verification/bio_document_urls` in `verification.routes.ts`, never imported or mounted in `server.ts`

Both files were dead code: same handlers, same validation, same controllers already wired through `verification.routes.ts` at `/verification/`.

### 3.9 Swagger path corrections
**File:** `src/routes/message.routes.ts`
- Fixed 4 Swagger annotations: `/api/messages` → `/messages`
- Routes are mounted at `/messages` in server.ts, but Swagger docs referenced `/api/messages`
- Corrected: `/messages`, `/messages/conversations`, `/messages/conversations/{conversationId}`, `/messages/{messageId}/read`

---

## 19. Complete File Inventory (Phases 1-3)

| File | Phase | Status |
|------|-------|--------|
| `src/helpers/response.ts` | 3.3 | Created |
| `src/services/payment.service.ts` | 2.2 | Created |
| `src/config/pricing.ts` | 2.4 | Created |
| `eslint.config.js` | 3.1 | Created |
| `.prettierrc` | 3.1 | Created |
| `.prettierignore` | 3.1 | Created |
| `.env.example` | 3.2 | Created |
| `src/routes/bio_profile_url.routes.ts` | 3.8 | Deleted |
| `src/routes/bio_profile_document_url.routes.ts` | 3.8 | Deleted |
| `src/modules/authentication/password-auth.controller.ts` | 1.1, 3.3 | Modified |
| `src/modules/authentication/google-auth.controller.ts` | 1.4 | Modified |
| `src/modules/authentication/facebook-auth.controller.ts` | 1.4 | Modified |
| `src/modules/authentication/auth-admin.controller.ts` | 3.3 | Modified |
| `src/modules/profile-management/admin-profile.controller.ts` | 3.3 | Modified |
| `src/modules/profile-management/profile.verification.controller.ts` | 3.3 | Modified |
| `src/modules/profile-management/profile.init.controller.ts` | 3.3 | Modified |
| `src/modules/profile-management/profile.bio-url.controller.ts` | 3.3 | Modified |
| `src/modules/profile-management/profile-ethnicity.controller.ts` | 3.3 | Modified |
| `src/modules/profile-management/profile-bio-document.controller.ts` | 3.3 | Modified |
| `src/modules/profile-management/profile.validation-step.controller.ts` | 3.3 | Modified |
| `src/modules/payment-management/payment.controller.ts` | 2.2, 3.3 | Modified |
| `src/modules/visa-management/user-visa.controller.ts` | 2.4, 3.3 | Modified |
| `src/modules/visa-management/admin-visa.controller.ts` | 3.3 | Modified |
| `src/modules/tour-management/admin-tour.controller.ts` | 3.3 | Modified |
| `src/modules/tour-management/user-tour.controller.ts` | 2.2, 3.3 | Modified |
| `src/modules/itinerary/itinerary.controller.ts` | 3.3 | Modified |
| `src/modules/itinerary/itinerary.payment.controller.ts` | 2.2, 3.3 | Modified |
| `src/modules/messages/messages.controller.ts` | 2.1, 3.3 | Modified |
| `src/modules/common/image-upload.controller.ts` | 3.3 | Modified |
| `src/modules/provider-management/provider-nearby-hotels.controller.ts` | 3.3 | Modified |
| `src/middleware/protected.ts` | 3.3 | Modified |
| `src/middleware/admin.ts` | 3.3 | Modified |
| `src/middleware/hubtel-callback.ts` | 3.3 | Modified |
| `src/routes/image-upload.route.ts` | 1.3 | Modified |
| `src/routes/payment.routes.ts` | 2.5, 3.3 | Modified |
| `src/routes/tour.routes.ts` | 3.6, 3.9 | Modified |
| `src/routes/message.routes.ts` | 3.9 | Modified |
| `src/server.ts` | 1.2, 2.1, 3.3 | Modified |
| `src/config/hubtel.ts` | 1.5 | Modified |
| `src/jobs/check-pending-payments.ts` | 2.4 | Modified |
| `src/validator/payment-validator.ts` | 2.5 | Modified |
| `src/seed.ts` | 3.5 | Modified |
| `.gitignore` | 3.5 | Modified |
| `package.json` | 3.1 | Modified |
| `README.md` | 3.4 | Modified |
