# Diaspora Affairs Ghana (DAGH) — Backend API

REST API for the DAGH platform: tour management, visa-on-arrival processing, itinerary generation, messaging, and payments via Hubtel.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 |
| Framework | Express 5 + Helmet |
| Language | TypeScript (strict) |
| Database | PostgreSQL + Prisma ORM |
| Payments | Hubtel (Mobile Money, Cards) |
| File Storage | Cloudinary |
| Real-time | Socket.IO |
| Auth | JWT (access + refresh tokens), Passport (Google, Facebook) |
| Validation | Zod |
| API Docs | Swagger (swagger-jsdoc + swagger-ui-express) |

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

# Build
npm run build

# Start
npm start              # production
npm run dev            # development (if configured)
```

---

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/dagh

# Auth
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=

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
├── config/           # Prisma, Passport, Hubtel, session, Swagger, pricing
├── helpers/          # OTP, JWT, client refs, ledger, payment utils
├── jobs/             # Cron jobs (pending payments, user cleanup)
├── middleware/        # Auth, admin, validation, Cloudinary upload, Hubtel callback
├── modules/
│   ├── authentication/    # Register, login, OAuth, password reset
│   ├── common/            # Image upload
│   ├── itinerary/         # Itinerary generation + payment
│   ├── messages/          # Direct messaging (REST + Socket.IO)
│   ├── payment-management/ # Payment init, verification, subscriptions
│   ├── profile-management/ # Profile CRUD, verification, ethnicity
│   ├── provider-management/# Nearby hotels
│   ├── tour-management/    # Tour CRUD, booking, admin
│   └── visa-management/    # Visa-on-arrival requests + approval
├── routes/           # Express route definitions
├── services/         # Business logic (payment)
├── sockets/          # Socket.IO handlers
├── validator/        # Zod schemas
└── server.ts         # App setup, middleware, route mounting
```

---

## Modules

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register with email/password |
| POST | `/auth/login` | Login (returns access + refresh tokens) |
| POST | `/auth/logout` | Logout (revokes all refresh tokens) |
| POST | `/auth/verify-otp` | Verify email OTP |
| POST | `/auth/resend-otp` | Resend verification OTP |
| POST | `/auth/refresh-token` | Get new access token |
| POST | `/auth/request-reset-password` | Request password reset OTP |
| POST | `/auth/reset-password` | Reset password with OTP |
| GET | `/auth/google` | Google OAuth redirect |
| GET | `/auth/google/callback` | Google OAuth callback |
| GET | `/auth/facebook` | Facebook OAuth redirect |
| GET | `/auth/facebook/callback` | Facebook OAuth callback |

### Profile Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/profile/init` | Initialize profile |
| POST | `/profile/bio-document` | Upload bio document |
| PATCH | `/profile/ethnicity` | Set ethnicity |
| GET | `/profile/validation-step` | Get verification step status |

### Profile Verification

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/verification/send-phone-otp` | Send phone verification OTP |
| POST | `/verification/verify-phone` | Verify phone OTP |
| POST | `/verification/bio-profile-url` | Submit bio profile URL |
| POST | `/verification/bio-document` | Submit bio document |

### Tour Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tours` | List tours (filterable, paginated) |
| GET | `/tours/:tourId` | Get tour details |
| POST | `/tours` | Create tour (admin) |
| PUT | `/tours/:tourId` | Update tour (admin) |
| DELETE | `/tours/:tourId` | Delete tour (admin) |
| POST | `/tours/bookings` | Book a tour (Hubtel checkout) |
| POST | `/tours/momo-bookings` | Book a tour (Mobile Money) |
| POST | `/tours/hubtel-callback` | Hubtel payment callback |
| GET | `/tours/user/bookings` | Get user's bookings |
| PATCH | `/tours/user/bookings/:bookingId/cancel` | Cancel booking |
| PATCH | `/tours/user/itinerary/:itineraryId` | Update user itinerary |
| GET | `/tours/admin/all` | List all bookings (admin) |
| PATCH | `/tours/admin/bookings/:bookingId/status` | Update booking status (admin) |
| DELETE | `/tours/admin/:tourId` | Delete tour (admin) |

### Itinerary Generation

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/itinerary/request` | Submit tour request with site selections |
| GET | `/itinerary/:tourRequestId` | Get generated itinerary |
| GET | `/itinerary/user/requests` | Get user's tour requests |
| POST | `/itinerary/:tourRequestId/payment` | Initiate itinerary payment |
| POST | `/itinerary/payment-callback` | Hubtel payment callback |

### Visa-on-Arrival

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/visa-requests` | Create visa request |
| POST | `/visa-requests/:requestId/payment` | Initiate visa payment |
| POST | `/visa-requests/payment-callback` | Hubtel payment callback |
| GET | `/visa-requests` | Get user's visa requests |
| GET | `/visa-requests/status/:requestId` | Get visa status |
| GET | `/visa-requests/pricing/:visaType` | Get visa pricing breakdown |
| GET | `/visa-requests/admin/paid` | List paid visa requests (admin) |
| POST | `/visa-requests/admin/approve` | Approve visa request (admin) |

### Payments

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/payment/init` | Initialize a payment |
| POST | `/payment/init-momo` | Initialize Mobile Money payment |
| POST | `/payment/subscription` | Create subscription invoice |
| GET | `/payment/verify/:reference` | Verify payment status |
| GET | `/payment/status/:posSalesId` | Check transaction status |

### Messaging

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/messages` | Send a message |
| GET | `/messages/conversations` | List conversations |
| GET | `/messages/conversations/:conversationId` | Get messages in conversation |
| PATCH | `/messages/:messageId/read` | Mark message as read |

Real-time events via Socket.IO: `new_message`, `message_sent`, `message_read`, `user_typing`.

### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/users` | List all users (paginated) |
| PATCH | `/admin/users/:userId/promote` | Promote to admin |
| PATCH | `/admin/users/:userId/demote` | Demote to user |
| PATCH | `/admin/users/:userId/suspend` | Suspend user |
| PATCH | `/admin/users/:userId/reactivate` | Reactivate user |
| DELETE | `/admin/users/:userId` | Delete user |
| GET | `/admin/profile-verifications` | List verification requests |
| PATCH | `/admin/profile-verifications/:id/bio-data` | Approve/reject bio data |
| PATCH | `/admin/profile-verifications/:id/face` | Approve/reject face verification |
| PATCH | `/admin/profile-verifications/:id/documents` | Approve/reject documents |
| POST | `/admin/profile-verifications/:id/verify` | Fully verify user |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/docs` | Swagger UI |

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
| `Itinerary` / `ItineraryDay` / `ItineraryDaySite` | Generated itineraries |
| `TourSite` | Ghana tourism sites (seeded) |
| `VisaOnArrivalRequest` | Visa-on-arrival applications |
| `VisaOnArrivalData` | Visa applicant data |
| `VisaApproval` | Admin visa approval |
| `Payment` | Polymorphic payment records |
| `HubtelDirectReceiveLog` | Hubtel API response logs |
| `LedgerAccount` / `LedgerTransaction` | Double-entry ledger |
| `Message` / `Conversation` | Direct messaging |
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

## Security Features

- Rate limiting on auth routes (20 req/15 min) and payment routes (50 req/15 min)
- OTP codes hashed with bcrypt before storage
- Password minimum 8 characters with complexity requirements
- Hubtel callback verification middleware (validates transaction with Hubtel API)
- Admin routes protected with `requireAdmin` middleware
- CORS restricted to `ALLOWED_ORIGINS` (no wildcard fallback)
- OAuth tokens delivered via HTTP-only cookies (web) or app deep links (mobile)
- File uploads require authentication
- `passwordHash` never returned in API responses

---

## Deployment

The app is containerized with a multi-stage Docker build:

```bash
docker build -t dagh-server .
docker run -p 5000:5000 dagh-server
```

Deployed on Render via `render.yaml`. Build command: `npm ci && npm run build`.

---

## License

Proprietary — Diaspora Affairs Ghana
