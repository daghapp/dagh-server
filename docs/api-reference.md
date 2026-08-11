# DAGH Backend — Complete API Reference

Full listing of every endpoint in the `dagh-server` API, grouped by module, with
what each one does, its request payload, and key response/error details.

- Base URL (dev): `http://localhost:5000`
- Base URL (prod): `https://dagh-server-fo64.onrender.com`
- Interactive docs: `GET /api-docs` (Swagger UI)
- Health check: `GET /health`

**Auth column legend**

| Value | Meaning |
|-------|---------|
| Public | No authentication required |
| Bearer | Requires `Authorization: Bearer <accessToken>` |
| Admin | Bearer token **plus** an `ADMIN` (or `MODERATOR`) account type |
| Hubtel | Called by Hubtel's payment server (validated signature) |

**Response envelope**

```json
{ "success": true, "data": { ... }, "message": "Optional message" }   // success
{ "success": false, "error": "Human-readable error" }                // error
{ "success": false, "errors": [{ "path": "field", "message": "..." }] } // validation (Zod)
```

Paginated lists wrap data as `{ success, data: [...], pagination: { total, page, limit, totalPages } }`.

---

## Authentication

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| POST | `/auth/register` | Public | Create a new account; returns the user. |
| POST | `/auth/login` | Public | Log in; returns `accessToken` + `refreshToken`. |
| POST | `/auth/verify-otp` | Public | Verify an email OTP (email verification or password reset). |
| POST | `/auth/resend-otp` | Public | Resend the email-verification OTP (rate-limited, 1/min). |
| POST | `/auth/refresh-token` | Public | Exchange a refresh token for a new access token. |
| POST | `/auth/request-reset-password` | Public | Send a password-reset OTP to an email. |
| POST | `/auth/reset-password` | Bearer | Verify OTP + old password, then set a new password. |
| POST | `/auth/logout` | Bearer | Log out; invalidates all of the user's refresh tokens. |
| GET | `/auth/google` | Public | Redirect to Google OAuth consent. |
| GET | `/auth/google/callback` | Public | Google OAuth callback (302 → success/failure page). |
| GET | `/auth/google/failed` | Public | Renders "auth failed" page (401). |
| GET | `/auth/google/success` | Public | Renders "auth success" page. |
| GET | `/auth/facebook` | Public | Redirect to Facebook OAuth consent. |
| GET | `/auth/facebook/callback` | Public | Facebook OAuth callback. |
| GET | `/auth/facebook/failed` | Public | Renders "auth failed" page (401). |
| GET | `/auth/facebook/success` | Public | Renders "auth success" page. |
| GET | `/auth/apple` | Public | Redirect to Apple Sign In. |
| POST | `/auth/apple/callback` | Public | Apple Sign In callback (body includes `user` JSON on first login). |
| GET | `/auth/apple/failed` | Public | Renders "auth failed" page (401). |
| GET | `/auth/apple/success` | Public | Renders "auth success" page. |

### POST /auth/register

```json
{
  "fullName": "John Doe",
  "phoneNumber": "+233201234567",
  "gender": "MALE",
  "dateOfBirth": "1990-01-01",
  "email": "user@example.com",
  "password": "Password123!",
  "ethnicity": "African"
}
```

- `phoneNumber` must be E.164 (`^\+[1-9]\d{1,14}$`).
- `password` needs ≥ 1 uppercase, lowercase, number, and special character.
- Returns `201` with the user (no `passwordHash`). 400 if the email is taken or validation fails.

### POST /auth/login

```json
{ "email": "user@example.com", "password": "Password123!" }
```

Returns `data: { id, email, fullName, accountType, accessToken, refreshToken }`.
`403` if the email is not yet verified.

---

## Image Upload

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| POST | `/upload` | Bearer | Upload one file to Cloudinary; returns its URL and public ID. |

`multipart/form-data`, field name **`image`**. Limits: **5 MB**; only **JPG, PNG, PDF**.

```json
// 201
{ "success": true, "data": { "url": "https://res.cloudinary.com/...", "publicId": "dagh/uploads/..." }, "message": "Upload successful." }
```

`413` = file too large; `400` = no file / wrong type. Used by verification (face + documents) and anywhere else an image URL is needed.

---

## Profile Management

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| POST | `/profile/init` | Bearer | Create the user's `UserProfile` + empty `ProfileVerification` row (idempotent). |
| PATCH | `/profile` | Bearer | Update own account fields: `fullName`, `gender`, `dateOfBirth`, `ethnicity`. |
| PATCH | `/profile/ethnicity` | Bearer | Set the user's ethnicity (used for itinerary personalization). |

### PATCH /profile

Updates the authenticated user's own account-level fields (used by the Profile
Settings "Basic Info" and "Cultural Background" steps). All fields optional.

```json
{ "fullName": "Ama Mensah", "gender": "FEMALE", "dateOfBirth": "1995-06-15", "ethnicity": "African" }
```

- `gender` ∈ `MALE | FEMALE | OTHER`.
- `dateOfBirth` must be a valid, **past** date.
- `ethnicity` enum: `African, Asian, Black_African_American, Caribbean, Caucassian_White, Hispanic_Latino, Middle_Eastern, Mixed, Native_American_Indigenous, Pacific_Islander, Other`.

`400` = validation error; `401` = unauthorized.

### PATCH /profile/ethnicity

```json
{ "ethnicity": "African" }
```

`ethnicity` enum: `African, Asian, Black_African_American, Caribbean, Caucassian_White, Hispanic_Latino, Middle_Eastern, Mixed, Native_American_Indigenous, Pacific_Islander, Other`.

---

## Identity Verification

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| POST | `/verification/init` | Bearer | Initialize the verification profile (idempotent). |
| POST | `/verification/phone/send-otp` | Bearer | Save/normalize the phone number and email a 6-digit OTP. |
| POST | `/verification/phone/verify-otp` | Bearer | Validate the 6-digit code; marks phone step verified. |
| POST | `/verification/bio_profile_url` | Bearer | Save the face-scan image URL; advance to document step. |
| POST | `/verification/bio_document_urls` | Bearer | Save document images + type; enter pending review. |
| GET | `/verification/status` | Bearer | Full verification status (per-step `PENDING / VERIFIED / REJECTED`, current step, completed steps). |
| GET | `/verification/validation-step/status` | Bearer | Poll current step and its `PENDING / VERIFIED / REJECTED` status. |

The OTP arrives **by email** (subject "Phone Verification OTP", 10-minute expiry).
Phone numbers are normalized (whitespace + leading `+` stripped).

```json
// POST /verification/bio_document_urls
{ "bio_document_urls": ["https://...front.jpg", "https://...back.jpg"], "bio_document_type": "PASSPORT" }

// GET /verification/validation-step/status
{ "success": true, "data": { "current_step": "DOCUMENT_VERIFICATION", "status": "REJECTED", "verification_message": "Expired document" } }

// GET /verification/status
{
  "success": true,
  "data": {
    "profileExists": true,
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

`current_step` ∈ `PHONE_NUMBER_VERIFICATION | PROFILE_IMAGE_VERIFICATION | DOCUMENT_VERIFICATION`.
`verification_message` is only present when `status` is `REJECTED`.
`GET /verification/status` returns `profileExists: false` (instead of 404) when the user has no profile yet.

See `docs/verification-flow.md` for the full frontend integration guide.

---

## Tours

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| GET | `/tours` | Public | List tours (filterable + paginated). |
| GET | `/tours/:tourId` | Public | Full tour detail (itineraries, activities, locations, media, pricing). |
| POST | `/tours` | Admin | Create a tour package. |
| PUT | `/tours/:id` | Admin | Update a tour. |
| DELETE | `/tours/:id` | Admin | Delete a tour. |
| POST | `/tours/:id/itinerary` | Admin | Add an itinerary day to a tour. |
| PUT | `/tours/itinerary/:id` | Admin | Update a tour itinerary day. |
| DELETE | `/tours/itinerary/:id` | Admin | Delete a tour itinerary day. |
| POST | `/tours/bookings` | Bearer | Book a tour (Hubtel checkout flow). |
| POST | `/tours/initiate-booking-momo` | Bearer | Book a tour (direct Mobile Money via Hubtel). |
| POST | `/tours/hubtel-callback` | Hubtel | Hubtel payment callback (confirms booking). |
| GET | `/tours/bookings/my` | Bearer | List the current user's bookings. |
| PATCH | `/tours/user-itineraries/:itineraryId` | Bearer | Edit the user's personalized tour itinerary. |
| DELETE | `/tours/bookings/:bookingId` | Bearer | Cancel a booking. |

### GET /tours — query filters

`category`, `subcategory`, `status` (`draft|published|archived|pending_review`), `featured`, `trending`, `durationDays`, `minPrice`, `maxPrice`, `search`, `page`, `limit` (max 100).

### POST /tours/bookings

```json
{ "tourId": "uuid", "numberOfPeople": 2, "bookingDate": "2026-05-25", "tourStartDate": "2026-06-01", "specialRequests": "Vegetarian meals" }
```

Returns `201` with `data: { paymentData, booking }` (Hubtel checkout data + created booking).

### POST /tours/initiate-booking-momo

```json
{ "tourId": "uuid", "numberOfPeople": 2, "bookingDate": "2026-05-25T10:00:00Z", "tourStartDate": "2026-06-01T08:00:00Z", "paymentMethod": "MTN_MOMO", "phoneNumber": "233501234567", "specialRequests": "..." }
```

`paymentMethod` ∈ `MTN_MOMO | TELECEL_MOMO | AT_MOMO`; `phoneNumber` must match `^233\d{9}$`.
Returns `bookingId`, `paymentId`, and the raw `hubtelResponse`. Final status arrives via callback.

---

## Itinerary Generation

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| GET | `/itinerary/sites` | Public | List all Ghana tour sites (for the site picker). |
| POST | `/itinerary/request` | Bearer | Create a custom tour request (site + preferences). |
| GET | `/itinerary/my-itineraries` | Bearer | List the user's generated itineraries. |
| GET | `/itinerary/requests` | Bearer | List the user's tour requests. |
| GET | `/itinerary/:tourRequestId` | Bearer | Fetch a generated itinerary (only after payment). |
| POST | `/itinerary/:tourRequestId/payment` | Bearer | Initiate Hubtel payment for a tour request. |
| POST | `/itinerary/payment-callback` | Hubtel | Hubtel callback; marks the request paid. |

### POST /itinerary/request

```json
{
  "tourSiteIds": ["uuid", "uuid"],
  "tourType": "SINGLE",
  "durationDays": 7,
  "relocationInterest": false,
  "apartmentType": "HOTEL",
  "transportType": "UBER",
  "companionInterest": false
}
```

`201` = request created; **`422`** = created but not feasible (an itinerary can't be generated — show the feasibility error).

### GET /itinerary/:tourRequestId

Returns the generated itinerary + price. **`403` with `PAYMENT_REQUIRED`** until the request is paid.

---

## Visa-on-Arrival

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| POST | `/visa-requests` | Bearer | Create a visa request with passport data. |
| GET | `/visa-requests` | Bearer | List the user's visa requests. |
| GET | `/visa-requests/:requestId/status` | Bearer | Get one request's status. |
| POST | `/visa-requests/:requestId/payment` | Bearer | Initiate payment (STANDARD or EXPEDITED). |
| POST | `/visa-requests/payment-callback` | Hubtel | Hubtel callback; marks visa request paid. |
| GET | `/visa-requests/pricing/:visaType` | Public | Pricing breakdown for `STANDARD` or `EXPEDITED`. |

### POST /visa-requests

```json
{
  "passport_image_url": "https://...",
  "bio_page_image_url": "https://...",
  "flight_itinerary_image_url": "https://...",
  "passport_number": "G1234567",
  "purpose_of_trip": "Tourism",
  "date_of_departure": "2026-09-01T00:00:00Z",
  "date_of_arrival": "2026-08-15T00:00:00Z",
  "primary_place_of_stay": "Hotel X, Accra"
}
```

Image fields should be URLs from `POST /upload`.

`requestId` status values: `PENDING | APPROVED | REJECTED | READY_FOR_GIS_SUBMISSION | EXPEDITED_AIRPORT_PAYMENT_PENDING | PAYMENT_FAILED`.

---

## Payments

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| POST | `/payment/initialize` | Bearer | Initiate a generic Hubtel payment; returns a reference. |
| GET | `/payment/verify/:reference` | Bearer | Verify a payment by reference and update its record. |
| GET | `/payment/transaction-status/:posSalesId` | Bearer | Check transaction status via Hubtel's status API. |
| GET | `/payment/processing` | Public | Serves the "processing…" HTML page. |
| GET | `/payment/p.js` | Public | Serves the payment redirect script. |

### POST /payment/initialize

```json
{
  "totalAmount": 150.00,
  "description": "Payment for visa application",
  "returnUrl": "https://example.com/success",
  "callbackUrl": "https://example.com/callback",
  "cancellationUrl": "https://example.com/cancelled"
}
```

Returns `data: { paymentReference }`. Payment routes are rate-limited (50 req/15 min).

---

## Providers

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| GET | `/providers/nearby-hotels` | Bearer | Find verified hotels within a radius of a tour site. |

Query: `tourSiteId` (required), `radiusKm` (default 30), `limit` (default 10).

---

## Membership Plans & Tiers

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| GET | `/membership/plans` | Public | List active plans with pricing, intervals, features. |
| POST | `/membership/subscribe` | Bearer | Subscribe to a plan (free = instant, paid = Hubtel checkout). |
| GET | `/membership/my-subscription` | Bearer | Current user's subscription + plan + member code. |
| POST | `/membership/support` | Bearer | Open a priority support ticket (paid tiers only). |
| POST | `/membership/payment-callback` | Hubtel | Hubtel callback; activates the subscription. |

### POST /membership/subscribe

```json
{ "planId": "uuid", "returnUrl": "https://...", "callbackUrl": "https://...", "cancellationUrl": "https://..." }
```

### POST /membership/support

```json
{ "subject": "Billing question", "message": "I was charged twice..." }
```

`400` for free-tier users (paid subscription required).

---

## Dating

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| GET | `/dating/profile` | Bearer | Get own dating profile + discovery preferences. |
| POST | `/dating/profile/init` | Bearer | Initialize own dating profile (idempotent; accepts the full creation payload). |
| PATCH | `/dating/profile` | Bearer | Update profile settings (basic info, education & career, cultural background, photos, interests, goals) + account fields. |
| GET | `/dating/profile/status` | Bearer | Profile existence + completion status (bypass onboarding for returning users). |
| GET | `/dating/profile/:userId` | Bearer | View another user's public profile (blocked users excluded → 403). |
| GET | `/dating/preferences` | Bearer | Get own discovery preferences. |
| PUT | `/dating/preferences` | Bearer | Set discovery preferences. |
| POST | `/dating/swipe` | Bearer | Swipe LIKE / SUPER_LIKE / PASS; mutual LIKE creates a match + conversation. |
| GET | `/dating/recommendations` | Bearer | Ranked candidates (excludes passed/blocked/hidden; likes stay in the queue). |
| GET | `/dating/matches` | Bearer | List active matches. |
| GET | `/dating/likes-received` | Bearer | List users who liked you. |
| DELETE | `/dating/matches/:matchId` | Bearer | Unmatch (soft-remove). |

### POST /dating/swipe

```json
{ "targetId": "uuid", "direction": "LIKE" }
```

`direction` ∈ `LIKE | SUPER_LIKE | PASS`. Responses: `201` (swipe recorded; match data when mutual), `400` self-swipe, `403` blocked target, `404` no dating profile, `409` already swiped. **Rate-limited to 200 swipes / 15 min.**

### PUT /dating/preferences

```json
{
  "lookingFor": "LONG_TERM_PARTNER",
  "genderPreference": ["FEMALE"],
  "minAge": 25,
  "maxAge": 40,
  "maxDistanceKm": 50,
  "locationLat": 5.6,
  "locationLng": -0.2,
  "locationName": "Accra",
  "showProfile": true,
  "showOnlineStatus": true
}
```

### PATCH /dating/profile

Supports the multi-step "Profile Settings" flow (Basic Info, Education & Career,
Cultural Background, Relationship Goals, Photos). All fields optional, so the
frontend can save each step independently.

```json
// Basic Info
{ "heightCm": 178, "location": "Accra, Ghana" }

// Education & Career
{ "degree": "BSc Computer Science", "university": "University of Ghana", "profession": "Software Engineer", "industry": "Technology", "workLocation": "Accra" }

// Cultural Background
{ "languages": ["English", "Twi"], "religion": "Christianity", "hometown": "Kumasi" }

// Relationship Goals & Interests
{ "lookingFor": "LONG_TERM_PARTNER", "interests": ["Cooking", "Photography", "Tech"] }

// Photos (URLs from POST /upload)
{ "photos": ["https://res.cloudinary.com/...", "https://res.cloudinary.com/..."] }
```

Full field list: `headline`, `about`, `photos` (max 9), `heightCm` (120–250),
`interests` (max 20), `lookingFor` (`LONG_TERM_PARTNER | SHORT_TERM | FRIENDSHIP | NOT_SURE`),
`location`, `degree`, `university`, `profession`, `industry`, `workLocation`,
`languages` (max 20), `religion`, `hometown`.

Account-level fields (`fullName`, `gender`, `dateOfBirth`, `ethnicity`) are also
accepted and saved on the user's account — so a single `PATCH /dating/profile`
(and `POST /dating/profile/init`) captures every value from the profile forms.

`404` if the dating profile hasn't been initialized (`POST /dating/profile/init` first).

### GET /dating/profile/status

Returns `hasProfile`, a computed `profileStatus` (`INCOMPLETE` / `COMPLETE`), and
the profile (with discovery preferences) when present. Returning users who already
have a profile can use this to skip the initial profile creation/skip screen:

```json
{ "success": true, "data": { "hasProfile": true, "profileStatus": "COMPLETE", "profile": { "id": "…", "headline": "…", "photos": ["…"] } } }
```

### GET /dating/profile

Returns the dating profile **plus the related `user` object** (`fullName`,
`dateOfBirth`, `gender`, `ethnicity`, and profile image), so the Profile Preview
can show the name and compute age from `dateOfBirth`.

---

## Messages & Safety

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| POST | `/messages` | Bearer | Send a text or media message. |
| POST | `/messages/voice-note` | Bearer | Upload + send a voice note (multipart `audio`, 15 MB max). |
| GET | `/messages/matches` | Bearer | Active matches ("New Matches" carousel). |
| GET | `/messages/conversations` | Bearer | Conversations with unread counts, partner profiles, online status. |
| GET | `/messages/conversations/:conversationId` | Bearer | Messages in a conversation (marks unread as read). |
| PATCH | `/messages/:messageId/read` | Bearer | Mark one message as read. |
| POST | `/messages/block` | Bearer | Block a user (blocks messages + calls both ways). |
| DELETE | `/messages/block/:blockedId` | Bearer | Unblock a user. |
| POST | `/messages/report` | Bearer | Report a user. |

### POST /messages

```json
{ "receiverId": "uuid", "content": "Hi there", "type": "TEXT", "mediaUrl": "https://...", "mediaDuration": 12 }
```

- `type` ∈ `TEXT | VOICE_NOTE | IMAGE | VIDEO`.
- `content` required for `TEXT` (max 2000); `mediaUrl` required for `IMAGE`/`VIDEO`.
- `403` if the two users are blocked from each other.

### POST /messages/voice-note

`multipart/form-data`: `receiverId`, `mediaDuration` (seconds), `audio` (file). MIME types: MP3, M4A, WAV, AAC, OGG, WEBM. `413` over 15 MB.

### POST /messages/report

```json
{ "targetId": "uuid", "reason": "Harassment", "details": "..." }
```

`reason` 3–255 chars, `details` max 1000.

---

## Calls

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| GET | `/calls/history` | Bearer | Last 50 incoming/outgoing call logs. |
| POST | `/calls/token` | Bearer | Generate a LiveKit AccessToken for a call room + `serviceUrl` (valid 1 hour). |

### POST /calls/token

```json
{ "roomId": "room-123", "callType": "VOICE" }
```

`callType` ∈ `VOICE | VIDEO` (default `VOICE`). Pair with Socket.IO signaling events (`call:initiate`, `call:accept`, etc.).

When LiveKit is configured (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`), the response contains a real room-scoped LiveKit token and `serviceUrl` is the `LIVEKIT_URL` the client connects to for media. Without LiveKit env vars, a placeholder HMAC token is returned (dev only).

---

## Admin — User Management

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| GET | `/admin/users` | Admin | List all users. |
| PATCH | `/admin/users/:userId/promote` | Admin | Promote a user to admin. |
| PATCH | `/admin/users/:userId/demote` | Admin | Demote an admin to user. |
| PATCH | `/admin/users/:userId/suspend` | Admin | Suspend an account. |
| PATCH | `/admin/users/:userId/reactivate` | Admin | Reactivate a suspended account. |
| DELETE | `/admin/users/:userId` | Admin | Permanently delete a user. |

All are idempotent-safe: each returns `400` if the target is already in that state and `404` if the user doesn't exist.

---

## Admin — Profile Verification

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| GET | `/admin/profile-verifications` | Admin | List all verifications with per-section status and image URLs. |
| PATCH | `/admin/profile-verifications/:id/bio-data` | Admin | Approve/reject bio data. |
| PATCH | `/admin/profile-verifications/:id/face` | Admin | Approve/reject the face scan. |
| PATCH | `/admin/profile-verifications/:id/documents` | Admin | Approve/reject documents (Passport / Ghana Card). |
| POST | `/admin/profile-verifications/:id/verify` | Admin | Approve every section at once. |

### PATCH .../bio-data | .../face | .../documents

```json
{ "action": "APPROVED", "reason": "Looks genuine" }
```

`action` ∈ `APPROVED | REJECTED`; `reason` is required on rejection (surfaces to the user as `verification_message`).

**Side effects:** approving face/documents flips `bio_profile_verification` / `document_verification` so the user's status reports `VERIFIED`; rejecting clears `isVerified` and reports `REJECTED` to the user. `POST .../verify` sets every flag and `isVerified: true`.

---

## Admin — Visa

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| GET | `/admin/visa-requests/paid` | Admin | Paid visa requests ready for processing. |
| POST | `/admin/visa-requests/approve` | Admin | Approve a visa request. |

```json
// POST /admin/visa-requests/approve
{ "requestId": "uuid" }
```

---

## Admin — Moderation

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| GET | `/admin/reports` | Admin | List user reports (`?status=`, `?page=`, `?limit=`). |
| PATCH | `/admin/reports/:reportId` | Admin | Set a report's status + optional note. |
| POST | `/admin/reports/:reportId/suspend` | Admin | Suspend the reported user and resolve the report. |

### PATCH /admin/reports/:reportId

```json
{ "status": "RESOLVED", "resolutionNote": "Warned the user" }
```

`status` ∈ `REVIEWING | RESOLVED | DISMISSED`.

---

## System

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| GET | `/health` | Public | Uptime + timestamp. |
| GET | `/api-docs` | Public | Swagger UI. |
| GET | `/` | Public | API name/version + links. |

---

## Rate limits & global behavior

- Auth routes: 20 req / 15 min.
- Payment routes: 50 req / 15 min.
- Swipes: 200 req / 15 min.
- Uploads: 5 MB (images/documents) or 15 MB (voice notes); auth required.
- Unknown paths return `404` via a catch-all middleware.
- `passwordHash` is never serialized in responses.
