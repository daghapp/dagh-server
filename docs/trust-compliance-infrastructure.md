# Trust & Compliance Infrastructure — Implementation Plan

**Progress:** Phases 1–4 implemented — identity, moderation, forums/comments, listings. Phases 5–8 planned.

**Project:** Diaspora Affairs Ghana (DAGH) backend (`dagh-server`)
**Owner:** Backend (trust & compliance module)
**Status:** Planning document — maps the platform's promises to concrete work on top of the existing codebase.
**Build order (dependency order):** identity → posting with moderation → forums & comments → property/land listings → payments & crowdfunding → webinars/events → daily news brief. Each layer depends on the one before it.

This plan reuses existing primitives wherever possible: Prisma/PostgreSQL, Express 5 + Zod, JWT + Passport, AES-256-GCM encryption (`src/helpers/encryption.ts`), Redis queues/locks (`src/helpers/jobLock.ts`), Socket.IO, Cloudinary, Resend, the `NotificationOutbox`, `AdminActivityLog`, `DataPolicy`, and the admin permission matrix (`src/middleware/permissions.ts`).

---

## 0. What already exists (do not rebuild)

| Goal area | Existing foundation |
|---|---|
| Identity (partial) | `User`, `UserProfile`, `UserVerification`, `ProfileVerification` (phone/ip/bio/doc steps), `otp`, `kyc-verification.service.ts`, admin profile-verification endpoints |
| Moderation (partial) | `UserReport`, `PendingSite`, `SitePhoto` + moderation queue, admin reports endpoints, `UserWarning`, `UserStatusHistory` |
| Listings (partial) | `PendingSite`, `TourSite`, site photos gallery |
| Payments | `Payment`, `HubtelDirectReceiveLog`, `LedgerAccount`, `LedgerTransaction`, `TransactionFlag`, `PaymentRisk`, `PaymentGatewayConfig` (encrypted creds), payment control system docs |
| Admin RBAC | `AdminProfile`, `AdminRole`, `AdminDepartment`, permission matrix, TOTP/SMS/backup codes, MFA |
| Queues/cron | node-cron + Redis distributed locks, `NotificationOutbox`, push delivery worker |
| Compliance | `DataPolicy`, `AuditLog`, `AdminActivityLog`, consent (`ContactSyncConsent`) |
| Feeds/cache | Redis, Socket.IO, announcement service |

Net-new work is concentrated in: selfie/face match + OTP pipeline hardening, a unified **content moderation pipeline** (pre-publish AI screening + appeals), forums/comments, property/land listings + GELIS/lawyer search + date-stamped badges, MoMo/Stripe/PayPal crowdfunding + ticketed webinars, webinar access/recording, and the daily brief engine.

---

## 1. Identity & access

### 1.1 Verification pipeline (ID upload, selfie match, OTP)

**Goal:** only verified users can post, list, host, or fundraise.

**Schema additions**

```prisma
enum VerificationMethod { OTP SMS OTP_EMAIL ID_UPLOAD SELFIE_MATCH LIVENESS }
enum IdentityVerificationStatus { NOT_STARTED IN_PROGRESS PENDING_REVIEW APPROVED REJECTED APPEALED }

model IdentityVerification {
  id              String   @id @default(uuid())
  userId          String   @unique
  status          IdentityVerificationStatus @default(NOT_STARTED)
  // biometric + ID data stored encrypted (see §security)
  idDocumentType  String?   // GHANA_CARD | PASSPORT | VOTERS_ID | DRIVERS_LICENSE
  idNumberHash    String?   // hashed, never plaintext at rest beyond decrypt boundary
  idFrontUrl      String?   // Cloudinary, access-controlled
  idBackUrl       String?
  selfieUrl       String?
  livenessScore   Float?
  faceMatchScore  Float?
  otpVerifiedAt   DateTime?
  reviewedBy      String?   // admin userId
  reviewedAt      DateTime?
  rejectionReason String?
  consentVersion  String    // Ghana DPA consent version accepted
  consentedAt     DateTime
  retentionUntil  DateTime  // auto-purge deadline
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  appeals         VerificationAppeal[]
}

model VerificationAppeal {
  id            String   @id @default(uuid())
  verificationId String
  userId        String
  reason        String   @db.Text
  evidenceUrls   String[]
  status        String   @default("PENDING") // PENDING | APPROVED | REJECTED
  reviewedBy    String?
  reviewedAt    DateTime?
  decisionNote  String?
  createdAt     DateTime @default(now())
  verification  IdentityVerification @relation(fields: [verificationId], references: [id])
}
```

**Roles/permissions:** extend `AccountType`/`VerificationLevel`. Add `canPost`, `canListProperty`, `canHostWebinar`, `canFundraise` derived from `IdentityVerification.status === APPROVED` + level. Enforce via a `requireVerified(action)` middleware (`src/middleware/`) that calls `kyc-verification.service.ts` and returns 403 `VERIFICATION_REQUIRED` with next step (reuse `KYCVerificationError` pattern).

**Pipeline (async, queued):**
1. `POST /verification/identity/start` → create row, record consent.
2. `POST /verification/identity/otp/send` + `/verify` (reuse `otp` model + Hubtel SMS).
3. `POST /verification/identity/id-upload` (multipart → Cloudinary, store URL).
4. `POST /verification/identity/selfie` (multipart).
5. Enqueue `verification.process` job: liveness check → face match (selfie vs ID) → score. Use a queue (BullMQ on Redis, or the existing cron+lock pattern for v1).
6. Admin review queue `GET /admin/verifications` (PENDING_REVIEW), approve/reject with reason.
7. Appeal flow `POST /verification/identity/appeal`.

**New job:** `src/jobs/verification-processing.ts` (cron/worker) + distributed lock.

### 1.2 Role-based permissions

Extend `PERMISSIONS` in `src/middleware/permissions.ts` with `IDENTITY.*`, `CONTENT.*`, `LISTINGS.*`, `FUNDRAISING.*`, `WEBINARS.*`. Map to `AdminRole`. Add user-side capability flags resolved from verification status (not admin roles) for end users.

---

## 2. Moderation pipeline (pre-publish AI screening)

**Goal:** clean flow for approved/rejected/flagged posts, admin review queue, appeals.

**Schema additions**

```prisma
enum ContentKind { POST COMMENT FORUM_THREAD LISTING WEBINAR }
enum ModerationStatus { PENDING APPROVED REJECTED FLAGGED }

model ContentPost {
  id            String   @id @default(uuid())
  kind          ContentKind
  authorId      String
  title         String?
  body          String   @db.Text
  mediaUrls     String[]
  status        ModerationStatus @default(PENDING)
  aiScore       Float?   // 0..1 risk
  aiLabels      String[] // e.g. hate, spam, nsfw, pii
  aiProvider    String?  // e.g. "openai-moderation"
  screenedAt    DateTime?
  reviewedBy    String?
  reviewedAt    DateTime?
  rejectionReason String?
  appealId      String?
  publishedAt   DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  author        User     @relation(fields: [authorId], references: [id])
  appeals       ContentAppeal[]
  @@index([status, createdAt])
  @@index([authorId, status])
}

model ContentAppeal {
  id        String   @id @default(uuid())
  postId    String
  userId    String
  reason    String   @db.Text
  status    String   @default("PENDING")
  reviewedBy String?
  reviewedAt DateTime?
  decisionNote String?
  createdAt DateTime @default(now())
  post      ContentPost @relation(fields: [postId], references: [id])
}
```

**Flow:**
- `POST /content/posts` → creates `PENDING`, enqueues `moderation.screen` job, returns 202 with status.
- Worker calls AI moderation API (OpenAI Moderation or Azure Content Safety), sets `aiScore/aiLabels`, transitions: score < 0.3 → APPROVED (auto-publish), 0.3–0.7 → FLAGGED (admin queue), ≥0.7 → REJECTED.
- Admin queue `GET /admin/moderation/queue?status=FLAGGED|PENDING`, actions approve/reject.
- User appeal `POST /content/posts/:id/appeal`.
- Notifications via `NotificationOutbox` on state change.

**New job:** `src/jobs/content-moderation.ts`. Reuse existing queue pattern (cron + lock + per-item claim in Redis).

**Permissions:** `CONTENT.VIEW/MODERATE/APPEAL`.

---

## 3. Forums & comments

**Schema additions**

```prisma
model Forum {
  id          String   @id @default(uuid())
  slug        String   @unique
  name        String
  description String?
  isPublic    Boolean  @default(true)
  createdAt   DateTime @default(now())
}

model ForumThread {
  id        String   @id @default(uuid())
  forumId   String
  authorId  String
  title     String
  body      String   @db.Text
  status    ModerationStatus @default(PENDING)
  pinned    Boolean  @default(false)
  locked    Boolean  @default(false)
  replyCount Int     @default(0)
  lastActivityAt DateTime @default(now())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  forum     Forum    @relation(fields: [forumId], references: [id])
  author    User     @relation(fields: [authorId], references: [id])
  comments  Comment[]
}

model Comment {
  id        String   @id @default(uuid())
  threadId  String?
  postId    String?  // for content posts
  parentId  String?  // nested replies
  authorId  String
  body      String   @db.Text
  status    ModerationStatus @default(PENDING)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  author    User     @relation(fields: [authorId], references: [id])
  thread    ForumThread? @relation(fields: [threadId], references: [id])
}
```

**APIs:** `GET /forums`, `GET /forums/:slug/threads`, `POST /forums/:slug/threads` (verified users only), `POST /threads/:id/comments`, `PATCH/DELETE` (owner or mod). All user-generated text routes through moderation pipeline (§2) before publish; replies to approved threads may be auto-approved for verified users with low risk score (configurable).

**Caching:** Redis cache for thread lists (TTL 60s), invalidate on new post/comment.

---

## 4. Property & land listings

**Schema additions**

```prisma
enum ListingType { SALE RENT LEASE }
enum ListingStatus { DRAFT PENDING_VERIFICATION VERIFIED REJECTED EXPIRED }
enum BadgeType { VERIFIED_DATE_STAMPED GELIS_CONFIRMED LAWYER_REVIEWED }

model PropertyListing {
  id            String   @id @default(uuid())
  ownerId       String
  type          ListingType
  title         String
  description   String   @db.Text
  priceGhs      Decimal  @db.Decimal(18,2)
  currency      String   @default("GHS")
  region        String
  district      String?
  address       String?
  latitude      Float?
  longitude     Float?
  images        String[]
  documents     String[]  // title deed, site plan (encrypted storage refs)
  status        ListingStatus @default(DRAFT)
  verifiedAt    DateTime?
  verifiedBy    String?   // admin or lawyer
  badge         BadgeType?
  badgeIssuedAt DateTime?
  gelisRef      String?   // GELIS (Ghana Enterprise Land Information System) reference
  lawyerId      String?   // assigned lawyer
  expiresAt     DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  owner         User     @relation(fields: [ownerId], references: [id])
  searchRequests ListingSearchRequest[]
  @@index([status, region, type])
  @@index([ownerId])
}

model ListingSearchRequest {
  id          String   @id @default(uuid())
  requesterId String
  listingId   String?
  query       String
  searchType  String   // GELIS | LAWYER | TITLE_DEED
  status      String   @default("PENDING")
  resultRef   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  requester   User     @relation(fields: [requesterId], references: [id])
  listing     PropertyListing? @relation(fields: [listingId], references: [id])
}
```

**APIs:** CRUD `/listings` (verified users), `POST /listings/:id/verify-request` (admin/lawyer queue), `POST /listings/:id/badge` (admin issues date-stamped badge), `POST /listings/search-requests` (GELIS/lawyer search), `GET /admin/listings/queue`.

**Date-stamped badges:** badge issuance writes `badgeIssuedAt = now()` and stores in `AdminActivityLog` + immutable audit row. Badge validity expiry optional.

**Permissions:** `LISTINGS.CREATE/VERIFY/MANAGE`.

---

## 5. Payments (MoMo, Stripe, PayPal) — no-escrow

**Principle:** platform never holds marketplace funds. Payments are pass-through to sellers/hosts; platform only collects fees/commissions and records ledger entries. Use provider-hosted checkout + webhooks; no escrow accounts.

**Schema additions**

```prisma
enum PaymentProviderExt { HUBTEL_MOMO STRIPE PAYPAL }
enum CrowdfundingStatus { DRAFT LIVE PAUSED COMPLETED CANCELLED }

model Campaign {
  id            String   @id @default(uuid())
  creatorId     String   // verified user
  title         String
  description   String   @db.Text
  goalAmount    Decimal  @db.Decimal(18,2)
  currency      String   @default("GHS")
  raisedAmount  Decimal  @default(0) @db.Decimal(18,2)
  status        CrowdfundingStatus @default(DRAFT)
  startDate     DateTime?
  endDate       DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  creator       User     @relation(fields: [creatorId], references: [id])
  contributions Contribution[]
}

model Contribution {
  id            String   @id @default(uuid())
  campaignId    String
  contributorId String?
  amount        Decimal  @db.Decimal(18,2)
  currency      String
  provider      PaymentProviderExt
  providerRef   String   @unique
  status        PaymentStatus
  anonymous     Boolean  @default(false)
  createdAt     DateTime @default(now())
  campaign      Campaign @relation(fields: [campaignId], references: [id])
  contributor   User?    @relation(fields: [contributorId], references: [id])
}

model Webinar {
  id            String   @id @default(uuid())
  hostId        String
  title         String
  description   String?  @db.Text
  startTime     DateTime
  durationMin   Int
  isPaid        Boolean  @default(false)
  price         Decimal? @db.Decimal(18,2)
  currency      String   @default("GHS")
  capacity      Int?
  registeredCount Int    @default(0)
  recordingUrl  String?  // Cloudinary/S3
  status        String   @default("SCHEDULED")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  host          User     @relation(fields: [hostId], references: [id])
  registrations WebinarRegistration[]
}

model WebinarRegistration {
  id          String   @id @default(uuid())
  webinarId   String
  userId      String
  paid        Boolean  @default(false)
  paymentRef  String?
  joinedAt    DateTime?
  createdAt   DateTime @default(now())
  webinar     Webinar  @relation(fields: [webinarId], references: [id])
  user        User     @relation(fields: [userId], references: [id])
  @@unique([webinarId, userId])
}
```

**Payment routing:** extend `Payment` model with `provider PaymentProviderExt` and `targetType` additions (`CROWDFUNDING`, `WEBINAR_TICKET`). Reuse `payment.service.ts` + gateway config. Add Stripe + PayPal clients (new `src/services/stripe.service.ts`, `paypal.service.ts`) alongside Hubtel.

**Webhooks:** `POST /payment/webhooks/stripe`, `/paypal`, `/hubtel` (existing callback). Idempotent by `providerRef`. Verify signatures. Update contribution/registration + ledger entries + `TransactionFlag` fraud checks.

**Fraud checks:** amount velocity limits, duplicate card detection (tokenized), IP/geo anomalies, blacklist. Write `PaymentRisk` rows; auto-flag suspicious for admin review. Reuse `TransactionFlag`.

**No-escrow:** funds settle directly to creator/host merchant accounts via provider split payments (Stripe Connect / PayPal marketplace) or manual payout records; platform only records commission ledger entries.

---

## 6. Webinar & events backend

**Access control:** free vs paid. Free → register (counter++); paid → payment webhook confirms then register. Capacity enforced atomically (increment with condition `registeredCount < capacity`).

**Attendee identity hiding:** registration counter increments; attendee list not exposed publicly; only host/admin see aggregate counts. `GET /webinars/:id` returns `registeredCount`, not identities.

**Recording storage:** on completion, host uploads recording → Cloudinary/S3 → `recordingUrl`; access gated to registrants (signed URL, expiry).

**APIs:** `GET /webinars`, `POST /webinars` (verified hosts), `POST /webinars/:id/register`, `POST /webinars/:id/join` (returns LiveKit/room token), `POST /webinars/:id/recording` (host).

**Reuse:** LiveKit for live sessions (existing `livekit-server-sdk`), calls infrastructure patterns.

---

## 7. Daily news brief engine

**Goal:** scheduled job collects day's content, generates summary, pushes to feeds and notifications.

**Schema additions**

```prisma
model DailyBrief {
  id          String   @id @default(uuid())
  date        DateTime @unique @db.Date
  title       String
  summary     String   @db.Text
  sourceIds   String[] // content post ids
  status      String   @default("DRAFT") // DRAFT | PUBLISHED
  publishedAt DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

**Job:** `src/jobs/daily-brief.ts` runs daily (e.g. 06:00 Africa/Accra) under distributed lock:
1. Collect approved content posts from last 24h (forums, comments, listings).
2. Generate summary via LLM (OpenAI/Neon AI gateway) — reuse AI gateway config if present.
3. Store `DailyBrief`.
4. Fan out: create `Announcement`/feed entry, push notifications via `NotificationOutbox`, Socket.IO broadcast.

**APIs:** `GET /briefs/latest`, `GET /briefs/:date`, admin `POST /admin/briefs/generate` (manual trigger), `PATCH /admin/briefs/:id/publish`.

---

## 8. Cross-cutting

### 8.1 Security & compliance (Ghana DPA)

- Biometric/ID data encrypted at rest (AES-256-GCM, reuse `encryption.ts` with context strings `identity:idNumber`, `identity:document`).
- Consent recorded with version + timestamp (`consentVersion`, `consentedAt`).
- Retention rules: `retentionUntil` on identity rows; scheduled purge job `src/jobs/data-retention.ts` deletes expired biometric/ID artifacts and anonymizes rows; logs to `AuditLog`.
- Access to biometric data restricted to verified admins with `IDENTITY.VIEW_BIOMETRIC` permission; all access audited.
- Audit logs: extend `AuditLog` with `actorId, action, resourceType, resourceId, ip, requestId, metadata`.

### 8.2 Reliability & scale

- Queues: use Redis + BullMQ for slow tasks (AI screening, verification, summaries, image moderation). For v1, reuse existing cron+lock+per-item-claim pattern (`tryAcquireWorkItem`) to avoid new infra; migrate to BullMQ when volume demands.
- Caching: Redis for feeds (briefs, forum lists, listings) with TTL + invalidation.
- Monitoring: Sentry already wired; add job success/failure metrics + admin digest (reuse `weeklyDigestJob`).

### 8.3 Clean APIs

- Stable contracts: Zod validators per module (`src/validator/`), Swagger annotations, standardized envelope (`fail`/`ok`).
- Admin tooling: moderation queue, verification queue, listings queue, campaign oversight — under `/admin/*` with permission gates.
- Versioning: prefix `/api/v1` optional future; for now keep existing paths and add new modules.

---

## 9. Milestones (aligned to build order)

| # | Milestone | Deliverables |
|---|---|---|
| M1 | Identity | Identity verification schema + pipeline + OTP + selfie match + admin review + appeals + `requireVerified` middleware |
| M2 | Posting + moderation | `ContentPost` + AI screening job + admin queue + appeals + permissions |
| M3 | Forums & comments | Forum/Thread/Comment + moderation integration + caching |
| M4 | Listings | PropertyListing + search requests + GELIS/lawyer + date-stamped badges |
| M5 | Payments & crowdfunding | Stripe/PayPal clients + webhooks + Campaign/Contribution + fraud checks |
| M6 | Webinars | Webinar + registration + access control + recording storage |
| M7 | Daily brief | DailyBrief + collector + generator + fan-out job |
| M8 | Compliance hardening | Encryption audit, retention purge job, audit log enrichment, monitoring |

Each milestone includes: migration, validators, controllers, routes, Swagger docs, tests (vitest), job wiring in `server.ts`.

---

## 10. Open decisions

- AI moderation provider (OpenAI Moderation vs Azure Content Safety) and budget.
- Face-match provider (AWS Rekognition / Azure Face / on-device) — affects biometric data residency under Ghana DPA.
- Stripe/PayPal account ownership and Connect onboarding for no-escrow payouts.
- Whether to introduce BullMQ now or stay on cron+lock pattern.
- Retention period for biometric data (recommend 90 days post-decision, then purge).
- Legal review of consent text and DPA compliance.

---

## 11. Conventions to follow (from existing codebase)

- Prisma schema → migration → `prisma generate`; client in `generated/prisma`.
- Controllers in `src/modules/<domain>/`, routes in `src/routes/`, validators in `src/validator/`.
- Jobs in `src/jobs/`, wired in `src/server.ts`, use `withDistributedLock`.
- Responses use `fail`/`ok` helpers; errors via thrown exceptions caught by Express error handler.
- Swagger JSDoc on routes; tests in `tests/` with vitest.
- No comments unless requested; follow existing formatting (prettier).
