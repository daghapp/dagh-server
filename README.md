# Diaspora Affairs Ghana (DAGH) — Backend API

REST API for the DAGH platform: tour management, visa-on-arrival processing, itinerary generation, membership plans & subscriptions, dating & matching, messaging, voice/video calling, and payments via Hubtel.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 |
| Framework | Express 5 + Helmet |
| Language | TypeScript 5.9 (strict) |
| Database | PostgreSQL + Prisma 7.4 ORM (driver adapter: `@prisma/adapter-pg`, config in `prisma.config.ts`) |
| Payments | Hubtel (Mobile Money: MTN, Telecel, AT + Cards) |
| File Storage | Cloudinary |
| Real-time | Socket.IO 4.8 |
| Auth | JWT (access + refresh tokens), Passport (Google, Facebook, Apple) |
| Validation | Zod 4 |
| Email | Resend |
| API Docs | Swagger (swagger-jsdoc + swagger-ui-express) at `/api-docs` |
| Linting | ESLint 10 + Prettier |

---

## Getting Started

```bash
# Install dependencies
npm ci

# Set up environment
cp .env.example .env   # then fill in values

# Run migrations (Prisma 7 reads DATABASE_URL from .env via prisma.config.ts)
npx prisma migrate dev

# Generate Prisma client (output: generated/prisma, importFileExtension = "js")
npx prisma generate

# Seed database (25 tour sites + ledger accounts + 9 membership plans + demo users/tours)
npm run db:seed

# Build (runs `prisma generate && tsc`; the Prisma client is compiled into dist/generated)
npm run build

# Start
npm start              # production (port 5000, or $PORT)
npm run dev            # development (nodemon + tsx hot reload)
```

## Demo accounts

`npm run db:seed` populates the database with test data for frontend development.
All demo users are `ACTIVE` and ready to log in via `POST /auth/login`:

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@dagh.app` | `Admin@12345` |
| Demo user (bookings, visa, paid subscription) | `demo@dagh.app` | `Demo@12345` |
| Demo user 2 | `demotwo@dagh.app` | `Demo@12345` |
| Dating profile (Ama Serwaa) | `dating.demo@dagh.app` | `Demo@12345` |
| Dating profile (Kwame Boateng) | `dating.demo2@dagh.app` | `Demo@12345` |
| Dating profile (Nana Yaa) | `dating.demo3@dagh.app` | `Demo@12345` |

The seed also adds 4 tour packages (with locations, itineraries and pricing),
2 sample bookings, dating matches/conversations/messages, 6 visa-on-arrival
requests across all statuses (with linked payments, approvals and admin
activity logs), an itinerary-tour-booking payment, and providers (hotels, a
tour guide, car rental). The seed is idempotent — re-running it never
duplicates existing rows.

**Docker:** the build does not require a live database — `prisma.config.ts` resolves
`DATABASE_URL` with a placeholder fallback so `prisma generate` succeeds without a
build arg. The running container still needs `DATABASE_URL` (and the other env vars)
set in its environment.

```bash
docker build -t dagh-server .
docker run -p 5000:5000 dagh-server
```

---

## Environment Variables

See `.env.example` for the full template. Key categories (all read directly from `process.env`):

```env
# Server
PORT=5000
NODE_ENV=production
API_URL=https://dagh-server-fo64.onrender.com

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/dagh
DATABASE_POOL_MAX=10            # pg pool per instance (optional, default 10)

# Redis — REQUIRED for running more than one instance behind a load balancer.
# Enables a shared Socket.IO adapter (realtime fan-out across instances),
# cross-instance presence, a shared rate-limit store, and distributed locks so
# the cron jobs run on exactly one replica. Leave unset for single-instance mode.
REDIS_URL=redis://localhost:6379

# Auth
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_SECRET=            # call/token signaling (optional, has a default)
SESSIONSECRET=

# Call / WebRTC media (LiveKit preferred; see https://cloud.livekit.io)
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
CALL_SERVICE_URL=      # fallback serviceUrl when LiveKit is not configured

# Firebase Cloud Messaging (required for push notifications)
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=

# Hubtel (required)
HUBTEL_CLIENT_ID=
HUBTEL_CLIENT_SECRET=
HUBTEL_MERCHANT_NUMBER=
HUBTEL_BASE_URL=

# Cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Email (Resend)
RESEND_API_KEY=

# CORS (comma-separated origins, required)
ALLOWED_ORIGINS=http://localhost:3000

# OAuth
CLIENTID=              # Google OAuth client ID
CLIENTSECRETE=         # Google OAuth client secret
REDIRECTURI=           # Google OAuth callback URL
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_CALLBACK_URL=
APPLE_CLIENT_ID=
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY_PATH=
APPLE_CALLBACK_URL=

# Currency
USD_TO_GHS_RATE=15.5

# Visa pricing (optional, defaults shown)
VISA_STANDARD_FEE_GHS=464
VISA_EXPEDITED_FEE_GHS=1450
VISA_STATUTORY_FEE_USD=200
```

---

## Scaling

The app runs as a single Node process per instance. To run multiple replicas
behind a load balancer:

1. **Set `REDIS_URL`** on every instance. Without it, Socket.IO messages,
   presence, and call signaling only reach sockets on the same process,
   rate-limit counters are per-instance, and each replica runs the cron jobs
   (causing duplicate payment checks / emails).
2. **Session store** is Postgres-backed (`connect-pg-simple`, `session` table
   auto-created), so OAuth/passport sessions survive restarts and are shared
   across instances.
3. **Cron jobs** (`check-pending-payments`, `user-cleanup`) run under a Redis
   distributed lock and per-item claims, so exactly one replica executes them
   and crashed runs can't double-credit the ledger.
4. **Presence** fan-out is scoped to conversation partners & matches instead of
   broadcasting to every connected client.
5. Keep the pg connection pool per instance proportional to replica count
   (`DATABASE_POOL_MAX`). Add a Postgres read replica when read-heavy endpoints
   (tours, discovery) become hot.

> Single instance, no `REDIS_URL`: everything still works — in-memory presence,
> default per-instance rate limiting, unlocked cron jobs.

---

## Project Structure

```
prisma.config.ts                # Prisma 7 config (datasource URL from env, migration path)
prisma/                         # schema.prisma + migrations
generated/prisma/               # Generated Prisma client (compiled into dist/generated on build)
src/
├── index.ts                    # Server start + graceful shutdown
├── server.ts                   # Express app setup, middleware, route mounting
├── seed.ts                     # Database seed (25 Ghana tour sites + ledger accounts + 9 membership plans)
├── config/                     # Prisma, Passport, Hubtel, session, Swagger, pricing, Cloudinary, Resend
├── helpers/                    # OTP, JWT, client refs, ledger, payment, haversine, response, safety, call state machine, call logger, push notifications, presence, livekit
├── jobs/                       # Cron jobs (pending payments, user cleanup, call expiry, push delivery)
├── middleware/                  # Auth, admin, validation, rate limiting, Cloudinary upload, audio upload, Hubtel callback
├── modules/
│   ├── admin/                  # Admin console (dashboard, visa console, payments console)
│   ├── authentication/         # Register, login, OAuth, password reset
│   ├── common/                 # Image upload
│   ├── data-policy/            # CMS-managed data policy (public read + admin CRUD)
│   ├── dating/                 # Dating profiles, discovery, swiping, matches
│   ├── devices/                # Device registration + notification preferences
│   ├── faq/                    # FAQ CRUD (admin) + public read
│   ├── geo/                    # Jurisdiction / geo-IP check
│   ├── itinerary/              # Itinerary generation + payment
│   ├── membership/             # Membership plans, subscriptions, priority support
│   ├── messages/               # Messaging, voice notes, calls, block/report (REST + Socket.IO)
│   ├── payment-management/     # Payment processing
│   ├── profile-management/     # Profile CRUD, verification, ethnicity
│   ├── provider-management/    # Nearby hotels
│   ├── tour-management/        # Tour CRUD, booking, admin
│   └── visa-management/        # Visa-on-arrival requests + approval
├── routes/                     # Express route definitions (26 files)
├── services/                   # Business logic (membership, payment, matching)
├── sockets/                    # Socket.IO handlers (auth, presence, call signaling)
├── types/                      # TypeScript type augmentations (Express.User)
├── validator/                  # Zod schemas (24 files)
└── views/                      # HTML/CSS for OAuth/payment callback pages
```

---

## API Endpoints

> **Detailed developer reference:** see `docs/api-reference.md` for every
> endpoint with payloads and examples, `docs/admin-console-api.md` for the admin
> console surface + frontend wiring patterns, `docs/admin-gateway-registration.md`
> for the Admin Gateway registration flow, `docs/verification-flow.md` for
> the identity-verification integration guide, `docs/call-integration-guide.md`
> for the voice/video calling frontend integration guide,
> `docs/payment-control-system.md` for the payment enable/disable toggle
> (admin API + public status endpoint), and `docs/push-notifications.md` for
> the push notification architecture.

All endpoints return responses in a standardized envelope:

**Success (single item):**
```json
{
  "success": true,
  "data": { ... },
  "message": "Optional success message"
}
```

**Success (paginated):**
```json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "total": 42,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  }
}
```

**Error:**
```json
{
  "success": false,
  "error": "Human-readable error message",
  "details": "Optional additional context (dev only)"
}
```

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/register` | Public | Register with email/password |
| POST | `/auth/login` | Public | Login (returns access + refresh tokens) |
| POST | `/auth/logout` | Bearer | Logout (revokes all refresh tokens) |
| POST | `/auth/verify-otp` | Public | Verify email OTP |
| POST | `/auth/resend-otp` | Public | Resend verification OTP |
| POST | `/auth/refresh-token` | Public | Get new access token |
| POST | `/auth/request-reset-password` | Public | Request password reset OTP |
| POST | `/auth/reset-password` | Public | Reset password with OTP |
| GET | `/auth/google` | Public | Google OAuth redirect |
| GET | `/auth/google/callback` | Public | Google OAuth callback |
| GET | `/auth/google/failed` | Public | Google OAuth failure page |
| GET | `/auth/google/success` | Public | Google OAuth success page |
| GET | `/auth/facebook` | Public | Facebook OAuth redirect |
| GET | `/auth/facebook/callback` | Public | Facebook OAuth callback |
| GET | `/auth/facebook/failed` | Public | Facebook OAuth failure page |
| GET | `/auth/facebook/success` | Public | Facebook OAuth success page |
| GET | `/auth/apple` | Public | Apple Sign In redirect |
| POST | `/auth/apple/callback` | Public | Apple Sign In callback |
| GET | `/auth/apple/failed` | Public | Apple OAuth failure page |
| GET | `/auth/apple/success` | Public | Apple OAuth success page |

### Profile Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/profile/init` | Bearer | Initialize profile |
| PATCH | `/profile` | Bearer | Update own `fullName`, `gender`, `dateOfBirth`, `ethnicity` |
| PATCH | `/profile/ethnicity` | Bearer | Set ethnicity |

### Profile Verification

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/verification/init` | Bearer | Initialize verification |
| POST | `/verification/phone/send-otp` | Bearer | Send phone verification OTP (returns `challengeId`) |
| POST | `/verification/phone/verify-otp` | Bearer | Verify phone OTP (requires `challengeId` + `code`) |
| POST | `/verification/bio_profile_url` | Bearer | Submit bio profile URL |
| POST | `/verification/bio_document_urls` | Bearer | Submit bio documents |
| GET | `/verification/status` | Bearer | Full verification status (per-step status, current step, completed steps) |
| GET | `/verification/validation-step/status` | Bearer | Get current verification step |

#### Phone OTP contract

The OTP flow uses a **challenge ID** pattern:

1. `POST /verification/phone/send-otp` — sends a 6-digit code and returns a `challengeId` (UUID), `expiresAt` (10 min), and `resendAvailableAt` (1 min). Resending invalidates all older active codes.
2. `POST /verification/phone/verify-otp` — requires `challengeId` and `code` (6 digits). Returns stable error codes: `OTP_INVALID`, `OTP_EXPIRED`, `OTP_CHALLENGE_NOT_FOUND`.

Phone numbers are normalized to digits-only before storage (strips `+`, spaces, dashes, parentheses). A code sent to `+233501234567` works with `233501234567`.

Rate limits: 10 OTP requests per 15 minutes per IP. Never logs raw OTP values.

#### Verification status response

`GET /verification/status` returns two existence flags to avoid routing confusion:

```json
{
  "success": true,
  "data": {
    "verificationProfileExists": true,
    "datingProfileExists": false,
    "isVerified": false,
    "currentStep": "DOCUMENT_VERIFICATION",
    "verificationMessage": null,
    "steps": {
      "PHONE_NUMBER_VERIFICATION": { "status": "VERIFIED", "verificationMessage": null },
      "PROFILE_IMAGE_VERIFICATION": { "status": "PENDING", "verificationMessage": null },
      "DOCUMENT_VERIFICATION": { "status": "PENDING", "verificationMessage": null }
    },
    "completedSteps": ["PHONE_NUMBER_VERIFICATION"]
  }
}
```

- `verificationProfileExists` — whether a `UserProfile` record exists (required for verification)
- `datingProfileExists` — whether a `DatingProfile` exists (separate from verification)
- `isVerified` — `true` **only** when all required steps are verified (derived, not stored)
- `currentStep` — the next actionable step; always agrees with individual step states
- Rejected steps include `verificationMessage` with the admin's rejection reason

`GET /verification/validation-step/status` returns the current step and its review state:

```json
{
  "success": true,
  "data": {
    "current_step": "DOCUMENT_VERIFICATION",
    "status": "REJECTED",
    "verification_message": "Expired document"
  }
}
```

- `current_step` is one of `PHONE_NUMBER_VERIFICATION`, `PROFILE_IMAGE_VERIFICATION`, `DOCUMENT_VERIFICATION` (an optional `?step=` query overrides inference).
- `status` is `PENDING` (awaiting review), `VERIFIED` (step completed/approved), or `REJECTED` (an admin rejected the step). `verification_message` is included only when `status` is `REJECTED` and contains the admin's rejection reason.

Verification flows: phone OTP → `bio_profile_url` (face scan) → `bio_document_urls` (passport/Ghana card).

### Tour Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/tours` | Public | List tours (filterable, paginated) |
| GET | `/tours/:tourId` | Public | Get tour details |
| POST | `/tours` | Admin | Create tour |
| PUT | `/tours/:id` | Admin | Update tour |
| DELETE | `/tours/:id` | Admin | Delete tour |
| POST | `/tours/:id/itinerary` | Admin | Create tour itinerary |
| PUT | `/tours/itinerary/:id` | Admin | Update tour itinerary |
| DELETE | `/tours/itinerary/:id` | Admin | Delete tour itinerary |
| POST | `/tours/bookings` | Bearer | Book a tour (Hubtel checkout) |
| POST | `/tours/initiate-booking-momo` | Bearer | Book a tour (Mobile Money) |
| POST | `/tours/hubtel-callback` | Hubtel | Hubtel payment callback |
| GET | `/tours/bookings/my` | Bearer | Get user's bookings |
| PATCH | `/tours/user-itineraries/:itineraryId` | Bearer | Update user itinerary |
| DELETE | `/tours/bookings/:bookingId` | Bearer | Cancel booking |

### Itinerary Generation

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/itinerary/sites` | Public | List all Ghana tour sites |
| POST | `/itinerary/request` | Bearer | Submit tour request with site selections (`casualDatingInterest=true` requires KYC verification) |
| GET | `/itinerary/requests` | Bearer | Get user's tour requests |
| GET | `/itinerary/my-itineraries` | Bearer | Get user's generated itineraries |
| GET | `/itinerary/:tourRequestId` | Bearer | Get generated itinerary by request ID (includes `datingSelections` + per-day `socialBlocks` when dating profiles are selected) |
| POST | `/itinerary/:tourRequestId/payment` | Bearer | Initiate itinerary payment (returns top-level `checkoutUrl`) |
| POST | `/itinerary/payment-callback` | Hubtel | Hubtel payment callback |
| POST | `/itinerary/:tourRequestId/dating-selections` | Bearer | Select recommended dating profiles to merge into the itinerary (KYC-gated) |
| GET | `/itinerary/:tourRequestId/dating-selections` | Bearer | List dating profiles merged into a tour's itinerary |

#### Payment response

`POST /itinerary/:tourRequestId/payment` returns the Hubtel checkout URL at the top level so the frontend can redirect immediately:

```json
{
  "success": true,
  "data": {
    "tourRequestId": "tour_request_id",
    "paymentId": "payment_id",
    "checkoutUrl": "https://checkout.hubtel.com/session/cs_123456",
    "checkoutId": "checkout_id",
    "clientReference": "ref",
    "paymentData": { "responseCode": "0000", "data": { "checkoutUrl": "https://..." } }
  },
  "message": "Payment initiated. Proceed to complete payment to view itinerary."
}
```

If the provider does not return a checkout URL, the endpoint fails with `502`.

#### Tour-to-dating integration

Setting `casualDatingInterest: true` on `POST /itinerary/request` opts the trip into casual-dating
recommendations. This is gated behind **full KYC verification** (phone + profile image + documents):

- Unverified users get `403` with an `action: "COMPLETE_VERIFICATION"` payload prompting them to verify.
- The dating module (`/dating/recommendations`, dating-profile selection) is gated by the same KYC check.

`GET /dating/recommendations?tourRequestId=<uuid>` filters ranked candidates by the trip's **geofence**
(centroid + spread of the selected tour sites) and **schedule overlap** (availability window vs. the trip
window). Candidates expose `scheduleOverlapDays` and `withinGeofence`, and those with non-overlapping
availability windows are filtered out.

Selected profiles are saved via `POST /itinerary/:tourRequestId/dating-selections` and merged into the
generated itinerary as `socialBlocks` on each touring day, plus a flat `datingSelections` list.

### Visa-on-Arrival

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/visa-requests` | Bearer | Create visa request |
| GET | `/visa-requests` | Bearer | Get user's visa requests |
| GET | `/visa-requests/:requestId/status` | Bearer | Get visa status |
| POST | `/visa-requests/:requestId/payment` | Bearer | Initiate visa payment |
| POST | `/visa-requests/payment-callback` | Hubtel | Hubtel payment callback |
| GET | `/visa-requests/pricing/:visaType` | Public | Get visa pricing breakdown |

### Payments

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/payment/status` | Public | Check whether payments are currently enabled (frontend uses this to skip payment screens when disabled) |
| POST | `/payment/initialize` | Bearer | Initialize a payment |
| GET | `/payment/verify/:reference` | Bearer | Verify payment status |
| GET | `/payment/transaction-status/:posSalesId` | Bearer | Check transaction status |
| GET | `/payment/processing` | Public | Payment processing page |
| GET | `/payment/p.js` | Public | Payment redirect script |

### Messaging & Chat

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/messages` | Bearer | Send a text or media message (`receiverId`, `content`, `type`, `mediaUrl`, `mediaDuration`) |
| POST | `/messages/voice-note` | Bearer | Upload and send a voice note (multipart: `audio` file, `receiverId`, `mediaDuration`). Max 15MB. |
| GET | `/messages/matches` | Bearer | Get active user matches ("New Matches" carousel) |
| GET | `/messages/conversations` | Bearer | List conversations with unread counts, partner profiles, and `lastActiveAt` |
| GET | `/messages/conversations/:conversationId` | Bearer | Get messages in a conversation (marks unread as read) |
| PATCH | `/messages/:messageId/read` | Bearer | Mark a specific message as read |

### Safety (Block & Report)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/messages/block` | Bearer | Block a user — prevents messages and calls both ways |
| DELETE | `/messages/block/:blockedId` | Bearer | Unblock a user |
| POST | `/messages/report` | Bearer | Report a user (`targetId`, `reason`, `details`) |

### Devices

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/devices/register` | Bearer | Register or update a device for push notifications (upsert on `userId` + `deviceId`; stores Expo/FCM/APNs/VoIP tokens, updates `lastSeenAt` every launch) |
| DELETE | `/devices/:deviceId` | Bearer | Unregister a device (also disabled server-side on logout) |
| GET | `/devices/notifications/preferences` | Bearer | Get notification preferences (e.g. `messagesEnabled`) |
| PATCH | `/devices/notifications/preferences` | Bearer | Update notification preferences (`{ "messagesEnabled": boolean }`) |

#### Message push notifications

`POST /messages` and `POST /messages/voice-note` persist the message
**and** write a durable `MessagePushDelivery` outbox record for the recipient in
the **same database transaction**. The API returns the created message
immediately (with a non-blocking `notification: { status: "QUEUED" }` field) and
a worker delivers the push in the background:

- Every **enabled** device belonging to the recipient is targeted; the sender's
  devices are never targeted.
- Each delivery carries a canonical `NEW_MESSAGE` data payload with
  `messageId`, `conversationId`, `senderId`, `senderName`, `senderAvatarUrl`,
  `messageType`, `route`, and `schemaVersion` so tapping the notification opens
  the exact chat.
- The visible body is built server-side per type: `TEXT` (sanitized/truncated
  ~120 chars), `Sent a voice message`, `Sent a photo`, `Sent a video`, or
  `New message`.
- Android uses a dedicated `messages` notification channel (default sound, not
  the call ringtone).
- Deliveries retry transient provider failures with bounded exponential backoff
  (max 5 attempts), fetch Expo receipts to confirm delivery, and automatically
  disable + clear tokens the provider rejects (`DeviceNotRegistered`).
- Recipients can opt out globally via `PATCH /devices/notifications/preferences`.

### Dating

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/dating/profile` | Bearer | Get your dating profile + discovery preferences |
| POST | `/dating/profile/init` | Bearer | Initialize your dating profile (accepts the full creation payload) |
| PATCH | `/dating/profile` | Bearer | Update profile settings (basic info, education & career, cultural background, interests, goals, photos) + account fields |
| GET | `/dating/profile/status` | Bearer | Profile existence + completion status (skip onboarding for returning users) |
| GET | `/dating/profile/:userId` | Bearer | View another user's public dating profile (blocked users excluded) |
| GET | `/dating/preferences` | Bearer | Get your discovery preferences |
| PUT | `/dating/preferences` | Bearer | Set discovery preferences (age/gender/distance filters, visibility) |
| GET | `/dating/recommendations` | Bearer | Ranked discovery candidates with `relationshipStatus` and `canSendInterest` (KYC-gated; `?tourRequestId=` restricts to a tour's geofence + schedule window) |
| POST | `/dating/swipe` | Bearer | Swipe LIKE / SUPER_LIKE / PASS. Mutual LIKE creates a match + conversation. |
| GET | `/dating/matches` | Bearer | List your active matches |
| GET | `/dating/likes-received` | Bearer | List users who liked you |
| GET | `/dating/likes-sent` | Bearer | List outgoing interests you sent (cursor-paginated, newest first) |
| GET | `/dating/relationship-status/:userId` | Bearer | Get relationship status with a specific user |
| DELETE | `/dating/matches/:matchId` | Bearer | Unmatch a user |

#### Recommendations with relationship state

Each recommendation includes `relationshipStatus` and `canSendInterest`:

```json
{
  "userId": "user_id",
  "profile": {},
  "relationshipStatus": "INTEREST_SENT",
  "canSendInterest": false
}
```

Stable relationship states: `NONE`, `INTEREST_SENT`, `INTEREST_RECEIVED`, `MATCHED`, `PASSED`, `BLOCKED`.

- `canSendInterest` is `true` only for `NONE` and `INTEREST_RECEIVED`
- Blocked users are excluded from recommendations
- Matched profiles are never presented as available to Like

#### Outgoing interests (likes sent)

`GET /dating/likes-sent` returns a cursor-paginated list of outgoing interests with target user profiles:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "interest_id",
        "targetUserId": "user_id",
        "direction": "LIKE",
        "status": "PENDING",
        "createdAt": "2026-08-18T12:00:00.000Z",
        "targetUser": {
          "id": "user_id",
          "profile": { "fullName": "Example User", "photos": ["..."] }
        }
      }
    ],
    "nextCursor": null
  }
}
```

Status enum: `PENDING`, `MATCHED`. A mutual Like transitions from `PENDING` to `MATCHED` atomically.

#### Single-profile relationship status

`GET /dating/relationship-status/:userId` returns the relationship with a specific user, including `interestId` and `sentAt` when an outgoing interest exists.

Dating real-time events via Socket.IO: `match:mutual` (both users on mutual like), `match:incoming` (target received a like), plus existing `presence:status` / `presence:info`.

Swipe endpoints are rate-limited (200 swipes / 15 min per IP) to prevent abuse.
Dating discovery and profile selection are gated behind full KYC verification (see
[Tour-to-dating integration](#itinerary-generation)).

> **Opposite-gender discovery (legal compliance):** dating recommendations are
> **always** filtered to the opposite of the viewer's own gender — MALE viewers
> see only FEMALE profiles and FEMALE viewers see only MALE profiles. This is
> enforced in the matching engine and overrides any `genderPreference` a user
> has saved. `OTHER`-gender viewers are shown an empty discovery queue.

### Calls

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/calls` | Bearer | Initiate a voice/video call (rate-limited: 5/recipient/10min, 20/caller/hour) |
| GET | `/calls/history` | Bearer | Get call history (cursor-paginated, last 50) |
| GET | `/calls/:callId` | Bearer | Get current call state |
| POST | `/calls/:callId/answer` | Bearer | Answer an incoming call (returns LiveKit token) — receiver only |
| POST | `/calls/:callId/decline` | Bearer | Decline an incoming call — receiver only |
| POST | `/calls/:callId/cancel` | Bearer | Cancel an outgoing call — caller only |
| POST | `/calls/:callId/end` | Bearer | End an active call — either participant |
| POST | `/calls/:callId/token` | Bearer | Generate a short-lived LiveKit token (120s TTL) |
| POST | `/calls/token` | Bearer | **[DEPRECATED]** Legacy token generation |

**Call state machine:**
```
INITIATING → RINGING → ANSWERED → ENDED
                      ↘ DECLINED
                      ↘ CANCELLED
                      ↘ MISSED (auto-expired, cron)
                      ↘ FAILED
```
`RINGING` and `ANSWERED` may also transition to `FAILED`. All transitions are enforced server-side with a compare-and-set update; terminal states are final.

**Behavior:**
- Atomic creation: `POST /calls` locks both user rows, rejects duplicate active calls for either user, and commits a single `RINGING` call (`CallAuditLog` transition records answer/decline/cancel/end/expire)
- Atomic transitions via `SELECT FOR UPDATE` row locking + audit trail (`CallAuditLog`)
- Busy check: prevents calls if either party is already in an active call (checked inside the creation transaction, so Answer cannot race Cancel/Decline/timeout)
- Ringing timeout: unanswered calls auto-expire after `expiresAt` (durable cron every 10s, `SELECT ... FOR UPDATE`)
- Rate limiting: 5 calls per recipient per 10min, 20 per caller per hour
- Idempotency: `idempotencyKey` in request body prevents duplicate call creation (5min TTL)
- **Push delivery:** `POST /calls` enqueues a durable outbox row per enabled receiver device and responds immediately. A worker (every 10s) delivers them — FCM high-priority data-only message on Android, Expo Push elsewhere — fetches Expo receipts, stores accepted/rejected status, retries transient failures with bounded exponential backoff, and disables + removes tokens the provider rejects (`DeviceNotRegistered`). No incoming-call push is ever sent to the caller's devices.
- **State-change pushes:** `DECLINED`, `CANCELLED`, `MISSED`, `ENDED`, and `FAILED` push a `CALL_STATE_CHANGED` notification to both participants so obsolete incoming-call screens are dismissed
- LiveKit: short-lived tokens (120s) for media server access, generated backend-only for the same room
- Blocking: blocked users cannot initiate calls to each other

### Membership Plans & Tiers

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/membership/plans` | Public | List all active membership plans with pricing, intervals, and features |
| POST | `/membership/subscribe` | Bearer | Subscribe to a plan (free activates immediately, paid returns checkout URL) |
| GET | `/membership/my-subscription` | Bearer | Get current user's subscription with plan details and status |
| POST | `/membership/support` | Bearer | Create a priority support ticket (paid tiers only) |
| POST | `/membership/payment-callback` | Hubtel | Hubtel payment callback for subscription payments (idempotent) |
| GET | `/membership/payment/return` | Public | HTTPS redirect bridge for mobile deep links (return) |
| GET | `/membership/payment/cancel` | Public | HTTPS redirect bridge for mobile deep links (cancel) |

#### Subscribe response

Free plans activate immediately:

```json
{
  "success": true,
  "data": {
    "subscriptionId": "subscription_id",
    "status": "ACTIVE",
    "checkoutUrl": null
  },
  "message": "Free membership activated successfully."
}
```

Paid plans return a validated HTTPS checkout URL:

```json
{
  "success": true,
  "data": {
    "subscriptionId": "subscription_id",
    "paymentReference": "provider_reference",
    "status": "PAYMENT_PENDING",
    "checkoutUrl": "https://checkout.hubtel.com/session/cs_123456",
    "expiresAt": "2026-08-18T13:00:00.000Z"
  },
  "message": "Membership checkout initialized successfully."
}
```

The `checkoutUrl` is validated before returning: must be absolute, HTTPS in production, valid hostname, no backticks/quotes/spaces. Mobile deep links are bridged through HTTPS redirect endpoints (`/membership/payment/return?appUrl=...`).

#### Subscription status lifecycle

```
PAYMENT_PENDING → ACTIVE       (verified payment callback)
PAYMENT_PENDING → PAYMENT_FAILED
PAYMENT_PENDING → CANCELLED
ACTIVE → EXPIRED
```

#### Stable error codes

| HTTP | Code | Meaning |
|------|------|---------|
| 400 | `INVALID_PLAN_ID` | Plan does not exist or is inactive |
| 400 | `INVALID_RETURN_URL` | Supplied return/cancellation URL is unsupported |
| 409 | `SUBSCRIPTION_ALREADY_ACTIVE` | User already has the requested active plan |
| 422 | `CHECKOUT_INITIALIZATION_FAILED` | Provider could not create checkout |
| 502 | `PAYMENT_PROVIDER_ERROR` | Provider returned an invalid or failed response |

Paid subscriptions initialize a Hubtel checkout and are activated on payment callback
(idempotent — already-processed callbacks are skipped). Generated Hubtel client
references are capped at 36 characters to satisfy Hubtel's validation.

### Image Upload

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/upload` | Bearer | Upload image to Cloudinary |

### Providers

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/providers/nearby-hotels` | Bearer | Find nearby hotels for itinerary |

### Data Policy

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/data-policy` | Public | Get the current published data policy |
| GET | `/data-policy/admin/policy` | Admin | Get the full data policy record for editing |
| PUT | `/data-policy/admin/policy` | Admin | Update the data policy content (auto-increments version) |

### FAQ

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/faq` | Public | Get all published FAQ items |
| GET | `/faq/admin` | Admin | Get all FAQ items including unpublished |
| POST | `/faq/admin` | Admin | Create a new FAQ item |
| PUT | `/faq/admin/:id` | Admin | Update an FAQ item |
| DELETE | `/faq/admin/:id` | Admin | Delete an FAQ item |

### Admin — Dashboard

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/admin/dashboard/summary` | Admin | KPI summary: tours (bulk/custom), pending visa queue, successful payments + MoM %, alerts (pending reports / verifications / failed payments) |

### Admin — User Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/admin/users` | Admin | List all users (paginated) |
| PATCH | `/admin/users/:userId/promote` | Admin | Promote to admin |
| PATCH | `/admin/users/:userId/demote` | Admin | Demote to user |
| PATCH | `/admin/users/:userId/suspend` | Admin | Suspend user |
| PATCH | `/admin/users/:userId/reactivate` | Admin | Reactivate user |
| DELETE | `/admin/users/:userId` | Admin | Delete user |

### Admin — Visa Console

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/admin/visa-requests` | Admin | Visa queue (paginated; filters: `status`, `q` passport/purpose/name/email, `from`/`to`) |
| GET | `/admin/visa-requests/stats` | Admin | Visa KPIs (total, pending review, rejected, approved today, rejection rate) |
| GET | `/admin/visa-requests/:id` | Admin | Visa detail with user, documents, payment, approval + activity log |
| POST | `/admin/visa-requests/:id/approve` | Admin | Approve visa (idempotent; optional `note`) — writes approval + activity log |
| POST | `/admin/visa-requests/:id/reject` | Admin | Reject visa (idempotent; optional `note`) |
| GET | `/admin/visa-requests/paid` | Admin | List paid visa requests (legacy) |
| POST | `/admin/visa-requests/approve` | Admin | Approve visa request (legacy, body `{ requestId }`) |

### Admin — Payments

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/admin/payments` | Admin | Transaction list (paginated; filters: `status`, `targetType`, `q` reference/user, `from`/`to`) |
| GET | `/admin/payments/stats` | Admin | Payment KPIs (total revenue, success/pending/failed counts + amounts, success rate) |
| GET | `/admin/payments/status` | Admin | Current payment control state (`enabled`, `reason`, `updatedAt`, `updatedBy`) |
| PATCH | `/admin/payments/status` | Admin | Enable/disable the payment system (`{ enabled: boolean, reason?: string }`) — writes an audit log entry |

Payment availability is a **database-persisted runtime toggle** (see
`docs/payment-control-system.md`): admins flip it via `PATCH /admin/payments/status`
without redeploying, it takes effect within ~10s, and new checkouts/MOMO/subscription
initializations are blocked with `503` while disabled. Callbacks and status
verification for already-initiated payments keep working. The frontend can poll
the public `GET /payment/status` to skip payment screens when the toggle is off.

### Admin — Profile Verification

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/admin/profile-verifications` | Admin | List verification requests |
| PATCH | `/admin/profile-verifications/:id/bio-data` | Admin | Approve/reject bio data |
| PATCH | `/admin/profile-verifications/:id/face` | Admin | Approve/reject face verification |
| PATCH | `/admin/profile-verifications/:id/documents` | Admin | Approve/reject documents |
| POST | `/admin/profile-verifications/:id/verify` | Admin | Fully verify user |

Admin decisions drive the user-facing status endpoint: approving face or documents
also flips the corresponding `bio_profile_verification`/`document_verification`
flag (making the step report `VERIFIED`), rejecting a step clears `isVerified` and
surfaces `REJECTED` with the supplied reason in `verification_message`.
`POST .../verify` marks every step approved and sets `isVerified` to `true`.

### Admin — Moderation

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/admin/reports` | Admin | List user reports (filter by `?status=PENDING\|REVIEWING\|RESOLVED\|DISMISSED`) |
| PATCH | `/admin/reports/:reportId` | Admin | Update report status (`REVIEWING` / `RESOLVED` / `DISMISSED`) with optional note |
| POST | `/admin/reports/:reportId/suspend` | Admin | Suspend the reported user and resolve the report |

### System

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | Public | Health check (uptime, timestamp) |
| GET | `/api-docs` | Public | Swagger UI |

The root path `/` returns API information (name, version, health and docs links).
Any unmatched endpoint returns a 404 via the catch-all middleware in `server.ts`.

---

## Database Schema (Summary)

| Model | Purpose |
|-------|---------|
| `User` | Core user account (auth, status, type) |
| `UserProfile` | Profile URL, phone, bio images, documents |
| `UserVerification` | Verification level tracking |
| `ProfileVerification` | Step-by-step verification with admin approval |
| `otp` | Hashed OTP codes for email/phone verification |
| `DeviceToken` | Refresh tokens + device info |
| `UserSubscription` | Subscription status |
| `BillingHistory` | Subscription payment records |
| `tour_packages` | Tour catalog |
| `tour_itineraries` | Default tour itineraries |
| `itinerary_activities` | Activities per itinerary day |
| `tour_locations` | Tour locations |
| `tour_media` | Tour images/videos |
| `tour_bookings` | User tour bookings |
| `user_tour_itineraries` | User-customized itineraries |
| `TourRequest` | Custom itinerary requests (`casualDatingInterest` opts into dating recommendations) |
| `TourRequestSite` | Selected sites per request |
| `TourRequestDatingSelection` | Dating profiles merged into a tour's itinerary |
| `Itinerary` / `ItineraryDay` / `ItineraryDaySite` | Generated itineraries |
| `TourSite` | Ghana tourism sites (seeded: 25 sites) |
| `MembershipPlan` | Membership tier definitions (seeded: 9 plans from Free to Elite Ambassador) |
| `PrioritySupportRequest` | Priority support tickets from paid-tier members |
| `VisaOnArrivalRequest` | Visa-on-arrival applications |
| `VisaOnArrivalData` | Visa applicant data |
| `VisaApproval` | Admin visa approval |
| `AdminActivityLog` | Admin console audit trail (who did what, on what entity) |
| `Payment` | Polymorphic payment records (tour, visa, itinerary) |
| `HubtelDirectReceiveLog` | Hubtel API response logs |
| `LedgerAccount` / `LedgerTransaction` | Double-entry ledger |
| `Message` / `Conversation` | Direct messaging (text, voice notes, images, videos, call logs) |
| `DatingProfile` | 1:1 dating profile (headline, bio, photos, height, interests, looking-for, location, education/career, cultural background) |
| `UserSwipe` | Dating swipes (LIKE / SUPER_LIKE / PASS) |
| `DiscoveryPreference` | Dating discovery filters + profile/online visibility |
| `UserMatch` | User matching/swiping |
| `UserBlock` | User blocking (prevents messaging and calls) |
| `UserReport` | User safety reports |
| `Call` | Voice/video call records with state machine (INITIATING → RINGING → ANSWERED → ENDED / DECLINED / CANCELLED / MISSED / FAILED) |
| `CallAuditLog` | Audit trail for all call state transitions |
| `CallPushDelivery` | Durable push outbox + delivery records: per (call, device, provider) status (PENDING → SENT → DELIVERED/FAILED), provider message/ticket ID, error code, attempt count, receipt timestamp |
| `MessagePushDelivery` | Durable push outbox + delivery records for chat messages: per (message, device) status (PENDING → SENT → DELIVERED/FAILED), provider message/ticket ID, error code, attempt count, receipt timestamp |
| `UserNotificationPreference` | Per-user global notification preferences (e.g. `messagesEnabled`) |
| `UserDevice` | Device push notification tokens (FCM, Expo, APNs, VoIP), upserted per installation with `lastSeenAt`, `enabled` |
| `Provider` / `TourGuide` / `CarRental` / `Hotel` | Service providers |
| `ServiceRequest` / `AuditLog` | Provider service tracking |
| `DataPolicy` | CMS-managed data policy document (keyed, versioned) |
| `FaqItem` | FAQ entries with optional category and sort order |
| `SystemSetting` | Key-value feature flags (`system_settings` table) — currently stores the `PAYMENTS_ENABLED` payment toggle |

See `prisma/schema.prisma` for the full schema with all fields and relations.

---

## Cron Jobs

| Job | Schedule | Description |
|-----|----------|-------------|
| Pending payments check | Every 5 minutes | Verifies stale PENDING payments with Hubtel API, updates status, processes ledger entries |
| Unverified user cleanup | Hourly | Deletes `PENDING_VERIFICATION` users older than 24 hours |
| Call expiry | Every 10 seconds | Expires RINGING calls past `expiresAt`, emits `call.missed`, pushes `CALL_STATE_CHANGED` to both participants |
| Push delivery | Every 10 seconds | Sends PENDING `CallPushDelivery` and `MessagePushDelivery` outbox rows (bounded exponential backoff), fetches Expo push receipts, invalidates rejected/stale tokens |

---

## Development

```bash
npm run dev            # Start dev server with hot reload
npm run lint           # Check for lint errors
npm run lint:fix       # Auto-fix lint errors
npm run format         # Format code with Prettier
npm run format:check   # Check formatting without writing
npm run db:studio      # Open Prisma Studio GUI
npm test               # Run unit tests once (Vitest)
npm run test:watch     # Run tests in watch mode
```

---

## API Documentation

Swagger UI available at `/api-docs` when the server is running. 140+ documented
operations across 26 route files (source of truth: JSDoc annotations in
`src/routes/*.ts` — update the annotation, not the spec).

---

## Security Features

- Rate limiting on auth routes (20 req/15 min), payment routes (50 req/15 min), and call routes (5/recipient/10min, 20/caller/hour)
- OTP codes hashed with bcrypt before storage
- Password minimum 8 characters with complexity requirements
- Hubtel callback verification middleware (validates transaction with Hubtel API)
- Admin routes protected with `requireAdmin` middleware (chained after `protectedRoute`)
- CORS restricted to `ALLOWED_ORIGINS` (no wildcard fallback)
- OAuth tokens delivered via HTTP-only cookies (web) or app deep links (mobile)
- File uploads require authentication
- Audio uploads restricted to specific MIME types, 15MB max size
- `passwordHash` never returned in API responses
- Hubtel config validated at boot time (fails fast if env vars missing)
- Payment flows wrapped in Prisma transactions (atomic write + API call)
- Visa pricing driven by env vars (not hardcoded)
- User blocking prevents messaging and calling both directions
- Blocked users filtered from conversation lists
- Socket.IO authenticated via JWT handshake

---

## Deployment

The app is containerized with a multi-stage Docker build (Node 20 Alpine). The build
stage runs `prisma generate && tsc` and compiles the Prisma client into
`dist/generated`; the runner stage keeps only production dependencies and `dist`.
The build does not require `DATABASE_URL` (see [Getting Started](#getting-started)).

```bash
docker build -t dagh-server .
docker run -p 5000:5000 dagh-server
```

Deployed on Render via `render.yaml` (native Node). Build command:
`npm ci && npm run build`; a `preDeployCommand` (`npx prisma migrate deploy`) applies
pending database migrations before each deploy. Current live instance: <https://dagh-server-fo64.onrender.com>
(`/health` for a status check, `/api-docs` for Swagger).

---

## License

Proprietary — Diaspora Affairs Ghana
