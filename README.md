# Diaspora Affairs Ghana (DAGH) — Backend API

REST API for the DAGH platform: tour management, visa-on-arrival processing, itinerary generation, messaging, voice/video calling, and payments via Hubtel.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 |
| Framework | Express 5 + Helmet |
| Language | TypeScript 5.9 (strict) |
| Database | PostgreSQL + Prisma 7.4 ORM |
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

# Run migrations
npx prisma migrate dev

# Generate Prisma client
npx prisma generate

# Seed database (25 tour sites + ledger accounts)
npm run db:seed

# Build
npm run build

# Start
npm start              # production (port 5000)
npm run dev            # development (nodemon + tsx hot reload)
```

**Docker:**
```bash
docker build -t dagh-server .
docker run -p 5000:5000 dagh-server
```

---

## Environment Variables

See `.env.example` for the full list. Key categories:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/dagh

# Auth
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
SESSIONSECRET=

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
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
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

## Project Structure

```
src/
├── index.ts                    # Server start + graceful shutdown
├── server.ts                   # Express app setup, middleware, route mounting
├── seed.ts                     # Database seed (25 Ghana tour sites + ledger accounts)
├── config/                     # Prisma, Passport, Hubtel, session, Swagger, pricing, Cloudinary, Resend
├── helpers/                    # OTP, JWT, client refs, ledger, payment, haversine, response, safety
├── jobs/                       # Cron jobs (pending payments, user cleanup)
├── middleware/                  # Auth, admin, validation, Cloudinary upload, audio upload, Hubtel callback
├── modules/
│   ├── authentication/         # Register, login, OAuth, password reset
│   ├── common/                 # Image upload
│   ├── itinerary/              # Itinerary generation + payment
│   ├── messages/               # Messaging, voice notes, calls, block/report (REST + Socket.IO)
│   ├── payment-management/     # Payment processing
│   ├── profile-management/     # Profile CRUD, verification, ethnicity
│   ├── provider-management/    # Nearby hotels
│   ├── tour-management/        # Tour CRUD, booking, admin
│   └── visa-management/        # Visa-on-arrival requests + approval
├── routes/                     # Express route definitions (18 files)
├── services/                   # Business logic (payment.service.ts)
├── sockets/                    # Socket.IO handlers (auth, presence, call signaling)
├── types/                      # TypeScript type augmentations (Express.User)
├── validator/                  # Zod schemas (15 files)
└── views/                      # HTML/CSS for OAuth/payment callback pages
```

---

## API Endpoints

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
| PATCH | `/profile/ethnicity` | Bearer | Set ethnicity |

### Profile Verification

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/verification/init` | Bearer | Initialize verification |
| POST | `/verification/phone/send-otp` | Bearer | Send phone verification OTP |
| POST | `/verification/phone/verify-otp` | Bearer | Verify phone OTP |
| POST | `/verification/bio_profile_url` | Bearer | Submit bio profile URL |
| POST | `/verification/bio_document_urls` | Bearer | Submit bio documents |
| GET | `/verification/validation-step/status` | Bearer | Get current verification step |

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

### Calls

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/calls/history` | Bearer | Get incoming/outgoing call history (last 50) |
| POST | `/calls/token` | Bearer | Generate WebRTC RTC session token (`roomId`, `callType: VOICE|VIDEO`). Valid 1 hour. |

Real-time events via Socket.IO: `new_message`, `message_sent`, `message_read`, `user_typing`, `call:initiate`, `call:accept`, `call:decline`, `call:end`, `call:signal`, `presence:status`.

### Image Upload

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/upload` | Bearer | Upload image to Cloudinary |

### Providers

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/providers/nearby-hotels` | Bearer | Find nearby hotels for itinerary |

### Admin — User Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/admin/users` | Admin | List all users (paginated) |
| PATCH | `/admin/users/:userId/promote` | Admin | Promote to admin |
| PATCH | `/admin/users/:userId/demote` | Admin | Demote to user |
| PATCH | `/admin/users/:userId/suspend` | Admin | Suspend user |
| PATCH | `/admin/users/:userId/reactivate` | Admin | Reactivate user |
| DELETE | `/admin/users/:userId` | Admin | Delete user |

### Admin — Visa Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/admin/visa-requests/paid` | Admin | List paid visa requests |
| POST | `/admin/visa-requests/approve` | Admin | Approve visa request |

### Admin — Profile Verification

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/admin/profile-verifications` | Admin | List verification requests |
| PATCH | `/admin/profile-verifications/:id/bio-data` | Admin | Approve/reject bio data |
| PATCH | `/admin/profile-verifications/:id/face` | Admin | Approve/reject face verification |
| PATCH | `/admin/profile-verifications/:id/documents` | Admin | Approve/reject documents |
| POST | `/admin/profile-verifications/:id/verify` | Admin | Fully verify user |

### System

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | Public | Health check (uptime, timestamp) |
| GET | `/api-docs` | Public | Swagger UI |

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
| `VisaOnArrivalRequest` | Visa-on-arrival applications |
| `VisaOnArrivalData` | Visa applicant data |
| `VisaApproval` | Admin visa approval |
| `Payment` | Polymorphic payment records (tour, visa, itinerary) |
| `HubtelDirectReceiveLog` | Hubtel API response logs |
| `LedgerAccount` / `LedgerTransaction` | Double-entry ledger |
| `Message` / `Conversation` | Direct messaging (text, voice notes, images, videos, call logs) |
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
```

---

## API Documentation

Swagger UI available at `/api-docs` when the server is running. 87 fully documented endpoints across 18 route files.

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

The app is containerized with a multi-stage Docker build (Node 20 Alpine):

```bash
docker build -t dagh-server .
docker run -p 5000:5000 dagh-server
```

Deployed on Render via `render.yaml`. Build command: `npm ci && npm run build`.

---

## License

Proprietary — Diaspora Affairs Ghana
