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

## File Inventory

| File | Status |
|------|--------|
| `.env` | Created |
| `tsconfig.json` | Modified |
| `prisma/schema.prisma` | Modified |
| `prisma/migrations/20260707154431_add_admin_verification_approval_fields/` | Created |
| `src/Modules/profile-management/admin-profile.controller.ts` | Created (moved from `src/modules/profile-management/admin-profile-controller.ts`) |
| `src/routes/admin-profile-routes.ts` | Created |
| `src/server.ts` | Modified |
