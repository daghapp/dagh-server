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
| GET | `/profile/account` | Bearer | Get the authenticated user's login profile: `username`, `firstName`, `lastName`, `fullName`, `profileImageUrl`, plus account fields. |
| PATCH | `/profile/account` | Bearer | Update own login profile: `username`, `firstName`, `lastName`, `profileImageUrl` (send `null` on `profileImageUrl` to remove the picture). |
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
| POST | `/itinerary/request` | Bearer | Create a custom tour request (site + preferences; `casualDatingInterest` opts into dating recommendations and requires KYC). |
| GET | `/itinerary/my-itineraries` | Bearer | List the user's generated itineraries. |
| GET | `/itinerary/requests` | Bearer | List the user's tour requests. |
| GET | `/itinerary/:tourRequestId` | Bearer | Fetch a generated itinerary (only after payment; includes `datingSelections` + per-day `socialBlocks` when dating profiles are selected). |
| POST | `/itinerary/:tourRequestId/payment` | Bearer | Initiate Hubtel payment for a tour request; returns top-level `checkoutUrl`. |
| POST | `/itinerary/payment-callback` | Hubtel | Hubtel callback; marks the request paid. |
| POST | `/itinerary/:tourRequestId/dating-selections` | Bearer | Select recommended dating profiles to merge into the itinerary (KYC-gated). |
| GET | `/itinerary/:tourRequestId/dating-selections` | Bearer | List dating profiles merged into a tour's itinerary. |

### POST /itinerary/request

```json
{
  "tourSiteIds": ["uuid", "uuid"],
  "tourType": "SINGLE",
  "durationDays": 7,
  "relocationInterest": false,
  "apartmentType": "HOTEL",
  "transportType": "UBER",
  "companionInterest": false,
  "casualDatingInterest": true
}
```

`201` = request created; **`422`** = created but not feasible (an itinerary can't be generated — show the feasibility error).

`casualDatingInterest` (optional, default `false`) opts the trip into casual-dating
recommendations and is gated behind **full KYC verification**. If the user has not completed
all verification steps, the request returns **`403`** with:

```json
{
  "success": false,
  "error": "KYC verification required",
  "details": { "action": "COMPLETE_VERIFICATION", "redirect": "/verification" }
}
```

### POST /itinerary/:tourRequestId/payment

Returns the Hubtel checkout URL at the top level so the frontend can redirect immediately:

```json
{
  "success": true,
  "data": {
    "tourRequestId": "uuid",
    "paymentId": "uuid",
    "checkoutUrl": "https://checkout.hubtel.com/session/cs_123456",
    "checkoutId": "checkout_id",
    "clientReference": "ref",
    "paymentData": { "responseCode": "0000", "data": { "checkoutUrl": "https://..." } }
  },
  "message": "Payment initiated. Proceed to complete payment to view itinerary."
}
```

If the provider does not return a checkout URL, the endpoint fails with `502`.

### POST /itinerary/:tourRequestId/dating-selections

Body:

```json
{ "datingProfileIds": ["uuid", "uuid"] }
```

Persists the selected dating profiles against the tour request (KYC-gated) and returns the updated selection list.

### GET /itinerary/:tourRequestId

Returns the generated itinerary + price. **`403` with `PAYMENT_REQUIRED`** until the request is paid.
When dating profiles are selected, the response includes a flat `datingSelections` array and,
per touring day, `socialBlocks`. See the dating module for recommendation filtering via
`GET /dating/recommendations?tourRequestId=<uuid>`.

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

## Community (YouTube Video Feed)

Gated video cards that drive app members to the YouTube channel. A preview teaser
is freely viewable; full-length playback is unlocked per user after tapping
"Subscribe to Unlock". Every action is logged server-side as an analytics event
so you can measure the funnel (card view → subscribe intent → watch).

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| GET | `/community/videos` | Bearer | List published cards (`?page=&limit=`); each card carries `isUnlocked`. |
| GET | `/community/videos/:videoId` | Bearer | Single card + caller's unlock status. |
| GET | `/community/my-unlocks` | Bearer | Every video ID the caller has unlocked — call on app launch. |
| POST | `/community/videos/:videoId/interact` | Bearer | Log one analytics event: `SUBSCRIBE_INTENT`, `PREVIEW_CLIP`, `WATCH_FULL_VIDEO`, `UNLOCK`. |
| POST | `/community/videos/:videoId/unlock` | Bearer | Unlock full access (idempotent). Call when the user returns from YouTube. |
| GET | `/community/videos/:videoId/analytics` | Admin | Interaction counts + conversion rate. |
| POST | `/community/admin/videos` | Admin | Create a video card. |
| PUT | `/community/admin/videos/:videoId` | Admin | Update title, description, URLs, `isPublished`. |
| DELETE | `/community/admin/videos/:videoId` | Admin | Soft-delete (sets `isPublished = false`). |

### GET /community/videos

Paginated list of published cards. Each card includes the caller's unlock state
so the client can render the correct button color/behavior without extra calls.

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "title": "Two-line bold title",
      "description": "One-sentence value proposition for the full discussion.",
      "teaserUrl": "https://cdn.../teaser.mp4",
      "thumbnailUrl": "https://img.youtube.com/vi/<videoId>/hqdefault.jpg",
      "youtubeVideoId": "dQw4w9WgXcQ",
      "isUnlocked": false,
      "unlockedAt": null,
      "publishedAt": "2026-10-01T00:00:00.000Z"
    }
  ],
  "pagination": { "total": 12, "page": 1, "limit": 20, "totalPages": 1 }
}
```

### GET /community/my-unlocks

Rehydrates local `isSubscribed`/unlock state on app launch (avoid per-card
lookups). Falls back to `[]` for a user with no unlocks.

```json
{
  "success": true,
  "data": {
    "unlocks": [{ "videoId": "uuid", "unlockedAt": "2026-10-01T00:00:00.000Z" }]
  }
}
```

### POST /community/videos/:videoId/interact

Append-only analytics event. Safe to fire for every user action (client-side
fire-and-forget). `action` must be one of:

- `SUBSCRIBE_INTENT` — user tapped "Subscribe to Unlock"
- `PREVIEW_CLIP` — user opened the teaser modal
- `WATCH_FULL_VIDEO` — user tapped the unlocked "Watch on YouTube" button
- `UNLOCK` — user returned from YouTube and unlocked full access

```json
{ "action": "SUBSCRIBE_INTENT" }
```

`400` for an unknown action; `404` if the video doesn't exist.

### POST /community/videos/:videoId/unlock

Marks the video as unlocked for the caller. Idempotent (`@@unique([userId, videoId])`
with an upsert) — call it every time the user returns from YouTube; it is a no-op
if already unlocked. Recommended flow: client calls `unlock`, then refreshes with
`GET /community/videos` (or updates local state from the response).

```json
{ "success": true, "data": { "isUnlocked": true, "unlockedAt": "2026-10-01T00:00:00.000Z" }, "message": "Video unlocked" }
```

### GET /community/videos/:videoId/analytics (Admin)

Funnel metrics for one card. Conversion rate = `totalUnlocks / SUBSCRIBE_INTENT`
(0 when no intents yet).

```json
{
  "success": true,
  "data": {
    "videoId": "uuid",
    "title": "Two-line bold title",
    "youtubeVideoId": "dQw4w9WgXcQ",
    "interactions": { "SUBSCRIBE_INTENT": 40, "PREVIEW_CLIP": 300, "WATCH_FULL_VIDEO": 22, "UNLOCK": 18 },
    "totalUnlocks": 18,
    "conversionRate": 0.45
  }
}
```

### POST /community/admin/videos (Admin)

```json
{
  "title": "Two-line bold title",
  "description": "One-sentence value proposition.",
  "teaserUrl": "https://cdn.../teaser.mp4",
  "thumbnailUrl": "https://img.youtube.com/vi/<videoId>/hqdefault.jpg",
  "youtubeVideoId": "dQw4w9WgXcQ",
  "isPublished": true
}
```

`409` if a card with that `youtubeVideoId` already exists.

### PUT /community/admin/videos/:videoId (Admin)

Accepts any subset of `title`, `description`, `teaserUrl`, `thumbnailUrl`, `isPublished`.

### DELETE /community/admin/videos/:videoId (Admin)

Soft-delete — sets `isPublished = false`. The card and its analytics/ unlock
rows are preserved.

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
| GET | `/dating/recommendations` | Bearer | Ranked candidates (excludes passed/blocked/hidden; likes stay in the queue). KYC-gated; `?tourRequestId=<uuid>` restricts to a tour's geofence + schedule window. |
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

> **Opposite-gender discovery (legal compliance):** `GET /dating/recommendations`
> is **always** filtered to the opposite of the viewer's own gender — MALE
> viewers see only FEMALE profiles, FEMALE viewers see only MALE profiles. This
> is enforced in the matching engine and overrides any `genderPreference` saved
> via `PUT /dating/preferences`. `OTHER`-gender viewers get an empty queue.

---

## Devices

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| POST | `/devices/register` | Bearer | Register or update a device for push notifications. |
| DELETE | `/devices/:deviceId` | Bearer | Unregister a device (own device only). |
| GET | `/devices/notifications/preferences` | Bearer | Get the user's notification preferences. |
| PATCH | `/devices/notifications/preferences` | Bearer | Update the user's notification preferences. |

### POST /devices/register

Upserts on `(userId, deviceId)` — the owner comes from the authenticated access
token, never from the body. Tokens rotate, so every registration replaces the
old token values and sets `enabled = true` and `lastSeenAt = now()`.

```json
{
  "deviceId": "installation-uuid",
  "platform": "ANDROID",
  "expoPushToken": "ExponentPushToken[...]",
  "fcmToken": "native-fcm-token",
  "apnsToken": null,
  "voipPushToken": null
}
```

`200` → the registered device.

### DELETE /devices/:deviceId

Only the authenticated owner can disable/delete their own installation. `404` if
the `(userId, deviceId)` pair doesn't exist. Logout should call this; the server
also disables every device on `POST /auth/logout` and auto-disables tokens that a
push provider later rejects.

### GET /devices/notifications/preferences

```json
{ "success": true, "data": { "messagesEnabled": true } }
```

### PATCH /devices/notifications/preferences

```json
{ "messagesEnabled": false }
```

`messagesEnabled: false` opts the user out of all chat message push
notifications (`NEW_MESSAGE`). `200` → `{ success, data: { messagesEnabled } }`.

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

**Responses:** the message is saved, the conversation's last-message fields are
updated, and the recipient's push notification is scheduled — all in one database
transaction. `201` returns the created message plus a non-blocking notification
state:

```json
{
  "success": true,
  "data": {
    "id": "message-uuid",
    "conversationId": "conversation-uuid",
    "senderId": "sender-uuid",
    "receiverId": "recipient-uuid",
    "type": "TEXT",
    "content": "Hi there",
    "createdAt": "2026-09-02T12:00:00.000Z",
    "notification": { "status": "QUEUED" }
  }
}
```

A push provider outage never rolls back the saved message — the delivery outbox
record is stored and retried by a background worker. The same applies to
`POST /messages/voice-note`.

### Message push notifications

Sending a message triggers a durable `NEW_MESSAGE` push to every enabled device
of the **recipient** (the sender's devices are never targeted). The provider is
chosen per device: native FCM on Android, otherwise the Expo token. A visible
notification plus a `data` payload is sent so it displays even when the app is
terminated:

```json
{
  "type": "NEW_MESSAGE",
  "messageId": "message-uuid",
  "conversationId": "conversation-uuid",
  "senderId": "sender-uuid",
  "senderName": "Simply Mark",
  "senderAvatarUrl": "https://example.com/public-profile-image.jpg",
  "senderImageUrl": "https://example.com/public-profile-image.jpg",
  "messageType": "TEXT",
  "route": "/(connect)/chat/[id]",
  "schemaVersion": "1"
}
```

The visible body is built server-side per type: `TEXT` (sanitized, whitespace
collapsed, truncated ~120 chars, markup stripped), `Sent a voice message`,
`Sent a photo`, `Sent a video`, or `New message`. Android uses a dedicated
`messages` channel (default sound). Deliveries retry transient failures with
bounded exponential backoff (max 5 attempts), fetch Expo receipts to confirm
delivery, and auto-disable + clear tokens the provider rejects
(`DeviceNotRegistered`). Recipients can disable messages pushes via
`PATCH /devices/notifications/preferences`.

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
