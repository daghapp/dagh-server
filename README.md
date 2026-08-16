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
├── helpers/                    # OTP, JWT, client refs, ledger, payment, haversine, response, safety
├── jobs/                       # Cron jobs (pending payments, user cleanup)
├── middleware/                  # Auth, admin, validation, Cloudinary upload, audio upload, Hubtel callback
├── modules/
│   ├── admin/                  # Admin console (dashboard, visa console, payments console)
│   ├── authentication/         # Register, login, OAuth, password reset
│   ├── common/                 # Image upload
│   ├── dating/                 # Dating profiles, discovery, swiping, matches
│   ├── itinerary/              # Itinerary generation + payment
│   ├── messages/               # Messaging, voice notes, calls, block/report (REST + Socket.IO)
│   ├── payment-management/     # Payment processing
│   ├── profile-management/     # Profile CRUD, verification, ethnicity
│   ├── membership/             # Membership plans, subscriptions, priority support
│   ├── provider-management/    # Nearby hotels
│   ├── tour-management/        # Tour CRUD, booking, admin
│   └── visa-management/        # Visa-on-arrival requests + approval
├── routes/                     # Express route definitions (21 files)
├── services/                   # Business logic (membership, payment, matching)
├── sockets/                    # Socket.IO handlers (auth, presence, call signaling)
├── types/                      # TypeScript type augmentations (Express.User)
├── validator/                  # Zod schemas (18 files)
└── views/                      # HTML/CSS for OAuth/payment callback pages
```

---

## API Endpoints

> **Detailed developer reference:** see `docs/api-reference.md` for every
> endpoint with payloads and examples, `docs/admin-console-api.md` for the admin
> console surface + frontend wiring patterns, `docs/admin-gateway-registration.md`
> for the Admin Gateway registration flow, and `docs/verification-flow.md` for
> the identity-verification integration guide.

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
| POST | `/verification/phone/send-otp` | Bearer | Send phone verification OTP |
| POST | `/verification/phone/verify-otp` | Bearer | Verify phone OTP |
| POST | `/verification/bio_profile_url` | Bearer | Submit bio profile URL |
| POST | `/verification/bio_document_urls` | Bearer | Submit bio documents |
| GET | `/verification/status` | Bearer | Full verification status (per-step status, current step, completed steps) |
| GET | `/verification/validation-step/status` | Bearer | Get current verification step |

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
| POST | `/itinerary/request` | Bearer | Submit tour request with site selections |
| GET | `/itinerary/requests` | Bearer | Get user's tour requests |
| GET | `/itinerary/my-itineraries` | Bearer | Get user's generated itineraries |
| GET | `/itinerary/:tourRequestId` | Bearer | Get generated itinerary by request ID |
| POST | `/itinerary/:tourRequestId/payment` | Bearer | Initiate itinerary payment |
| POST | `/itinerary/payment-callback` | Hubtel | Hubtel payment callback |

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
| GET | `/dating/recommendations` | Bearer | Ranked discovery candidates (excludes passed/blocked/hidden; likes stay in the queue) |
| POST | `/dating/swipe` | Bearer | Swipe LIKE / SUPER_LIKE / PASS. Mutual LIKE creates a match + conversation. |
| GET | `/dating/matches` | Bearer | List your active matches |
| GET | `/dating/likes-received` | Bearer | List users who liked you |
| DELETE | `/dating/matches/:matchId` | Bearer | Unmatch a user |

Dating real-time events via Socket.IO: `match:mutual` (both users on mutual like), `match:incoming` (target received a like), plus existing `presence:status` / `presence:info`.

Swipe endpoints are rate-limited (200 swipes / 15 min per IP) to prevent abuse.

### Calls

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/calls/history` | Bearer | Get incoming/outgoing call history (last 50) |
| POST | `/calls/token` | Bearer | Generate a LiveKit AccessToken + `serviceUrl` for a call (`roomId`, `callType: VOICE|VIDEO`). Valid 1 hour. |

Real-time events via Socket.IO: `new_message`, `message_sent`, `message_read`, `user_typing`, `call:initiate`, `call:accept`, `call:decline`, `call:end`, `call:signal`, `call:busy`, `call:timeout`, `call:switch_video_request`, `call:switch_video_respond`, `presence:status`.

**Call behavior:**
- Media: `POST /calls/token` issues a room-scoped **LiveKit AccessToken** (`LIVEKIT_URL` is returned as `serviceUrl`, used by the client to connect to the media server). Without LiveKit env vars it falls back to a placeholder HMAC token for dev only.
- Busy check: prevents calls if either party is already in an active call (`call:busy`)
- Ringing timeout: unanswered calls auto-expire after 30 seconds (`call:timeout`)
- Mid-call video upgrade: voice calls can be switched to video via `call:switch_video_request` / `call:switch_video_respond`

### Membership Plans & Tiers

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/membership/plans` | Public | List all active membership plans with pricing, intervals, and features |
| POST | `/membership/subscribe` | Bearer | Subscribe to a plan (free activates immediately, paid initializes Hubtel checkout) |
| GET | `/membership/my-subscription` | Bearer | Get current user's subscription with plan details and member code |
| POST | `/membership/support` | Bearer | Create a priority support ticket (paid tiers only) |
| POST | `/membership/payment-callback` | Hubtel | Hubtel payment callback for subscription payments |

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
| `TourRequest` | Custom itinerary requests |
| `TourRequestSite` | Selected sites per request |
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
| `CallLog` | Voice/video call history with duration and status |
| `Provider` / `TourGuide` / `CarRental` / `Hotel` | Service providers |
| `ServiceRequest` / `AuditLog` | Provider service tracking |

See `prisma/schema.prisma` for the full schema with all fields and relations.

---

## Cron Jobs

| Job | Schedule | Description |
|-----|----------|-------------|
| Pending payments check | Every 5 minutes | Verifies stale PENDING payments with Hubtel API, updates status, processes ledger entries |
| Unverified user cleanup | Hourly | Deletes `PENDING_VERIFICATION` users older than 24 hours |

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

Swagger UI available at `/api-docs` when the server is running. 117 documented
operations across 21 route files (source of truth: JSDoc annotations in
`src/routes/*.ts` — update the annotation, not the spec).

---

## Security Features

- Rate limiting on auth routes (20 req/15 min) and payment routes (50 req/15 min)
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
