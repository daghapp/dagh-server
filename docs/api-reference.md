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
| POST | `/auth/refresh-token` | Public | Exchange a refresh token for a new access token + the signed-in user (same shape as login). |
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

Returns `data: { id, email, fullName, accountType, ethnicity, accessToken, refreshToken }`.
`403` if the email is not yet verified.

`ethnicity` is `null` until the user chooses one — the column is nullable and
nothing in the auth flow requires it, so treat `null` as "not answered yet"
rather than invalid.

### POST /auth/refresh-token

```json
{ "refreshToken": "..." }
```

Returns `data: { id, email, fullName, accountType, ethnicity, accessToken }` — the
**same user shape as `POST /auth/login`**, minus `refreshToken` (the caller
already holds it; the token is not rotated).

This matters more than it looks. Clients call this whenever the access token
expires mid-session, so it is the response most often used to rebuild in-memory
session state. It used to return the access token alone, which meant a client
rehydrating from it lost every profile field the login response had supplied —
most visibly `ethnicity`, which then read as unset and re-prompted the user on
every resume. **Clients should treat login and refresh as the same payload and
keep one session handler for both.**

`401` if the refresh token is missing, invalid, expired, or no longer in the
device store; `403` if the account is no longer active; `404` if the user is gone.

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

Gated video cards that drive app members to the YouTube channel. A clipped
preview is freely viewable; full-length playback is unlocked per user once the
server confirms a subscription to the channel. Locked cards withhold the
YouTube video id and the full watch URL, so the link cannot be scraped from the
feed, and every card carries server-resolved `channel` subscribe links so the
app never hardcodes the channel. Every action is logged server-side as an
analytics event so you can measure the funnel (card view → subscribe intent →
unlock).

| Method | Endpoint | Auth | What it does |
|--------|----------|------|--------------|
| GET | `/community/videos` | Bearer | List published cards (`?page=&limit=`), gated as a page by the single decision in `meta.access`. Apply it to every card; never re-decide per card. |
| GET | `/community/videos/:videoId` | Bearer | Single card plus the same `access` snapshot every other surface returns. |
| GET | `/community/my-unlocks` | Bearer | The current `access` decision plus per-video unlock history (analytics only) — call on app launch. |
| POST | `/community/videos/:videoId/interact` | Bearer | Log one analytics event: `PREVIEW_CLIP`, `WATCH_FULL_VIDEO`, `UNLOCK`. `SUBSCRIBE_INTENT` is still accepted for older clients, but new clients should use [`/subscribe-intent`](#post-communityvideovidsubscribe-intent) — which logs it as a side effect — and not send it here, or the conversion-rate denominator is double-counted. |
| POST | `/community/videos/:videoId/subscribe-intent` | Bearer | The locked card's subscribe button, in one call: logs `SUBSCRIBE_INTENT` and returns `{ videoId, authUrl, channel }`. |
| POST | `/community/videos/:videoId/unlock` | Bearer | Confirm and report the decision; grants nothing by itself. `403 SUBSCRIPTION_REQUIRED` with a `reason` when there is no positive verdict. |
| GET | `/community/youtube/start/:videoId` | Bearer | Begin OAuth verification; returns `{ authUrl, expiresIn, channel }`. Superseded by `subscribe-intent` for the tap — kept for re-running the flow without recording a new intent. |
| GET | `/community/youtube/callback` | Public | Google redirect target: checks the subscription, stores the verdict with a lease, redirects to the app deep link. |
| GET | `/community/youtube/status/:videoId` | Bearer | The current `access` decision, re-checking if the lease has lapsed. |
| GET | `/community/videos/:videoId/analytics` | Admin | Interaction counts + conversion rate, plus the YouTube counters the feed sorts use. |
| POST | `/community/admin/videos` | Admin | Create a video card. |
| PUT | `/community/admin/videos/:videoId` | Admin | Update title, description, URLs, preview bounds, `isPublished`. |
| DELETE | `/community/admin/videos/:videoId` | Admin | Soft-delete (sets `isPublished = false`). |
| POST | `/community/admin/sync-youtube` | Admin | Pull the channel's latest uploads from the YouTube Data API, add missing cards, and refresh the view/like counters on existing ones. |
| GET | `/community/admin/youtube-grants` | Admin | List channel grants with a table-wide health summary. Never returns a refresh token. |
| POST | `/community/admin/youtube-grants/:userId/revoke` | Admin | Close a grant without consulting YouTube (reason `MANUAL`). |
| POST | `/community/admin/youtube-grants/re-encrypt` | Admin | Re-seal any refresh token still stored in the clear. Idempotent. |

### POST /community/admin/sync-youtube (Admin)

Auto-populates the feed from the configured YouTube channel. Resolves the channel
via `YOUTUBE_CHANNEL_ID` or `YOUTUBE_CHANNEL_HANDLE` (e.g. `@diasporaaffairsgh`),
or an explicit `channelId` / `handle` in the request body, then fetches the latest
uploads from the channel's uploads playlist.

Only **new** uploads are inserted. On an existing card the sync rewrites the
YouTube view/like counters and nothing else, so admin edits to
title/description and soft-deletes (`isPublished = false`) survive a sync while
the engagement rankings still move. Teasers are derived from the video's own
embed URL bounded to the first 30 seconds (`?start=0&end=30&rel=0`), so a freshly
synced card can only serve a preview until the viewer subscribes. The
full-length URL is never stored.

`playlistItems` cannot return view/like counts, so the counters come from one
extra `videos?part=statistics` call covering the whole batch (1 quota point).
That call is allowed to fail: the uploads are still synced, just carrying their
previous counts, because losing the ranking signal should not cost us the upload
list we already paid for.

Repeated syncs for the same channel are returned from a Redis-backed cooldown
cache (`YOUTUBE_SYNC_COOLDOWN_MS`, default 1 hour) instead of re-hitting the
YouTube API, protecting quota. The cooldown is consulted after the channel id is
resolved and before the uploads are fetched, so a sync inside the window spends
no quota at all. The cooldown is Redis-backed only — without `REDIS_URL` there is
none, and every call reaches YouTube.

Body (all optional):

```json
{
  "channelId": "UC...",
  "handle": "@diasporaaffairsgh",
  "maxResults": 6
}
```

Response:

```json
{
  "success": true,
  "data": {
    "channelId": "UC...",
    "fetched": 6,
    "created": 4,
    "updated": 2,
    "alreadyPresent": 2,
    "syncedAt": "2026-10-01T00:00:00.000Z",
    "cached": false
  }
}
```

`updated` counts existing cards whose counters were refreshed; `alreadyPresent` is
a deprecated alias of it, kept so older clients keep parsing.

`503` if `YOUTUBE_API_KEY` is not configured; `502` if the YouTube API call fails.

### GET /community/videos

Paginated list of published cards. Each card includes the caller's unlock state
so the client can render the correct button color/behavior without extra calls.
`videoId` is an alias of `id` — both are stable identifiers you can use as the
`:videoId` path/query param on the other endpoints. `:videoId` also accepts the
YouTube video id directly (`youtubeVideoId`).

**Query params**

| Param | Values | Default | Notes |
|-------|--------|---------|-------|
| `page` | integer ≥ 1 | `1` | |
| `limit` | 1–50 | `20` | |
| `sort` | `newest`, `most_watched`, `most_liked` | `newest` | Case-insensitive. An unrecognised value falls back to `newest` rather than erroring; the order actually applied is echoed in `meta.sort` |

A **locked** card:

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "videoId": "uuid",
      "title": "Two-line bold title",
      "description": "One-sentence value proposition for the full discussion.",
      "teaserUrl": "https://www.youtube.com/embed/dQw4w9WgXcQ?start=0&end=30&rel=0",
      "previewStartSeconds": 0,
      "previewDurationSeconds": 30,
      "thumbnailUrl": "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      "viewCount": 12480,
      "likeCount": 932,
      "isUnlocked": false,
      "requiresSubscription": true,
      "unlockedAt": null,
      "channel": {
        "channelId": "UC...",
        "handle": "@diasporaaffairsgh",
        "subscribeUrl": "https://www.youtube.com/@diasporaaffairsgh",
        "appUrl": "vnd.youtube://channel/UC..."
      },
      "publishedAt": "2026-10-01T00:00:00.000Z"
    }
  ],
  "pagination": { "total": 12, "page": 1, "limit": 20, "totalPages": 1 },
  "meta": { "hasChannelAccess": false, "channelAccess": null, "sort": "NEWEST" }
}
```

An **unlocked** card additionally carries `youtubeVideoId`, `watchUrl`, `watchAppUrl` and `watchWebUrl`:

```json
{
  "isUnlocked": true,
  "requiresSubscription": false,
  "unlockedAt": "2026-10-01T00:00:00.000Z",
  "youtubeVideoId": "dQw4w9WgXcQ",
  "watchUrl": "https://www.youtube.com/embed/dQw4w9WgXcQ",
  "watchAppUrl": "vnd.youtube://watch?v=dQw4w9WgXcQ",
  "watchWebUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
```

All four are **absent** (not `null`) while locked — the server withholds them
rather than gating only playback, because the full link is just a string any
client could read. `watchAppUrl` and `watchWebUrl` are the same link in two
shapes, so sending one while withholding the other would gate nothing. All are
derived from `youtubeVideoId` on demand and never stored.

Use `watchAppUrl` for the "Watch Full Video on YouTube" call-to-action and fall
back to `watchWebUrl` when the deep link cannot be opened (no YouTube app
installed). Do not assemble either from `youtubeVideoId` — the same rule as
`channel` below. `watchUrl` is the *embed* address for the full video, for an
in-app web player; it is not a YouTube-app or mobile-site destination.

Non-nullable string fields (`title`, `description`, `thumbnailUrl`, `teaserUrl`)
are never `null` in the DB (defaulting to `"Untitled"` / `""` and derived YouTube
URLs respectively), so the client does not need null-guards on them. `unlockedAt`
is the only nullable field (`null` until unlocked). Timestamps serialize as ISO-8601 strings.

#### `sort` — ranking the feed by engagement

`?sort=most_watched` and `?sort=most_liked` reorder the feed by YouTube's public
view and like counts, which lets the app offer "Most Liked" / "Most Watched" tabs
alongside the default chronological feed.

| Sort | Ordering |
|------|----------|
| `newest` (default) | `publishedAt` desc |
| `most_watched` | `viewCount` desc, then `publishedAt` desc |
| `most_liked` | `likeCount` desc, then `publishedAt` desc |

The counts come from the channel sync (`POST /community/admin/sync-youtube`), not
from this server's own interaction log — those rows only see activity inside this
app, so they cannot report what happened on the channel. They are refreshed each
sync run, so a long-standing popular video can legitimately outrank a newer one,
and a video that goes viral climbs the ranking over time rather than staying
where it was first published.

Every ordering ends in the same deterministic tie-break chain, so paging through
a sorted feed (`?sort=most_liked&page=2`) cannot repeat or drop a card the way an
unordered tie would.

`viewCount` / `likeCount` ride on **every** card, locked included — they describe
the video rather than granting access to it, so there is no reason to withhold
them. Read them straight off the response to label a tab; no extra request needed.
A `0` means either genuinely unwatched or never synced, so treat it as "no signal
yet" rather than "nobody watched this".

`meta.sort` echoes the applied order in upper case (`NEWEST`, `MOST_WATCHED`,
`MOST_LIKED`) so a client can confirm what the server did with its request.

#### `meta.hasChannelAccess` — the feed-level unlock flag

A YouTube subscription is to the **channel**, not to an individual video, so one
successful verification unlocks the whole feed — including videos published
later. `meta` describes the page as a whole; the per-card `isUnlocked` is still
present and authoritative, so a client can render from the cards alone.

```json
{
  "success": true,
  "data": [ /* …cards… */ ],
  "pagination": { "total": 12, "page": 1, "limit": 20, "totalPages": 1 },
  "meta": {
    "hasChannelAccess": true,
    "channelAccess": {
      "channelId": "UC...",
      "unlockedAt": "2026-10-01T00:00:00.000Z",
      "verifiedAt": "2026-10-01T00:00:00.000Z"
    }
  }
}
```

`hasChannelAccess` is `true` when the caller holds a durable channel grant, and
`channelAccess` is `null` otherwise. Use it to hide every "Subscribe to Unlock Preview"
call to action at once instead of deriving the state card by card — otherwise a
subscriber sees subscribe prompts on cards the server has already opened.
`verifiedAt` is when the subscription was last confirmed. YouTube publishes no
event for an unsubscribe, so the grant is re-checked two ways (see
[YouTube channel unlocks](youtube-video-feed-setup.md#locking-on-read--why-the-sweep-is-not-the-whole-answer)):

- **On read.** The first feed / card / `my-unlocks` / `status` / `unlock` call
  after the lease lapses (`COMMUNITY_ACCESS_LEASE_SECONDS`, default 60s)
  re-checks live, and *that response* is already correct. A subscriber who
  cancelled is locked within a lease's worth of their next read.
- **Login.** A session boundary forces a check even when the lease is still live,
  so signing in never presents yesterday's verdict.
- **Nightly sweep.** Catches the accounts the read path never sees, bounded by
  `COMMUNITY_REVERIFY_BUDGET_MS` per pass rather than by a fixed interval.

So the state is current for anyone using the app and up to a day stale for anyone
who has not opened it recently — and permanently stale for a grant with no usable
refresh token, which is never re-checkable and shows up in the admin listing as
`unverifiable`. Treat `hasChannelAccess` as current-enough for UI, not as a
guarantee.

#### `channel` — where to send the user to subscribe

Present on every card (identical each time, so a card stays self-contained for
the app's per-card action bar) and on the single-card response. Resolved
server-side from `YOUTUBE_CHANNEL_ID` / `YOUTUBE_CHANNEL_HANDLE` — **do not
hardcode the channel in the app**, or changing the env silently leaves the
client's subscribe button pointing at a different channel than the one the
server verifies against, and users get told they are not subscribed after
subscribing.

| Field | Notes |
|-------|-------|
| `channelId` | Stable `UC…` id, or `null` |
| `handle` | Normalised to include the leading `@`, or `null` |
| `subscribeUrl` | Web URL for the channel page. Prefers the handle (survives the channel being recreated under a new id), falls back to `/channel/UC…` |
| `appUrl` | `vnd.youtube://channel/UC…` for the native app. **`null` when only a handle is configured** — the scheme has no handle form, so fall back to `subscribeUrl` |

All four are `null` when neither env var is set, so the app should degrade
gracefully rather than assume a link exists.

Two things these links deliberately do **not** do: they open the channel page but
do not complete the subscription (YouTube exposes no link that subscribes on the
user's behalf — the user still taps Subscribe), and they are resolved from env
without an API call, so a handle-only setup costs nothing per feed load.

#### `watchAppUrl` / `watchWebUrl` — where to send an unlocked viewer

Present only on unlocked cards, and the destination for the end-of-preview
"Watch Full Video on YouTube" call-to-action. Resolved server-side for the same
reason as `channel`: the app should not be assembling YouTube URL schemes itself.

| Field | Notes |
|-------|-------|
| `watchAppUrl` | `vnd.youtube://watch?v=<id>` deep link — opens the native app on the full video |
| `watchWebUrl` | `https://www.youtube.com/watch?v=<id>` — fallback for a device with no YouTube app |

Both are always present together and never `null` on an unlocked card. Open
`watchAppUrl`, and fall back to `watchWebUrl` when the deep link cannot be
opened — on some platforms a `vnd.youtube://` URL aimed at a missing app fails
silently rather than erroring.

`watchUrl` is a third, separate field: the *embed* address
(`https://www.youtube.com/embed/<id>`), for an in-app web player. It is not a
substitute for either link above.

The full client-side contract for the end-of-preview overlay — trigger, copy,
per-state behaviour and the analytics to log — is in
[App integration](youtube-video-feed-setup.md#2-preview-modal--the-teaser-then-the-end-of-preview-cta-overlay).

### GET /community/my-unlocks

Rehydrates local `isSubscribed`/unlock state on app launch (avoid per-card
lookups). Returns the durable channel grant alongside the per-video rows.

```json
{
  "success": true,
  "data": {
    "hasChannelAccess": true,
    "channelAccess": {
      "channelId": "UC...",
      "unlockedAt": "2026-10-01T00:00:00.000Z",
      "verifiedAt": "2026-10-01T00:00:00.000Z"
    },
    "unlocks": [{ "videoId": "uuid", "unlockedAt": "2026-10-01T00:00:00.000Z" }]
  }
}
```

`channelAccess` is `null` and `hasChannelAccess` is `false` for a user with no
grant; `unlocks` is then `[]` for a user who has never unlocked anything.

`unlocks` is deliberately **not** expanded to every video id when a channel
grant exists. A subscriber has access to the whole feed, so materialising one row
per video would grow without bound as the channel keeps publishing, and the app
only needs to know "this user has everything". Branch on `hasChannelAccess` and
treat the feed as fully unlocked; otherwise use `unlocks`.

### POST /community/videos/:videoId/interact

Append-only analytics event. Safe to fire for every user action (client-side
fire-and-forget). `action` must be one of:

- `SUBSCRIBE_INTENT` — user tapped "Subscribe to Unlock Preview" (logged by the client,
  before the OAuth round-trip)
- `PREVIEW_CLIP` — user played the clipped preview on a locked card
- `WATCH_FULL_VIDEO` — user opened the full video (unlocked users only)
- `UNLOCK` — server confirmed a subscription and granted the unlock

```json
{ "action": "SUBSCRIBE_INTENT", "durationMs": 18400 }
```

`durationMs` is optional — client-reported watch time in milliseconds (e.g. how far
the user got into the preview clip before leaving it or tapping subscribe).
It must be a non-negative integer. It is **client-reported and unverified** —
YouTube exposes no per-user watch API, so treat it as a hint, not evidence.

`400` for an unknown action or an invalid `durationMs`; `404` if the video doesn't exist.

### POST /community/videos/:videoId/subscribe-intent

The locked card's **"Subscribe to Unlock Preview"** button, in one round-trip. Records
the `SUBSCRIBE_INTENT` event and returns the Google authorization URL plus the
channel subscribe links.

```json
{
  "success": true,
  "data": {
    "videoId": "uuid",
    "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?...",
    "channel": {
      "channelId": "UC...",
      "handle": "@diasporaaffairsgh",
      "subscribeUrl": "https://www.youtube.com/@diasporaaffairsgh",
      "appUrl": "vnd.youtube://channel/UC..."
    }
  }
}
```

`videoId` in the response is the canonical internal card id, even when the
request passed a YouTube video id.

| Field | Notes |
|-------|-------|
| `authUrl` | Open in a browser to let the user grant read-only YouTube access. **`null`** when `YOUTUBE_OAUTH_CLIENT_ID` / `YOUTUBE_OAUTH_CLIENT_SECRET` are unset |
| `channel` | Same object as on every feed card. Send the user to `appUrl` (falling back to `subscribeUrl`) so they can subscribe |

**`authUrl` is null, not a 503.** `GET /community/youtube/start/:videoId` returns
`503` without OAuth because the authorization URL is the only thing it produces.
This endpoint also carries the funnel event and the subscribe links, and both
remain useful without OAuth — so when `authUrl` is `null`, send the user to
`channel.appUrl` to subscribe and then call
`POST /community/videos/:videoId/unlock` directly. That client-trusted unlock path
only exists when OAuth is unconfigured; with OAuth configured it returns
`403 SUBSCRIPTION_REQUIRED`.

#### Why this endpoint exists

The tap used to be two calls the app had to keep in step — `POST /interact` with
`SUBSCRIBE_INTENT`, then `GET /youtube/start/:videoId`. Nothing forced the app to
make both, and the analytics half was the one that got dropped.

That failure is invisible. A missing `SUBSCRIBE_INTENT` shrinks the denominator
that `conversionRate` is computed against (`totalUnlocks / SUBSCRIBE_INTENT`), so
the funnel reports a *better* number than it earned — the metric that exists to
tell you whether the gate is working is the one most likely to be quietly wrong.
Folding the event into the endpoint the app already has to call makes it
un-skippable.

The intent is written before the OAuth URL is built, and is not conditional on
it: the tap is the event being measured, and it happened whether or not the
server can go on to verify anything. A funnel that only counts taps we could
verify is not a funnel.

`GET /community/youtube/start/:videoId` still exists and still works — use it to
re-run the flow without recording a new intent (e.g. a retry after a cancelled
consent screen, which should not inflate the tap count).

### POST /community/videos/:videoId/unlock

Confirms and reports the decision. It does **not** grant anything: a tap is not
evidence, so there is no request body or flag that can open a video. The
subscription is channel-scoped, so a positive verdict opens the whole feed and
this endpoint is the cheapest place to learn that.

Because it consults the same decision a read would, a normal tap inside a live
lease costs no quota; a lapsed one re-checks Google.

```json
{
  "success": true,
  "data": {
    "isUnlocked": true,
    "unlockedAt": "2026-10-01T00:00:00.000Z",
    "hasChannelAccess": true,
    "access": { "...": "the same ChannelAccess snapshot every other endpoint returns" }
  },
  "message": "Video unlocked"
}
```

`isUnlocked` / `unlockedAt` are analytics — which card this user converted on.
They are **not** the gate. Branch on `hasChannelAccess` / `access`; a non-empty
unlock history does not mean the feed is open, and an `isUnlocked: true` from an
older response must not reopen a feed the server has since closed.

There is no `channelGranted` field. It existed only to distinguish "this call
granted the channel" from "the channel was already granted", which is no longer a
distinction any client needs — `access` says what is true now.

Errors:

- `404 VIDEO_NOT_FOUND` — no published card for that id.
- `403 SUBSCRIPTION_REQUIRED` — no positive, unexpired verdict on record:

```json
{
  "success": false,
  "data": {
    "code": "SUBSCRIPTION_REQUIRED",
    "message": "Subscribe to the channel to unlock this video",
    "verifiedAt": null
  }
}
```

A lapsed lease or an absent verdict resolves to **no access**, so the gate fails
closed — and it says so in `reason`, so the app can tell "resubscribe" apart from
"we could not check" rather than showing the same dead end for both. Re-run
`GET /community/youtube/start/:videoId` rather than retrying the unlock.

This endpoint confirms and reports the decision; it never creates one. A tap
alone grants nothing, and a `VideoUnlock` row is analytics rather than a grant.

### Subscription verification (the gate's key issuer)

The gate rests on `GET /community/youtube/start/:videoId` → Google consent →
`GET /community/youtube/callback`, which checks
`subscriptions?mine=true&forChannelId=<channel>` and stores the verdict against
the user with a lease (`COMMUNITY_ACCESS_LEASE_SECONDS`, default 60s). Costs 1
quota unit per check.

Only a definite negative is treated as one. A timeout, a `429` or a `5xx` is
transient and never becomes an unsubscribe — that is what stops a Google outage
from locking out paying subscribers. Failures are cached only as *failures*, and
only for `COMMUNITY_ACTIVE_RECHECK_SECONDS`, so they do not cost a token request
per read.

The callback redirects to the app deep link with
`?subscribed=&videoId=&unlocked=&channelGranted=&hasChannelAccess=`. On success
`channelGranted=true` and `hasChannelAccess=true`, which is the app's signal that
the **whole feed** is now open — not just the card that was tapped. A subscriber
who taps unlock on a later video hits the grant immediately, with no second
round-trip.

Two things it is worth being explicit about:

- It proves an **explicit subscription on the authorized Google account** — the
  only thing YouTube exposes. It cannot verify a watch, and it is blind to a
  subscription made on a different account.
- It is **not** content protection. The video is public on YouTube, so this gates
  a link inside our app, not the content itself.

When `YOUTUBE_OAUTH_CLIENT_ID` / `YOUTUBE_OAUTH_CLIENT_SECRET` are unset there is
no way to verify anything, so every check resolves to **no access** and the feed
stays locked. The server fails closed: it will never grant on a client claim. The
cost of misconfiguration is a locked product, not an open one, but it does mean
the community section is unusable until these are set — configure them before
launch. The server also logs a loud banner at boot when they are missing in
production.

### Cross-origin / network notes

- **Native mobile requests** (no `Origin` header) are always allowed — CORS only
  applies to browsers/webviews.
- **Web views / web clients** must have their origin in the `ALLOWED_ORIGINS`
  env var (`server.ts`). Requests with an unknown origin get `403`
  `Origin not allowed by CORS`. Add e.g. `http://localhost:3000` (comma-separated).
- The API never proxies thumbnails or video assets — cards point straight at
  `i.ytimg.com` / `youtube.com`, which are loaded client-side and are not subject
  to the API's CORS policy.

### Persisted state (unlock / engagement)

Per-user unlock state and analytics live in dedicated tables (see `community_videos`,
`video_unlocks`, `video_interactions` in the schema):

- `VideoUnlock(userId, videoId, unlockedAt)` — one row per user+video
  (`@@unique([userId, videoId])`), written idempotently by `POST .../unlock` once
  the gate passes. Read back via `GET /community/my-unlocks` or the
  `isUnlocked`/`unlockedAt` fields on the feed.
- `VideoInteraction(userId, videoId, action, durationMs, createdAt)` — append-only
  event log written by `POST .../interact` and the OAuth callback, aggregated by
  the admin analytics endpoint.

No client-side state migration is needed; the app rehydrates from
`GET /community/my-unlocks` on launch.

### Server logging

Every feed endpoint emits a single structured JSON line (event prefixed
`community.*`) with `timestamp`, `status`, `userId`, `videoId`, and `durationMs`.
Happy paths log at `info`, expected client errors (404/400) at `warn`, and
server failures (500) at `error`, so feed breakage is greppable, e.g.:

```
{"timestamp":"2026-10-01T00:00:00.000Z","event":"community.feed.get.not_found","status":404,"userId":"...","videoId":"..."}
{"timestamp":"2026-10-01T00:00:00.000Z","event":"community.feed.list.error","status":500,"userId":"...","error":"...","durationMs":12}
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
    "youtube": {
      "viewCount": 12480,
      "likeCount": 932,
      "statsSyncedAt": "2026-10-01T00:00:00.000Z"
    },
    "conversionRate": 0.45,
    "totalWatchTimeMs": 5420000,
    "avgWatchTimeMs": 28942
  }
}
```

`totalWatchTimeMs` / `avgWatchTimeMs` aggregate the client-reported `durationMs`
(milliseconds) across interactions; they are `null` until clients start sending
`durationMs` with `POST /community/videos/:videoId/interact`.

`youtube` reports the channel-wide counters the feed's `most_watched` /
`most_liked` sorts are built on. They are deliberately kept apart from
`interactions`: the latter only covers activity inside this app, so a high
`likeCount` alongside a low `PREVIEW_CLIP` count says the audience already cares
about a video the feed is not surfacing. `statsSyncedAt` is `null` when the card
predates the counters or the last sync could not read them, which distinguishes a
stale ranking from a genuinely unwatched video.

### POST /community/admin/videos (Admin)

```json
{
  "title": "Two-line bold title",
  "description": "One-sentence value proposition.",
  "teaserUrl": "https://www.youtube.com/embed/dQw4w9WgXcQ?start=0&end=30&rel=0",
  "thumbnailUrl": "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  "youtubeVideoId": "dQw4w9WgXcQ",
  "previewStartSeconds": 0,
  "previewDurationSeconds": 30,
  "isPublished": true,
  "viewCount": 0,
  "likeCount": 0
}
```

`teaserUrl` must be a **clipped** preview, not the full-length video URL —
storing the full URL there defeats the gate for every locked viewer.
`previewStartSeconds` (default 0) and `previewDurationSeconds` (default 45) bound
the clip.

`viewCount` / `likeCount` are optional (default 0) and only worth setting for a
hand-made card that would otherwise sit at the bottom of the engagement-sorted
feeds until the next channel sync sees it. Any later sync overwrites both.

`409` if a card with that `youtubeVideoId` already exists.

### PUT /community/admin/videos/:videoId (Admin)

Accepts any subset of `title`, `description`, `teaserUrl`, `thumbnailUrl`,
`previewStartSeconds`, `previewDurationSeconds`, `isPublished`.

### DELETE /community/admin/videos/:videoId (Admin)

Soft-delete — sets `isPublished = false`. The card and its analytics/ unlock
rows are preserved.

### GET /community/admin/youtube-grants (Admin)

The grant table is otherwise unreachable: the only reads on it are the per-user
lookups behind the feed gate, and the only writer besides the OAuth callback is
the nightly sweep. Use this to answer "does this account still have feed access,
and can we still prove it?" without going to the database.

Query: `status` (`active` default / `revoked` / `all`), `page`, `limit`
(default 25, max 100), `q` (case-insensitive match on the user's email or name).

```json
{
  "success": true,
  "data": [
    {
      "id": "…",
      "userId": "…",
      "user": { "id": "…", "email": "…", "fullName": "…" },
      "channelId": "UC…",
      "unlockedAt": "2026-09-01T00:00:00.000Z",
      "verifiedAt": "2026-09-01T00:00:00.000Z",
      "lastVerifiedAt": "2026-09-20T03:17:00.000Z",
      "revokedAt": null,
      "revokedReason": null,
      "hasRefreshToken": true,
      "tokenEncrypted": true,
      "unverifiable": false,
      "dueForReverify": false
    }
  ],
  "pagination": { "total": 1, "page": 1, "limit": 25, "totalPages": 1 },
  "meta": {
    "summary": {
      "active": 1,
      "revoked": 0,
      "unverifiable": 0,
      "unencrypted": 0,
      "due": 0
    }
  }
}
```

- **Refresh tokens are never returned.** `hasRefreshToken` and `tokenEncrypted`
  report only whether a credential is present and sealed.
- `unverifiable` — the grant works but can no longer be re-checked, so an
  unsubscribe would not be caught. Either no credential was ever stored, or the
  stored one cannot be decrypted (e.g. the encryption key was rotated). The user
  re-running the OAuth flow repairs it.
- `unencrypted` — active grants still holding a **plaintext** refresh token. This
  should be `0`; anything else means a grant was written before sealing landed
  and has not been re-checked since. Run
  `POST /community/admin/youtube-grants/re-encrypt` to clear it.
- `due` — active grants past its lease and waiting
  for the next sweep. Persistently non-zero means the subscriber base has
  outgrown one pass; check the sweep log for "Ran out of budget".
- The `summary` counts are table-wide, not page-scoped.

### POST /community/admin/youtube-grants/:userId/revoke (Admin)

Closes the user's active grant with reason `MANUAL` and deletes their per-video
unlock rows, without consulting YouTube. This is the escape hatch for a support
request, a refund, or an account that must not keep feed access while its
subscription check is stuck. `404` when the user has no active grant.

Recoverable — if the user re-runs the OAuth flow, the same row is revived in
place.

### POST /community/admin/youtube-grants/re-encrypt (Admin)

Re-seals any refresh token still stored in the clear, returning
`{ scanned, sealed }`. New grants are sealed on write and the sweep re-seals a row
the first time it successfully re-checks it, so this is normally a no-op. It
exists so the backfill does not need shell access to the database. Idempotent.

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
