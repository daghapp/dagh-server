# DAGH Server — Full Codebase Documentation

> **Version:** 1.0.0  
> **Stack:** Node.js + Express + Prisma (PostgreSQL) + Socket.IO + Redis + Cloudinary  
> **Base URL:** `/` (all API endpoints prefixed per module)  
> **Swagger Docs:** `/api-docs`

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Authentication & Authorization](#2-authentication--authorization)
3. [Module: Auth](#3-module-auth)
4. [Module: Profile Management](#4-module-profile-management)
5. [Module: Verification](#5-module-verification)
6. [Module: Dating](#6-module-dating)
7. [Module: Messaging & Calls](#7-module-messaging--calls)
8. [Module: Membership & Subscriptions](#8-module-membership--subscriptions)
9. [Module: Tours](#9-module-tours)
10. [Module: Itinerary Generation](#10-module-itinerary-generation)
11. [Module: Visa on Arrival](#11-module-visa-on-arrival)
12. [Module: Payments](#12-module-payments)
13. [Module: Image Upload](#13-module-image-upload)
14. [Module: Providers](#14-module-providers)
15. [Module: Admin Console](#15-module-admin-console)
16. [Real-Time Layer (Socket.IO)](#16-real-time-layer-socketio)
17. [Middleware Reference](#17-middleware-reference)
18. [Database Schema Reference](#18-database-schema-reference)
19. [Environment Variables](#19-environment-variables)
20. [Frontend Implementation Guide](#20-frontend-implementation-guide)
21. [Known Gotchas & Potential Problems](#21-known-gotchas--potential-problems)

---

## 1. Architecture Overview

```
Client (Web / Mobile)
    │
    ├── HTTP REST ──► Express Router ──► Middleware ──► Controller ──► Prisma ──► PostgreSQL
    │                                                              │
    │                                                              ├── Cloudinary (images)
    │                                                              └── Hubtel (payments)
    │
    └── WebSocket ──► Socket.IO ──► Redis Adapter ──► All Instances
                                │
                                ├── Presence (online/offline)
                                ├── Typing indicators
                                ├── Read receipts
                                ├── Match notifications
                                ├── Call signaling (WebRTC)
                                └── Incoming call banners
```

**Key patterns:**
- All responses use standardized helpers: `ok()`, `created()`, `fail()`, `paginated()` from `src/helpers/response.ts`
- Request bodies validated with Zod schemas via `validate()` middleware
- JWT access tokens (1 day) + refresh tokens (7 days, stored in `device_tokens` table)
- Rate limiting backed by Redis when available, in-memory fallback
- Admin routes require `protectedRoute` + `requireAdmin` middleware chain

**Response envelope:**
```json
// Success
{ "success": true, "data": <T>, "message": "optional" }

// Error
{ "success": false, "error": "error message", "details": "optional extra" }

// Paginated
{ "success": true, "data": [...], "pagination": { "total", "page", "limit", "totalPages" } }
```

---

## 2. Authentication & Authorization

### JWT Token Flow

```
Register/Login → { accessToken, refreshToken }
                        │               │
                        │               └── Stored in device_tokens table (7 days)
                        │               └── Used via POST /auth/refresh-token
                        │
                        └── Sent as Authorization: Bearer <token> on all protected routes
                        └── Expires after 1 day
```

### Auth Providers
- **Email/Password** — traditional register + login
- **Google OAuth** — `GET /auth/google` → callback
- **Facebook OAuth** — `GET /auth/facebook` → callback
- **Apple Sign-In** — `GET /auth/apple` → callback (POST)

### Middleware Chain
```
All protected routes:  protectedRoute (JWT verify) → [requireAdmin if admin-only]
All auth routes:       rateLimiter (20 req / 15 min per IP)
All payment routes:    rateLimiter (50 req / 15 min per IP)
All dating swipes:     rateLimiter (200 swipes / 15 min per IP)
```

---

## 3. Module: Auth

**Base path:** `/auth`  
**Rate limit:** 20 requests per 15 minutes per IP

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | No | Register with email + password |
| POST | `/auth/login` | No | Login with email + password |
| POST | `/auth/verify-otp` | No | Verify email OTP |
| POST | `/auth/resend-otp` | No | Resend OTP |
| POST | `/auth/logout` | Yes | Logout (invalidate refresh token) |
| POST | `/auth/refresh-token` | No | Get new access token |
| POST | `/auth/request-reset-password` | No | Request password reset OTP |
| POST | `/auth/reset-password` | Yes | Reset password with OTP |
| GET | `/auth/google` | No | Initiate Google OAuth |
| GET | `/auth/google/callback` | No | Google OAuth callback |
| GET | `/auth/facebook` | No | Initiate Facebook OAuth |
| GET | `/auth/facebook/callback` | No | Facebook OAuth callback |
| GET | `/auth/apple` | No | Initiate Apple Sign-In |
| POST | `/auth/apple/callback` | No | Apple Sign-In callback |

### Validation Schemas

**Registration (`registrationSchema`):**
```json
{
  "fullName": "string (min 2 chars)",
  "phoneNumber": "string (E.164 format, e.g. +233XXXXXXXXX)",
  "gender": "MALE | FEMALE | OTHER",
  "dateOfBirth": "ISO date string",
  "email": "valid email",
  "ethnicity": "string (optional)",
  "password": "min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char"
}
```

**Login (`loginSchema`):**
```json
{
  "email": "valid email",
  "password": "min 8 chars"
}
```

### Frontend Implementation
1. After registration, redirect to OTP verification screen
2. Store `accessToken` in secure storage (Keychain/KeyStore)
3. Store `refreshToken` for silent token refresh
4. Implement token refresh interceptor on HTTP client (401 → refresh → retry)
5. Social auth opens browser popup; listen for callback URL with tokens

### Potential Problems
- **OTP expiry:** OTPs expire — frontend should show countdown timer
- **Rate limiting:** 20 auth requests/15 min is aggressive; show clear "try again later" message on 429
- **Social auth redirect:** Must handle deep linking for mobile apps (not just web redirects)
- **Token refresh race condition:** Multiple concurrent 401s should queue token refresh, not fire N parallel refreshes

---

## 4. Module: Profile Management

**Base path:** `/profile`

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/profile/init` | Yes | Initialize user profile (idempotent) |
| PATCH | `/profile/` | Yes | Update profile settings |
| PATCH | `/profile/ethnicity` | Yes | Set user ethnicity |

### Logic
- Profile initialization creates a `UserProfile` record linked to the `User`
- Profile settings include `bio_profile_image_url`, `bio_document_urls`, etc.
- Ethnicity is stored on the `User` model directly

### Frontend Implementation
1. Call `POST /profile/init` on first login (idempotent — safe to call multiple times)
2. Use `PATCH /profile/` to update bio image, document uploads
3. Ethnicity is used for tour itinerary personalization

### Potential Problems
- **Profile init idempotency:** If profile already exists, returns 200 with existing profile — frontend should not show error
- **Image upload flow:** Must upload to Cloudinary first (`POST /upload`), then save URL via `PATCH /profile/`

---

## 5. Module: Verification

**Base path:** `/verification`

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/verification/phone/send-otp` | Yes | Send phone verification OTP |
| POST | `/verification/phone/verify-otp` | Yes | Verify phone OTP |
| GET | `/verification/status` | Yes | Get verification status |
| POST | `/verification/bio_profile_url` | Yes | Submit bio profile image URL |
| POST | `/verification/bio_document_urls` | Yes | Submit bio document URLs |
| POST | `/verification/init` | Yes | Initialize verification record |
| GET | `/verification/validation-step/status` | Yes | Get current validation step |

### Verification Levels (enum)
1. `PHONE_NUMBER_VERIFICATION`
2. `IP_ADDRESS_CHECK`
3. `BIO_PROFILE_IMAGE_CHECK`
4. `DOCUMENT_CHECK`

### Logic
- Verification is a multi-step process; each step must be completed sequentially
- `validationStep` field tracks the current step
- Admin approval required for bio data, face verification, and documents

### Frontend Implementation
1. After registration, check `GET /verification/validation-step/status` to determine current step
2. Show appropriate screen for each verification level
3. Phone OTP flow: request → enter 6-digit code → verify
4. Bio image: upload to Cloudinary → submit URL
5. Documents: upload passport/Ghana Card → submit URLs
6. Poll `GET /verification/status` to check if admin has approved

### Potential Problems
- **Step sequencing:** Frontend must respect `validationStep` — don't skip ahead
- **Admin approval delay:** Bio/document verification requires admin review; show "pending review" state
- **Document upload:** Must match `BioDocumentType` enum (PASSPORT or GHANA_CARD)

---

## 6. Module: Dating

**Base path:** `/dating`  
**All routes require authentication**

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/dating/profile` | Yes | Get own dating profile |
| POST | `/dating/profile/init` | Yes | Initialize dating profile (idempotent) |
| PATCH | `/dating/profile` | Yes | Update dating profile |
| DELETE | `/dating/profile/deactivate` | Yes | Deactivate (soft-delete) dating profile |
| GET | `/dating/profile/status` | Yes | Check profile existence + completeness |
| GET | `/dating/profile/:userId` | Yes | View another user's dating profile (block-aware) |
| GET | `/dating/preferences` | Yes | Get discovery preferences |
| PUT | `/dating/preferences` | Yes | Create/update discovery preferences |
| POST | `/dating/swipe` | Yes | Record swipe (LIKE/SUPER_LIKE/PASS) |
| GET | `/dating/recommendations` | Yes | Get ranked discovery candidates |
| GET | `/dating/matches` | Yes | Get all active matches |
| GET | `/dating/likes-received` | Yes | See who liked you (tier-gated) |
| DELETE | `/dating/matches/:matchId` | Yes | Unmatch a user |

### Profile Fields

**DatingProfile fields:**
```
headline (max 80), about (max 2000), photos (max 9 URLs), heightCm (120-250),
interests (max 20 strings), lookingFor (LONG_TERM_PARTNER | SHORT_TERM | FRIENDSHIP | NOT_SURE),
location, degree, university, profession, industry, workLocation,
languages (max 20 strings), religion, hometown
```

**Account-level fields (saved on User model):**
```
fullName, gender (MALE | FEMALE | OTHER), dateOfBirth (must be 18+), ethnicity
```

### Discovery Preferences
```json
{
  "lookingFor": "LONG_TERM_PARTNER | SHORT_TERM | FRIENDSHIP | NOT_SURE",
  "genderPreference": ["MALE", "FEMALE", "OTHER"],
  "minAge": 18-99,
  "maxAge": 18-99,
  "maxDistanceKm": 1-20000,
  "locationLat": -90 to 90,
  "locationLng": -180 to 180,
  "locationName": "string",
  "showProfile": true/false,
  "showOnlineStatus": true/false
}
```

### Matching Algorithm (`matching.service.ts`)
```
Score = (Interest overlap × 40) + (Age proximity × 30) + (Profile completeness × 20) + (Distance × 10)
        × Tier boost multiplier
```

**Tier boosts:** FREE=1.0, SILVER=1.25, GOLD=1.3, ELITE=1.4

### Super-Like Daily Limits
| Tier | Daily Limit |
|------|-------------|
| FREE | 1 |
| BASELINE | 2 |
| SILVER | 5 |
| GOLD | 10 |
| ELITE | 20 |

### Likes-Received (Tier-Gated)
- **FREE tier:** Returns `{ count: N, profiles: [] }` — count only, no profile details
- **Paid tier:** Returns `{ count: N, profiles: [...] }` — full profile list

### Swipe Flow
```
Swipe (LIKE) → Check mutual → If target already liked you → Create Match + Conversation
                                → Emit socket "match:mutual" to both users
                           → Else → Emit socket "match:incoming" to target
```

### Frontend Implementation
1. **Onboarding flow:** Collect data across screens → single `POST /dating/profile/init` call
2. **Profile status:** Call `GET /dating/profile/status` on app open to skip onboarding for returning users
3. **Discovery:** Poll `GET /dating/recommendations` with pagination (`?limit=20&offset=0`)
4. **Swiping:** `POST /dating/swipe` with `{ targetId, direction }`
5. **Match list:** `GET /dating/matches` — listen for real-time `match:mutual` socket events
6. **Likes received:** Show blurred/blurred preview for FREE users, full list for paid
7. **Super-like limit:** Check `error.details.code === "SUPER_LIKE_LIMIT_EXCEEDED"` and show upgrade modal with `resetAt` countdown

### Potential Problems
- **Profile deactivation:** After `DELETE /dating/profile/deactivate`, all GET/PATCH profile endpoints return 404 — redirect to onboarding
- **Super-like 429:** Frontend must handle `429` status specifically, not generic error
- **Likes-received response shape:** Always `{ count, profiles }` — don't assume array
- **Age validation:** Server enforces 18+ on DOB; test data with ages <18 will fail
- **Photo upload:** Photos are URLs — upload to Cloudinary first, then save URLs
- **Match creation:** Mutual LIKE creates a match AND a conversation automatically — frontend should listen for `match:mutual` socket event for instant UI update

---

## 7. Module: Messaging & Calls

### 7a. Messages

**Base path:** `/messages`  
**All routes require authentication**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/messages/` | Yes | Send a text/image/video message |
| POST | `/messages/voice-note` | Yes | Send a voice note |
| GET | `/messages/matches` | Yes | Get new matches (for chat list) |
| GET | `/messages/conversations` | Yes | Get all conversations |
| GET | `/messages/conversations/:conversationId` | Yes | Get messages in a conversation |
| PATCH | `/messages/:messageId/read` | Yes | Mark message as read |
| POST | `/messages/block` | Yes | Block a user |
| DELETE | `/messages/block/:blockedId` | Yes | Unblock a user |
| POST | `/messages/report` | Yes | Report a user |

**Message types:** TEXT, VOICE_NOTE, IMAGE, VIDEO, CALL_LOG

**Validation (`sendMessageSchema`):**
```json
{
  "receiverId": "UUID",
  "content": "string (required for TEXT, max 2000)",
  "type": "TEXT | VOICE_NOTE | IMAGE | VIDEO | CALL_LOG",
  "mediaUrl": "URL (required for IMAGE/VIDEO)",
  "mediaDuration": "number (for voice notes)"
}
```

### 7b. Calls

**Base path:** `/calls`  
**All routes require authentication**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/calls/history` | Yes | Get call history |
| POST | `/calls/token` | Yes | Generate LiveKit RTC token |

**Call types:** VOICE, VIDEO  
**Call statuses:** MISSED, COMPLETED, DECLINED, BUSY, CANCELLED

### Frontend Implementation
1. **Conversations list:** `GET /messages/conversations` — shows last message preview
2. **Send message:** `POST /messages/` — also emit via socket for instant delivery
3. **Voice notes:** Upload audio to Cloudinary first, then `POST /messages/voice-note`
4. **Read receipts:** Emit `mark_read` socket event with `messageId`
5. **Typing indicators:** Emit `typing` socket event with `receiverId` + `isTyping`
6. **Calls:** Use socket events (see Section 16), not REST endpoints
7. **Block/Report:** Show confirmation dialog; blocking removes user from all lists

### Potential Problems
- **Conversation auto-creation:** Messaging conversations are auto-created on dating match — don't create them manually
- **Voice note upload:** Must upload audio file to Cloudinary first, get URL, then send
- **Call state:** Active call sessions are in-memory on server — lost on server restart
- **Message ordering:** Messages don't have sequence numbers; rely on `createdAt` for ordering

---

## 8. Module: Membership & Subscriptions

**Base path:** `/membership`

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/membership/plans` | No | List all active membership plans |
| POST | `/membership/subscribe` | Yes | Subscribe to a plan |
| GET | `/membership/my-subscription` | Yes | Get current subscription |
| POST | `/membership/support` | Yes | Create priority support ticket (paid only) |
| POST | `/membership/payment-callback` | No | Hubtel payment callback |

### Membership Tiers (enum `MembershipTierCode`)
```
FREE → BASELINE → SENIOR_PIONEER → SANKOFA_SETTALLED → BASIC → SILVER → GOLD_INVESTOR → ELITE_AMBASSADOR
                                                                                              FAMILY_PLAN
```

### Subscribe Flow
```
FREE plan → Activate immediately (no payment) → Generate memberCode
Paid plan → Initialize Hubtel checkout → Redirect to payment page → Callback activates subscription
```

### Priority Support
- Only available for paid-tier members with ACTIVE subscription
- FREE tier users get error: "Priority support is only available for paid tier members"

### Frontend Implementation
1. **Plans page:** `GET /membership/plans` — display pricing cards
2. **Subscribe:** `POST /membership/subscribe` with `{ planId, callbackUrl, returnUrl }`
3. **Payment redirect:** Redirect user to Hubtel checkout URL from response
4. **Payment callback:** Handle `POST /membership/payment-callback` (server-side, not frontend)
5. **Subscription status:** `GET /membership/my-subscription` — check `tierCode` and `status`
6. **Feature gating:** Check `tierCode !== "FREE"` for premium features

### Potential Problems
- **Payment callback:** This is server-to-server — frontend should NOT call it directly
- **Subscription activation delay:** Paid plans activate on callback, not immediately; poll subscription status
- **Member code:** Generated once; if null after creation, a background job fixes it
- **Plan interval:** Subscription has `endDate` based on billing interval; check `status === "ACTIVE"` AND `endDate > now`

---

## 9. Module: Tours

**Base path:** `/tours`

### Endpoints

| Method | Path | Auth | Admin | Description |
|--------|------|------|-------|-------------|
| GET | `/tours/` | No | No | List all published tours |
| GET | `/tours/:tourId` | No | No | Get tour details |
| POST | `/tours/bookings` | Yes | No | Book a tour (card payment) |
| POST | `/tours/initiate-booking-momo` | Yes | No | Book a tour (MoMo payment) |
| GET | `/tours/bookings/my` | Yes | No | Get user's bookings |
| DELETE | `/tours/bookings/:bookingId` | Yes | No | Cancel a booking |
| PATCH | `/tours/user-itineraries/:itineraryId` | Yes | No | Update user itinerary |
| POST | `/tours/hubtel-callback` | No | No | Hubtel payment callback |
| POST | `/tours/` | Yes | Yes | Create a tour |
| PUT | `/tours/:id` | Yes | Yes | Update a tour |
| DELETE | `/tours/:id` | Yes | Yes | Delete a tour |
| POST | `/tours/:id/itinerary` | Yes | Yes | Add itinerary to tour |
| PUT | `/tours/itinerary/:id` | Yes | Yes | Update tour itinerary |
| DELETE | `/tours/itinerary/:id` | Yes | Yes | Delete tour itinerary |

### Tour Booking Flow
```
User selects tour → POST /tours/bookings or /tours/initiate-booking-momo
    → Payment initialized → Redirect to payment page
    → Callback confirms booking → Status updated to CONFIRMED
    → System generates itinerary (if AI-powered) or admin creates it
```

### Frontend Implementation
1. **Browse tours:** `GET /tours/` — public, no auth needed
2. **Tour detail:** `GET /tours/:tourId` — includes itinerary, pricing, media
3. **Book tour:** Choose payment method (card vs MoMo), submit booking
4. **My bookings:** `GET /tours/bookings/my` — show booking status and itinerary
5. **Cancel:** `DELETE /tours/bookings/:bookingId` — show confirmation dialog

### Potential Problems
- **Payment flow:** Card and MoMo have different initialization endpoints
- **Booking status:** Check `paymentStatus` AND `status` — payment can succeed while booking is still PENDING
- **Hubtel callback:** Server-to-server; frontend should poll booking status after redirect

---

## 10. Module: Itinerary Generation

**Base path:** `/itinerary`

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/itinerary/sites` | No | List available tour sites |
| POST | `/itinerary/request` | Yes | Submit a tour request |
| GET | `/itinerary/my-itineraries` | Yes | Get user's itineraries |
| POST | `/itinerary/:tourRequestId/payment` | Yes | Pay for itinerary |
| POST | `/itinerary/payment-callback` | No | Hubtel payment callback |
| GET | `/itinerary/requests` | Yes | Get user's tour requests |
| GET | `/itinerary/:tourRequestId` | Yes | Get specific itinerary |

### Tour Request Flow
```
User selects sites → POST /itinerary/request
    → System validates feasibility → Generates itinerary
    → Payment required → POST /itinerary/:tourRequestId/payment
    → Callback confirms → Itinerary finalized
```

### Frontend Implementation
1. **Site picker:** `GET /itinerary/sites` — show selectable sites on map/list
2. **Submit request:** `POST /itinerary/request` with selected sites, duration, preferences
3. **View itinerary:** `GET /itinerary/:tourRequestId` — show day-by-day plan
4. **Pay:** Initialize payment, redirect to Hubtel

### Potential Problems
- **Feasibility check:** Itinerary may be infeasible if sites are too far apart — show error from `feasibilityError`
- **Payment required:** Itinerary is generated but locked until payment completes

---

## 11. Module: Visa on Arrival

**Base path:** `/visa-requests`

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/visa-requests/` | Yes | Create a visa request |
| GET | `/visa-requests/` | Yes | Get user's visa request |
| POST | `/visa-requests/:requestId/payment` | Yes | Initiate visa payment |
| GET | `/visa-requests/:requestId/status` | Yes | Get visa status |
| POST | `/visa-requests/payment-callback` | No | Hubtel payment callback |
| GET | `/visa-requests/pricing/:visaType` | No | Get visa pricing |

### Visa Request Flow
```
User submits visa data → POST /visa-requests/
    → PAYMENT_FAILED or PENDING status
    → POST /visa-requests/:requestId/payment → Redirect to payment
    → Callback → Status changes to PENDING (awaiting admin review)
    → Admin approves → Status: APPROVED
    → Or admin rejects → Status: REJECTED
```

### Visa Data Schema (`visaOnArrivalDataSchema`)
```json
{
  "passport_image_url": "URL",
  "bio_page_image_url": "URL",
  "flight_itinerary_image_url": "URL",
  "passport_number": "string",
  "purpose_of_trip": "string",
  "date_of_departure": "ISO date",
  "date_of_arrival": "ISO date",
  "packageType": "STANDARD | EXPEDITED"
}
```

### Visa Request Statuses
```
PENDING → APPROVED / REJECTED / PAYMENT_FAILED / READY_FOR_GIS_SUBMISSION / EXPEDITED_AIRPORT_PAYMENT_PENDING
```

### Frontend Implementation
1. **Create request:** Upload 3 images to Cloudinary, submit with visa data
2. **Payment:** `POST /visa-requests/:requestId/payment` — redirect to Hubtel
3. **Status tracking:** `GET /visa-requests/:requestId/status` — show progress timeline
4. **Pricing:** `GET /visa-requests/pricing/:visaType` — show STANDARD vs EXPEDITED pricing

### Potential Problems
- **Image upload:** 3 images required (passport, bio page, flight itinerary) — upload all before submitting
- **Payment first:** Request starts in PENDING_PAYMENT; payment must complete before admin review
- **Status polling:** After payment, poll status — admin review is async
- **Package types:** STANDARD vs EXPEDITED have different pricing and processing times

---

## 12. Module: Payments

**Base path:** `/payment`  
**Rate limit:** 50 requests per 15 minutes per IP

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/payment/initialize` | Yes | Initialize a payment (Hubtel checkout) |
| GET | `/payment/verify/:reference` | Yes | Verify payment by reference |
| GET | `/payment/transaction-status/:posSalesId` | Yes | Check POS transaction status |

### Payment Initialization Schema
```json
{
  "totalAmount": "number > 0",
  "description": "string",
  "returnUrl": "URL (redirect after payment)",
  "callbackUrl": "URL (server-to-server webhook)",
  "cancellationUrl": "URL (redirect on cancel)"
}
```

### Payment Flow
```
Frontend → POST /payment/initialize → { checkoutUrl, clientReference }
    → Redirect to checkoutUrl → User pays
    → On success → Redirect to returnUrl
    → Server receives callbackUrl webhook → Updates payment status
```

### Payment Methods
- MTN_MOMO, TELECEL_MOMO, AT_MOMO (mobile money)
- CARD
- BANK_TRANSFER
- CASH

### Frontend Implementation
1. **Initialize:** `POST /payment/initialize` with amount and return/callback URLs
2. **Redirect:** Open `checkoutUrl` from response in browser/webview
3. **Return:** User lands on `returnUrl` after payment — show success/pending screen
4. **Verify:** `GET /payment/verify/:reference` to confirm payment status
5. **Never assume success:** Always verify server-side; don't trust redirect alone

### Potential Problems
- **Callback is async:** Payment may take seconds/minutes to confirm; don't assume instant success
- **Reference uniqueness:** Each payment has a unique `reference` — store it for verification
- **Currency:** Default is GHS (Ghana Cedis); ensure frontend displays correct currency
- **Amount precision:** Amount is Float; be careful with floating point display

---

## 13. Module: Image Upload

**Base path:** `/upload`  
**Auth required**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/upload/` | Yes | Upload image to Cloudinary |

### Upload Flow
```
Frontend → FormData with "image" field → POST /upload/
    → Multer processes file → Cloudinary uploads → Returns { url, publicId }
```

### Frontend Implementation
1. **Before submitting any image URL** (profile photo, visa document, tour media, etc.)
2. Upload to `POST /upload/` as multipart form data
3. Get back `{ url: "https://res.cloudinary.com/..." }`
4. Use that URL in subsequent API calls

### Potential Problems
- **File size:** Check Cloudinary limits (typically 10MB)
- **File types:** Ensure only images are uploaded (JPEG, PNG, GIF, WEBP)
- **Auth required:** Upload fails silently if token is expired — check 401
- **No batch upload:** Single file per request; for multiple photos, upload sequentially

---

## 14. Module: Providers

**Base path:** `/providers`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/providers/nearby-hotels` | Yes | Get nearby hotels (for tour packages) |

### Frontend Implementation
1. Pass user's location coordinates as query parameters
2. Returns hotels near the user's current location
3. Used in tour booking flow to suggest accommodations

---

## 15. Module: Admin Console

**Base path:** `/admin`  
**All routes require `protectedRoute` + `requireAdmin`**

### 15a. User Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/users` | List all users |
| PATCH | `/admin/users/:userId/promote` | Promote user to admin |
| PATCH | `/admin/users/:userId/demote` | Demote admin to user |
| PATCH | `/admin/users/:userId/suspend` | Suspend user account |
| PATCH | `/admin/users/:userId/reactivate` | Reactivate suspended user |
| DELETE | `/admin/users/:userId` | Permanently delete user |

### 15b. Visa Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/visa-requests` | List visa requests |
| GET | `/admin/visa-requests/stats` | Visa request statistics |
| GET | `/admin/visa-requests/:id` | Visa request detail |
| POST | `/admin/visa-requests/:id/approve` | Approve visa |
| POST | `/admin/visa-requests/:id/reject` | Reject visa |
| GET | `/admin/visa-requests/paid` | List paid visa requests |
| POST | `/admin/visa-requests/approve` | Approve visa request (legacy) |

### 15c. Profile Verification

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/profile-verifications` | List all verifications |
| PATCH | `/admin/profile-verifications/:id/bio-data` | Approve/reject bio data |
| PATCH | `/admin/profile-verifications/:id/face` | Approve/reject face scan |
| PATCH | `/admin/profile-verifications/:id/documents` | Approve/reject documents |
| POST | `/admin/profile-verifications/:id/verify` | Fully verify user |

### 15d. Moderation (Dating Reports)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/reports` | List user reports (paginated) |
| PATCH | `/admin/reports/:reportId` | Update report status |
| POST | `/admin/reports/:reportId/suspend` | Suspend reported user |

### 15e. Dashboard

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/dashboard/summary` | Dashboard statistics |
| GET | `/admin/payments` | List payments |
| GET | `/admin/payments/stats` | Payment statistics |

### 15f. Admin Registration

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/admin/auth/register` | No | Register admin account |

### Frontend Implementation (Admin Panel)
1. **Login:** Use same `/auth/login` endpoint; check `accountType === "ADMIN"`
2. **Dashboard:** `GET /admin/dashboard/summary` — show KPIs
3. **User management:** CRUD operations on users
4. **Visa processing:** Queue of paid requests → approve/reject
5. **Verification review:** Review bio data, face scans, documents → approve/reject
6. **Moderation:** Review reports → resolve or suspend users

### Potential Problems
- **Admin auth:** Admin routes require BOTH `protectedRoute` AND `requireAdmin` — regular users get 403
- **Cascading deletes:** Deleting a user cascades to all related records
- **Report resolution:** Resolving a report doesn't auto-suspend — use the `/suspend` endpoint
- **Audit trail:** All admin actions are logged in `AdminActivityLog`

---

## 16. Real-Time Layer (Socket.IO)

### Connection
```
Client connects with: io(url, { auth: { token: "<JWT>" } })
```

### Main Namespace Events

**Client → Server:**
| Event | Payload | Description |
|-------|---------|-------------|
| `typing` | `{ receiverId, isTyping }` | User is typing |
| `mark_read` | `{ messageId }` | Mark message as read |
| `presence:check` | `{ targetUserId }` | Check if user is online |

**Server → Client:**
| Event | Payload | Description |
|-------|---------|-------------|
| `user_typing` | `{ userId, isTyping }` | Other user is typing |
| `message_read` | `{ messageId, conversationId }` | Message was read |
| `presence:status` | `{ userId, isOnline, lastActiveAt }` | User online/offline status |
| `presence:info` | `{ userId, isOnline }` | Response to presence check |
| `new_message` | `{ message object }` | New message received |
| `match:mutual` | `{ match }` | Mutual match created (dating) |
| `match:incoming` | `{ swiperId, direction }` | Someone liked you (dating) |

### Call Namespace Events

**Client → Server:**
| Event | Payload | Description |
|-------|---------|-------------|
| `call:initiate` | `{ receiverId, callType }` | Start a voice/video call |
| `call:accept` | `{ callLogId, roomId }` | Accept incoming call |
| `call:decline` | `{ callLogId, roomId }` | Decline incoming call |
| `call:end` | `{ callLogId, roomId }` | End active call |
| `call:signal` | `{ targetUserId, signalData, roomId }` | WebRTC signaling |
| `call:switch_video_request` | `{ targetUserId, roomId }` | Request video upgrade |
| `call:switch_video_respond` | `{ targetUserId, roomId, accepted }` | Respond to video upgrade |
| `call:state_change` | `{ targetUserId, roomId, isMuted, isVideoOff, isSpeakerOn }` | Call state change |

**Server → Client:**
| Event | Payload | Description |
|-------|---------|-------------|
| `call:incoming` | `{ callLogId, roomId, callType, serviceUrl, caller }` | Incoming call |
| `call:initiated` | `{ callLogId, roomId, callType, serviceUrl }` | Call initiated confirmation |
| `call:accepted` | `{ callLogId, roomId, acceptedBy }` | Call accepted |
| `call:declined` | `{ callLogId, roomId, declinedBy }` | Call declined |
| `call:started` | `{ roomId, startedAt }` | Call connected |
| `call:ended` | `{ callLogId, roomId, durationSec, endedBy }` | Call ended |
| `call:timeout` | `{ callLogId, roomId }` | Call timed out (30s) |
| `call:busy` | `{ callLogId, receiverId, message }` | User is busy |
| `call:signal_received` | `{ fromUserId, signalData, roomId }` | WebRTC signal relay |
| `call:switch_video_requested` | `{ fromUserId, roomId }` | Video upgrade request |
| `call:switch_video_responded` | `{ fromUserId, roomId, accepted }` | Video upgrade response |
| `call:peer_state_changed` | `{ fromUserId, roomId, isMuted, isVideoOff, isSpeakerOn }` | Peer state change |
| `call:error` | `{ message }` | Call error |

### Frontend Implementation
1. **Connect on app open:** `io(API_URL, { auth: { token } })`
2. **Reconnect handling:** Socket.IO auto-reconnects; re-join rooms
3. **Typing indicators:** Debounce typing events (don't flood)
4. **Read receipts:** Mark messages read when conversation is open
5. **Presence:** Show online dot for matched users
6. **Calls:** Full WebRTC flow — initiate → ring (30s timeout) → accept → signal → end
7. **Match notifications:** Listen for `match:mutual` and `match:incoming` for real-time match UI

### Potential Problems
- **Socket auth:** Same JWT as REST — must be valid; handle `invalid token` error
- **Multiple tabs:** Each tab creates a new socket; presence tracks multiple socket IDs per user
- **Call state loss:** Active calls are in-memory on server — lost on restart (TODO in codebase)
- **WebRTC signaling:** `call:signal` is just relay — actual WebRTC peer connection is client-side
- **30-second timeout:** Calls auto-mark as MISSED after 30 seconds if not answered

---

## 17. Middleware Reference

| Middleware | File | Purpose |
|-----------|------|---------|
| `protectedRoute` | `middleware/protected.ts` | JWT verification; attaches `req.user` |
| `requireAdmin` | `middleware/admin.ts` | Checks `accountType === "ADMIN"` |
| `validate(schema)` | `middleware/validation.ts` | Zod schema validation on `req.body` |
| `createRateLimiter` | `middleware/rateLimit.ts` | Redis-backed rate limiting |
| `upload.single("image")` | `middleware/cloudinary-upload.ts` | Multer + Cloudinary image upload |
| `verifyHubtelCallback` | `middleware/hubtel-callback.ts` | Verify Hubtel payment webhook signatures |

### Rate Limiters Applied
| Scope | Window | Max Requests |
|-------|--------|-------------|
| Auth routes | 15 min | 20 |
| Payment routes | 15 min | 50 |
| Dating swipes | 15 min | 200 |

---

## 18. Database Schema Reference

### Core Models

| Model | Purpose | Key Relationships |
|-------|---------|-------------------|
| `User` | Core user account | Has one: Profile, Subscription, DatingProfile, AdminProfile |
| `UserProfile` | Public profile (bio image, documents) | Belongs to User |
| `UserVerification` | Verification status | Belongs to User |
| `UserSubscription` | Membership subscription | Belongs to User, references Plan |
| `MembershipPlan` | Plan definition (price, features) | Has many Subscriptions |

### Dating Models

| Model | Purpose | Key Relationships |
|-------|---------|-------------------|
| `DatingProfile` | Dating-specific profile | Belongs to User, has one DiscoveryPreference |
| `DiscoveryPreference` | Discovery filters | Belongs to User + DatingProfile |
| `UserSwipe` | Swipe record | References Swiper + Target (both Users) |
| `UserMatch` | Mutual match | References two Users |

### Communication Models

| Model | Purpose | Key Relationships |
|-------|---------|-------------------|
| `Conversation` | Chat thread | Has participants (String[]) |
| `Message` | Chat message | Belongs to Conversation, Sender, Receiver |
| `CallLog` | Call history | References Caller + Receiver |

### Safety Models

| Model | Purpose |
|-------|---------|
| `UserBlock` | Block relationship between two users |
| `UserReport` | User report (reason, status, resolution) |

### Commerce Models

| Model | Purpose |
|-------|---------|
| `Payment` | Payment record (reference, amount, status) |
| `BillingHistory` | Subscription billing records |
| `tour_packages` | Tour package definitions |
| `tour_bookings` | Tour booking records |
| `VisaOnArrivalRequest` | Visa request |
| `VisaOnArrivalData` | Visa application data |
| `VisaApproval` | Visa approval status |

---

## 19. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_ACCESS_SECRET` | Yes | JWT access token secret |
| `JWT_REFRESH_SECRET` | Yes | JWT refresh token secret |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | No | Redis URL (enables multi-instance support) |
| `ALLOWED_ORIGINS` | Yes | Comma-separated CORS origins |
| `API_URL` | Yes | Public API URL |
| `RENDER_EXTERNAL_URL` | Yes | Render deployment URL |
| `CLOUDINARY_*` | Yes | Cloudinary credentials |
| `HUBTEL_*` | Yes | Hubtel payment credentials |
| `RESEND_API_KEY` | Yes | Resend email service key |
| `SENTRY_DSN` | No | Sentry error tracking |
| `LIVEKIT_*` | Yes | LiveKit call service credentials |

---

## 20. Frontend Implementation Guide

### App Startup Flow
```
1. Check stored auth token
2. If valid → GET /dating/profile/status (skip onboarding?)
3. If no profile → Show onboarding wizard
4. If profile exists → GET /dating/recommendations (show discovery)
5. Connect Socket.IO for real-time
6. GET /messages/conversations (show chat list)
7. GET /membership/my-subscription (check tier for feature gating)
```

### Onboarding Flow (Dating Profile)
```
Screen 1: Basic Info → fullName, gender, dateOfBirth, ethnicity
Screen 2: Location → location
Screen 3: Education → degree, university, profession, industry, workLocation
Screen 4: Interests → interests (categorized on frontend, flat array on backend)
Screen 5: Photos → upload to Cloudinary → save URLs (max 6 frontend, 9 backend)
Screen 6: Cultural → languages, religion, hometown
Screen 7: Preferences → lookingFor, discovery preferences

→ Single POST /dating/profile/init with all fields
→ Single PUT /dating/preferences with discovery settings
```

### Token Refresh Strategy
```javascript
// Axios interceptor pattern
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      const { data } = await api.post('/auth/refresh-token', { refreshToken });
      // Update stored tokens
      // Retry original request
      error.config.headers.Authorization = `Bearer ${data.accessToken}`;
      return api(error.config);
    }
    return Promise.reject(error);
  }
);
```

### Image Upload Strategy
```javascript
// Upload to Cloudinary first, then use URL in API calls
async function uploadImage(file) {
  const formData = new FormData();
  formData.append('image', file);
  const { data } = await api.post('/upload/', formData);
  return data.data.url; // Cloudinary URL
}
```

### Real-Time Event Handling
```javascript
const socket = io(API_URL, { auth: { token: accessToken } });

// Match notifications
socket.on('match:mutual', ({ match }) => { /* Show match screen */ });
socket.on('match:incoming', ({ swiperId }) => { /* Show "Someone liked you" */ });

// Messages
socket.on('new_message', (message) => { /* Update chat UI */ });

// Typing
socket.on('user_typing', ({ userId, isTyping }) => { /* Show typing indicator */ });

// Presence
socket.on('presence:status', ({ userId, isOnline }) => { /* Update online dot */ });

// Calls
socket.on('call:incoming', (payload) => { /* Show incoming call UI */ });
socket.on('call:ended', (payload) => { /* End call UI */ });
```

---

## 21. Known Gotchas & Potential Problems

### Critical Issues

1. **Likes-received response shape:** Always `{ count, profiles }` — don't iterate directly as array
2. **Super-like 429:** Returns `details.code === "SUPER_LIKE_LIMIT_EXCEEDED"` with `resetAt` timestamp
3. **Profile deactivation cascade:** After `DELETE /dating/profile/deactivate`, all dating endpoints 404 — redirect to onboarding
4. **Payment callbacks are async:** Never assume payment success from redirect alone; verify with `GET /payment/verify/:reference`

### Authentication Gotchas

5. **Token expiry:** Access tokens expire in 1 day; implement refresh interceptor
6. **Social auth:** Returns tokens in callback URL — extract and store securely
7. **Multiple devices:** Refresh tokens are per-device; logging in on new device doesn't invalidate old one

### Data Validation

8. **Age restriction:** DOB must be 18+ — test data with younger ages will fail
9. **E.164 phone format:** Phone numbers must include country code (+233...)
10. **Password rules:** 8+ chars, uppercase, lowercase, number, special character
11. **UUID format:** All ID parameters must be valid UUIDs

### Real-Time

12. **Socket reconnection:** Socket.IO auto-reconnects but may miss events during disconnect — implement catch-up via REST
13. **Call state loss:** Server restarts lose active call state — callers should handle unexpected disconnection
14. **Multiple tabs:** Each tab creates separate socket; presence tracks all

### Payment

15. **Currency:** Default is GHS; ensure frontend displays correct currency symbol
16. **Hubtel callback:** Server-to-server; frontend must poll for status after redirect
17. **Payment status:** Check both `paymentStatus` AND entity status — they update independently

### File Upload

18. **Single file per request:** No batch upload; upload multiple files sequentially
19. **Auth required:** Upload fails if token expired — check 401 response
20. **File size:** Check Cloudinary limits; compress large images on client side

### Admin

21. **Admin auth chain:** Requires BOTH `protectedRoute` + `requireAdmin` — regular users get 403
22. **Cascading deletes:** Deleting users cascades to all related records permanently

### Dating

23. **Match auto-creates conversation:** Don't create conversations manually for matched users
24. **Super-like limits:** Check `error.details.resetAt` for countdown timer in upgrade modal
25. **Discovery pagination:** Fetch all candidates server-side, rank in memory, then paginate — offset is accurate
