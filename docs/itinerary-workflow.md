# Itinerary Workflow — Frontend Integration Guide

Reference for building the "plan my trip" experience against the DAGH API.
It covers the complete lifecycle: choosing tour sites, creating a tour
request, paying the facilitation fee, and reading the generated day-by-day
itinerary.

All endpoints are mounted under **`/itinerary`** on the API origin.

> **Start-region note:** `startRegion` is optional. When omitted, the server
> infers the hub from the selected sites instead of defaulting to Central. See
> [`contact-discovery-and-start-region.md`](./contact-discovery-and-start-region.md)
> for the full behaviour and migration caveats.

---

## 1. Key concepts

| Concept          | Meaning                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tour site**    | A point of interest (castle, waterfall, park). Selected by the user.                                                                        |
| **Tour request** | The user's trip brief: selected sites, `tourType`, `durationDays`, and preferences. Created once, identified by `tourRequestId`.            |
| **Itinerary**    | The generated plan attached 1-to-1 to a tour request. It is **generated lazily on first read after payment**, not at request time.          |
| **Payment**      | A Hubtel checkout that unlocks the itinerary. The gate is `tourRequest.paymentStatus === "SUCCESS"`.                                        |
| **Touring day**  | A day with site visits. `durationDays` counts **touring days only**; the final itinerary has `durationDays + 2` days (arrival + departure). |

### Critical behaviours

1. `POST /itinerary/request` **does not return an itinerary** — it returns
   `tourRequestId` and a display `price`.
2. The itinerary is created the first time `GET /itinerary/:tourRequestId`
   (or `GET /itinerary/my-itineraries`) runs **after** `paymentStatus` is
   `SUCCESS`.
3. Reading before payment returns **`403` with `error: "PAYMENT_REQUIRED"`** —
   this is the normal "please pay" signal, not a bug.
4. The generated itinerary is persisted. Subsequent reads return the same plan
   (except per-day transport selections, which are user-editable).

---

## 2. Conventions

### Authentication

Send the user's JWT on every protected call:

```http
Authorization: Bearer <token>
```

| Endpoint                                | Auth                           |
| --------------------------------------- | ------------------------------ |
| `GET /itinerary/sites`                  | Public                         |
| `GET /itinerary/sites/:siteId/mobility` | Public                         |
| `POST /itinerary/payment-callback`      | Hubtel only (server-to-server) |
| Everything else                         | Bearer                         |

### Response envelope

Successful responses use:

```json
{
  "success": true,
  "data": {},
  "message": "Human-readable message"
}
```

Errors use:

```json
{
  "success": false,
  "error": "MACHINE_CODE_OR_MESSAGE",
  "details": {}
}
```

`POST /itinerary/request` is the one exception: feasibility failures use a
legacy shape (`success`, `message`, `data`, `error`) — see §5.2.

### Values

- Timestamps are ISO-8601 strings.
- Money is in **GHS**.
- Coordinates are decimal degrees (`latitude`, `longitude`).
- Distances are kilometres (`distanceKm`, `distanceKm: null` when unknown).
- Enums are uppercase strings (`TOURING`, `HOTEL`, `SUCCESS`, …).

---

## 3. End-to-end flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. GET /itinerary/sites            (public — site picker + map)     │
│                                                                     │
│ 2. POST /itinerary/request         (Bearer)                         │
│      → 201 { tourRequestId, price }     feasible                    │
│      → 422 { error, ... }               not feasible (show error)   │
│      → 403 KYC required                 casualDatingInterest = true  │
│                                                                     │
│ 3. POST /itinerary/:tourRequestId/payment   (Bearer)                │
│      → 200 { checkoutUrl, ... }         redirect to Hubtel          │
│      → 200 { freeMode: true }           no charge, already unlocked │
│                                                                     │
│ 4. User completes checkout on Hubtel                                │
│      → Hubtel calls POST /itinerary/payment-callback (server-side)  │
│                                                                     │
│ 5. GET /itinerary/:tourRequestId      (Bearer)                      │
│      → 403 PAYMENT_REQUIRED   → keep polling / payment not settled  │
│      → 200 { itinerary, request, price }  render the plan           │
└─────────────────────────────────────────────────────────────────────┘
```

**Polling strategy:** there is no dedicated payment-status endpoint. After the
Hubtel redirect, poll `GET /itinerary/:tourRequestId` every few seconds while
it returns `403 PAYMENT_REQUIRED` (or poll `GET /itinerary/requests` and watch
`paymentStatus`). Stop on `200`; show a "payment pending" state on repeated
`403`s. Do not call `POST /payment` again — it is idempotent and returns
`alreadyPaid` once settled.

---

## 4. Step 1 — Browse tour sites

### `GET /itinerary/sites` — public

Returns every approved tour site, sorted by region then name. Use this for the
site-picker list/map.

**Response `200`:**

```json
{
  "success": true,
  "data": [
    {
      "id": "0f2f6a4e-8f2c-4d5a-9a3e-1b6c7d8e9f01",
      "name": "Kakum National Park",
      "region": "Central",
      "latitude": 5.35,
      "longitude": -1.3833,
      "description": "Rainforest canopy walkway…",
      "history": "Protected as a national park in 1992, Kakum is best known for the 350 m canopy walkway built in 1995…",
      "imageUrl": "https://cdn.example.com/kakum.jpg",
      "imageCredit": "Wikimedia Commons",
      "category": "NATURE",
      "categories": ["Adventure", "Nature"],
      "transit_profile": "PERI_URBAN",
      "createdAt": "2026-01-12T09:00:00.000Z"
    }
  ],
  "message": "Tour sites retrieved successfully."
}
```

> ⚠️ The site catalog uses Prisma field names, so the transit tier is
> **`transit_profile`** (snake_case). Inside the generated itinerary it is
> **`transitProfile`** (camelCase). Don't mix them up.

`category` is one of:
`NATURE | CULTURAL | HISTORICAL | BEACH | WILDLIFE | RELIGIOUS | SCENIC | ADVENTURE | URBAN | HERITAGE`.

`transit_profile` is one of:
`URBAN_CENTER | PERI_URBAN | RURAL` (drives which transport is suggested).

`history` and `imageCredit` (with `imageUrl`) are the destination-detail fields.
Every seeded site has a distinct `imageUrl`, so repeated photo cards are not
expected; obscure sites without a suitable licensed photo use a unique
Wikimedia Maps static location image instead of borrowing another site's photo.
`GET /tour-sites/:siteId/photos` returns the site's moderated gallery, which the
seed pre-populates with one approved photo per site.

Admins can add new catalogue rows with `POST /tour-sites/admin` (permission
`tours.edit`); they appear in `GET /itinerary/sites` immediately.

### `GET /itinerary/sites/:siteId/mobility` — public

Optional per-site call for a transport detail panel. Returns the same mobility
object embedded in the itinerary (`mobility` on each day-site).

**Query:** `transportType` (optional) — `TROTRO | UBER | RENTED_VEHICLE | NONE`.
It only affects car-rental ordering.

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "siteId": "0f2f6a4e-…",
    "transitProfile": "PERI_URBAN",
    "rideHailing": [],
    "localTransit": [
      "Trotro from Cape Coast station to Kakum junction",
      "Shared taxi from the junction to the gate"
    ],
    "intercityBus": [
      {
        "kind": "public_transport",
        "id": "svc_stc_cape_coast",
        "mode": "INTERCITY_BUS",
        "operator": "STC",
        "originCity": "Cape Coast",
        "originStation": "STC Yard, Abura",
        "originLat": 5.1054,
        "originLng": -1.2466,
        "destinationCity": "Accra",
        "destinationRegion": "Greater Accra",
        "notes": "Departs hourly, 06:00–18:00",
        "distanceKm": 8.4,
        "source": "primary"
      }
    ],
    "trotro": [],
    "air": [],
    "carRentals": [
      {
        "id": "prv_rental_1",
        "name": "Coastal Car Rentals",
        "latitude": 5.11,
        "longitude": -1.25,
        "distanceKm": 9.1,
        "transportType": "RENTED_VEHICLE",
        "locationAddress": "Pedu Junction, Cape Coast",
        "avgRating": 4.6,
        "imageUrl": "https://cdn.example.com/coastal.jpg",
        "vehicleMake": "Toyota",
        "vehicleModel": "Corolla",
        "dailyRate": 280,
        "driverRequired": false,
        "source": "verified"
      }
    ],
    "hints": ["Book trotro from the main station — ride-hailing is limited here."]
  },
  "message": "Mobility options retrieved successfully."
}
```

Failures: `404` when the site does not exist.

---

## 5. Step 2 — Create a tour request

### `POST /itinerary/request` — Bearer

```json
{
  "tourSiteIds": ["0f2f6a4e-8f2c-4d5a-9a3e-1b6c7d8e9f01", "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d"],
  "tourType": "SINGLE",
  "durationDays": 5,
  "startRegion": "Central",
  "allowAccraOvernight": false,
  "relocationInterest": false,
  "apartmentType": "HOTEL",
  "transportType": "UBER",
  "companionInterest": false,
  "casualDatingInterest": false
}
```

#### Body fields

| Field                  | Type                                                             | Required | Default     | Notes                                                       |
| ---------------------- | ---------------------------------------------------------------- | -------- | ----------- | ----------------------------------------------------------- |
| `tourSiteIds`          | `string[]` (UUID)                                                | ✅       | —           | 1–50 sites. Must all exist.                                 |
| `tourType`             | `"GROUP" \| "SINGLE"`                                            | ✅       | —           | Echoed back in the request.                                 |
| `durationDays`         | `integer`                                                        | ✅       | —           | **Touring days only**, 1–30. Final itinerary has `+2` days. |
| `startRegion`          | Ghana region string                                              | ❌       | `"Central"` | Hub the loop is anchored to.                                |
| `allowAccraOvernight`  | `boolean`                                                        | ❌       | `false`     | Opt in to more than 2 Greater Accra nights.                 |
| `relocationInterest`   | `boolean`                                                        | ❌       | `false`     | Adds a nearby accommodation suggestion per site.            |
| `apartmentType`        | `"HOTEL" \| "GUESTHOUSE" \| "AIRBNB" \| "APARTMENTS" \| "MOTEL"` | ❌       | `null`      | Preference, falls back to closest supply.                   |
| `transportType`        | `"TROTRO" \| "UBER" \| "RENTED_VEHICLE" \| "NONE"`               | ❌       | `null`      | `NONE` is an explicit opt-out: no transport is recommended. |
| `companionInterest`    | `boolean`                                                        | ❌       | `false`     | Stored for the request.                                     |
| `casualDatingInterest` | `boolean`                                                        | ❌       | `false`     | KYC-gated tour→dating integration.                          |

Valid `startRegion` values: `Greater Accra, Central, Western, Western North,
Volta, Oti, Eastern, Ashanti, Bono, Bono East, Ahafo, Savannah, Northern,
North East, Upper East, Upper West`.

#### Feasibility rules (why a `422` happens)

The request row is still created on failure (so it appears in `/requests`), but
no itinerary can be generated. Surface `error`/`message` to the user.

- **Unknown site IDs** → `422` ("One or more selected tour sites were not found").
- **Capacity:** at most **3 sites per touring day**. `sites.length > durationDays * 3` → `422`.
- **Single-day spread:** when `durationDays === 1`, the furthest two sites must
  be within **250 km** (straight line).
- **Contiguous regions:** each region is explored as one continuous block, so
  the route may need more days than requested. If the number of region-day
  groups exceeds `durationDays` → `422` with the minimum required days.
- **Accra night cap:** at most **2 Greater Accra nights** unless
  `allowAccraOvernight: true`. The preparation night only counts when
  `startRegion` is `Greater Accra`.

#### Success `201`

```json
{
  "success": true,
  "message": "Tour request created successfully. Proceed to complete payment to view itinerary.",
  "data": {
    "tourRequestId": "b6f0c2d4-3a1e-4f5b-8c7d-9e0f1a2b3c4d",
    "itinerary": null
  },
  "price": 500
}
```

`price` is for display: **350** when `durationDays <= 4`, otherwise **500**
(defaults; the actual charged amount comes from the payment config).

#### Validation failure `400`

```json
{
  "success": false,
  "error": "Validation failed. Please check your request.",
  "details": [{ "field": "durationDays", "message": "Tour cannot exceed 30 touring days" }]
}
```

#### Not feasible `422`

```json
{
  "success": false,
  "message": "You have selected 12 sites but only have 3 touring day(s). A maximum of 3 sites can be visited per day. Maximum allowed for your trip is 9 sites. Please add more days or reduce your selected sites.",
  "data": {
    "tourRequestId": "b6f0c2d4-…",
    "itinerary": null
  },
  "error": "You have selected 12 sites but only have 3 touring day(s). …"
}
```

#### KYC required `403` (`casualDatingInterest: true`)

```json
{
  "success": false,
  "error": {
    "code": "KYC_VERIFICATION_REQUIRED",
    "message": "Complete identity verification to use casual dating.",
    "nextStep": "PHONE_VERIFICATION",
    "completedSteps": ["EMAIL_VERIFICATION"],
    "requiredSteps": ["PHONE_VERIFICATION", "PROFILE_IMAGE", "DOCUMENTS"]
  },
  "details": {
    "action": "COMPLETE_VERIFICATION",
    "redirect": "/verification"
  }
}
```

Branch on `details.action === "COMPLETE_VERIFICATION"` and send the user to
`details.redirect`.

---

## 6. Step 3 — Pay for the itinerary

### `POST /itinerary/:tourRequestId/payment` — Bearer

No body. Returns the Hubtel checkout URL at the **top level of `data`** so the
client can redirect immediately.

**Response `200` — normal checkout:**

```json
{
  "success": true,
  "data": {
    "tourRequestId": "b6f0c2d4-…",
    "paymentId": "pay_123",
    "checkoutUrl": "https://checkout.hubtel.com/session/cs_123456",
    "checkoutId": "cs_123456",
    "clientReference": "DAGH-ITIN-00123",
    "paymentData": { "responseCode": "0000", "data": { "checkoutUrl": "https://…" } }
  },
  "message": "Payment initiated. Proceed to complete payment to view itinerary."
}
```

**Response `200` — already paid:**

```json
{
  "success": true,
  "data": {
    "tourRequestId": "b6f0c2d4-…",
    "paymentId": "pay_123",
    "checkoutUrl": null,
    "checkoutId": null,
    "clientReference": null,
    "paymentData": null,
    "alreadyPaid": true,
    "freeMode": false
  },
  "message": "This itinerary has already been paid for."
}
```

**Response `200` — payments disabled / fee waived:**

```json
{
  "success": true,
  "data": {
    "tourRequestId": "b6f0c2d4-…",
    "paymentId": null,
    "checkoutUrl": null,
    "checkoutId": null,
    "clientReference": null,
    "paymentData": null,
    "freeMode": true
  },
  "message": "Payments are temporarily disabled. The itinerary fee has been waived."
}
```

Client behaviour:

- `checkoutUrl` present → open/redirect to it. Do **not** build the URL yourself.
- `alreadyPaid: true` → skip checkout and fetch the itinerary.
- `freeMode: true` → skip checkout and fetch the itinerary; the request is
  already unlocked (`paymentStatus = SUCCESS`).
- `502` → payment provider could not create a checkout. Retry later; do not
  mark the trip paid.

### Payment callback (server-to-server)

`POST /itinerary/payment-callback` is called by Hubtel. The frontend must not
call it. On success it sets `tourRequest.paymentStatus = "SUCCESS"` (or
`"FAILED"`) and writes the ledger entry. Generation still happens on the next
itinerary read.

### Payment failure

If the callback reports failure, `GET /itinerary/:tourRequestId` keeps
returning `403 PAYMENT_REQUIRED`. Allow the user to retry
`POST /:tourRequestId/payment`.

---

## 7. Step 4 — Fetch the itinerary

### `GET /itinerary/:tourRequestId` — Bearer

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "itinerary": { "…see §8…" },
    "request": {
      "id": "b6f0c2d4-…",
      "userId": "usr_123",
      "tourType": "SINGLE",
      "durationDays": 5,
      "paymentStatus": "SUCCESS",
      "paymentId": "pay_123",
      "status": "CONFIRMED",
      "relocationInterest": false,
      "createdAt": "2026-10-01T10:00:00.000Z",
      "selectedSites": [
        {
          "id": "trs_1",
          "tourRequestId": "b6f0c2d4-…",
          "tourSiteId": "0f2f6a4e-…",
          "tourSite": { "…full tour site row…" }
        }
      ]
    },
    "price": 500
  },
  "message": "Itinerary retrieved successfully."
}
```

- `data.price` is `null` when the itinerary is not feasible.
- The first successful read **generates and persists** the itinerary. Expect a
  slightly slower first request.

**Error `403` before payment:**

```json
{ "success": false, "error": "PAYMENT_REQUIRED" }
```

Other codes: `TOUR_REQUEST_NOT_FOUND` (404), `FORBIDDEN` (403 — not the
owner), `ITINERARY_NOT_FEASIBLE` (400), `NO_SITES_FOR_ITINERARY` (400).

---

## 8. Itinerary response reference

```json
{
  "id": "itn_123",
  "tourRequestId": "b6f0c2d4-…",
  "isFeasible": true,
  "feasibilityError": null,
  "totalDays": 7,
  "dateCreated": "2026-10-01T10:05:00.000Z",
  "routeRegions": ["Central", "Ashanti", "Greater Accra"],
  "accraNights": 1,
  "warnings": [],
  "days": ["…see §8.2…"],
  "available_hotels": ["…see §8.5…"],
  "available_transports": ["…see §8.6…"],
  "transportHints": ["Ride-hailing (Uber/Bolt) is widely available in this area."],
  "datingSelections": ["…see §8.7…"]
}
```

### 8.1 Top-level fields

| Field                  | Type            | Meaning                                                                                            |
| ---------------------- | --------------- | -------------------------------------------------------------------------------------------------- |
| `id`                   | string          | Itinerary ID.                                                                                      |
| `tourRequestId`        | string          | The request this plan belongs to.                                                                  |
| `isFeasible`           | boolean         | Always `true` in a `200` response. Infeasible plans return `400`.                                  |
| `feasibilityError`     | string \| null  | Reason the plan failed, if any.                                                                    |
| `totalDays`            | number          | `durationDays + 2` (arrival + departure included).                                                 |
| `dateCreated`          | ISO string      | Generation timestamp.                                                                              |
| `routeRegions`         | string[]        | Ordered, de-duplicated region loop.                                                                |
| `accraNights`          | number          | Nights attributed to Greater Accra (cost limiter).                                                 |
| `warnings`             | string[]        | Non-fatal advisories. May contain an HTML `<span class="tag">…</span>` — render as sanitized HTML. |
| `days`                 | Day[]           | Ordered day plan (see §8.2).                                                                       |
| `available_hotels`     | Accommodation[] | Nearest verified stays across the whole trip.                                                      |
| `available_transports` | Transport[]     | Verified car rentals **and** public-transport suggestions; discriminate on `kind`.                 |
| `transportHints`       | string[]        | Flat, de-duplicated hints for the whole trip.                                                      |
| `datingSelections`     | DatingProfile[] | Profiles merged into the trip (see §8.7).                                                          |

### 8.2 `days[]`

Day order and types are fixed:

| Day               | `dayType`     | Content                                         |
| ----------------- | ------------- | ----------------------------------------------- |
| `1`               | `PREPARATION` | Arrival/orientation at the hub. No sites.       |
| `2 … totalDays-1` | `TOURING`     | Site visits, one region per day, up to 3 sites. |
| `totalDays`       | `DEPARTURE`   | Farewell from the final region. No sites.       |

If fewer sites were selected than the touring-day budget allows, the spare
touring days are still present with `sites: []` in the final region.

```json
{
  "dayNumber": 3,
  "dayType": "TOURING",
  "title": "Day 3: Canopy Walk & Coastal Heritage (Central Region)",
  "region": "Central",
  "sites": ["…see §8.3…"],
  "localAccommodation": {
    "id": "prv_hotel_1",
    "name": "Rainforest Lodge",
    "latitude": 5.34,
    "longitude": -1.38,
    "distanceKm": 2.1,
    "apartmentType": "HOTEL",
    "source": "verified"
  },
  "localTransport": { "…car rental shape, see §8.6…" },
  "selectedTransport": { "…car rental shape or null…" },
  "transportHints": [
    "Trotro from the main station is the usual way to reach this site."
  ],
  "socialBlocks": ["…see §8.7…"]
}
```

| Field                | Type                                  | Notes                                                                                                 |
| -------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `dayNumber`          | number                                | 1-based.                                                                                              |
| `dayType`            | `PREPARATION \| TOURING \| DEPARTURE` |                                                                                                       |
| `title`              | string \| null                        | Human-readable label.                                                                                 |
| `region`             | string \| null                        | Region the day is anchored to.                                                                        |
| `sites`              | DaySite[]                             | Ordered by `visitOrder`. Empty on arrival/departure/spare days.                                       |
| `localAccommodation` | object \| null                        | Nearest stay for the day (within 75 km, else nearest nationally). `source`: `verified` or `fallback`. |
| `localTransport`     | CarRental \| null                     | Recommended rental for the day. `null` when `transportType: "NONE"`.                                  |
| `selectedTransport`  | CarRental \| null                     | The rental the user explicitly confirmed for this day. `null` means "use `localTransport`".           |
| `transportHints`     | string[]                              | Hints derived from this day's sites' transit profiles.                                                |
| `socialBlocks`       | SocialBlock[]                         | Dating profiles scheduled on this day.                                                                |

### 8.3 `days[].sites[]` (DaySite)

```json
{
  "visitOrder": 1,
  "site": {
    "id": "0f2f6a4e-…",
    "name": "Kakum National Park",
    "region": "Central",
    "latitude": 5.35,
    "longitude": -1.3833,
    "description": "Rainforest canopy walkway…",
    "history": "Protected as a national park in 1992, Kakum is best known for the 350 m canopy walkway built in 1995…",
    "imageUrl": "https://cdn.example.com/kakum.jpg",
    "imageCredit": "Wikimedia Commons",
    "category": "NATURE",
    "transitProfile": "PERI_URBAN"
  },
  "availableAccomodation": null,
  "accommodationOptions": ["…see §8.4…"],
  "publicTransportOptions": ["…see §8.6.2…"],
  "mobility": { "…see §4 / SiteMobility…" }
}
```

> ⚠️ **Spelling matters:** the per-site field is `availableAccomodation`
> (one `m`). It is only populated when the request set
> `relocationInterest: true`; otherwise it is `null`. It is unrelated to
> `accommodationOptions`, which is always present.

### 8.4 `accommodationOptions[]` (per site)

Tiered list around that exact site:

- **Tier 1 — verified:** internal provider database within **5 km**, preferred
  `apartmentType` first.
- **Tier 2 — external:** when fewer than 2 verified matches exist, Google
  Places results are injected with `source: "external"` and
  `tag: "Suggested Alternative Accommodation"`.

```json
{
  "id": "prv_hotel_1",
  "name": "Rainforest Lodge",
  "latitude": 5.34,
  "longitude": -1.38,
  "distanceKm": 2.1,
  "propertyType": "HOTEL",
  "source": "verified"
}
```

```json
{
  "id": "places_abc",
  "name": "Kakum Guest House",
  "latitude": 5.36,
  "longitude": -1.37,
  "distanceKm": 3.4,
  "propertyType": "GUESTHOUSE",
  "source": "external",
  "tag": "Suggested Alternative Accommodation"
}
```

Use `source` to style verified vs suggested rows, and show `tag` when present.

### 8.5 Top-level `available_hotels[]`

Nearest verified stays across all selected sites (max 3), preference-aware:

```json
{
  "id": "prv_hotel_1",
  "name": "Rainforest Lodge",
  "latitude": 5.34,
  "longitude": -1.38,
  "distanceKm": 2.1,
  "apartmentType": "HOTEL",
  "source": "verified"
}
```

### 8.6 `available_transports[]` and public transport

`available_transports` is a **union**. Always branch on `kind`:

| `kind`             | Shape                                                       |
| ------------------ | ----------------------------------------------------------- |
| `car_rental`       | Full rental detail (vehicle, rate, driver, rating) — §8.6.1 |
| `public_transport` | Operator, boarding point, mode, distance — §8.6.2           |

#### 8.6.1 Car rental (`kind: "car_rental"`)

This is also the shape of `days[].localTransport` and
`days[].selectedTransport`.

```json
{
  "kind": "car_rental",
  "id": "prv_rental_1",
  "name": "Coastal Car Rentals",
  "latitude": 5.11,
  "longitude": -1.25,
  "distanceKm": 9.1,
  "transportType": "RENTED_VEHICLE",
  "locationAddress": "Pedu Junction, Cape Coast",
  "avgRating": 4.6,
  "reviewCount": 38,
  "imageUrl": "https://cdn.example.com/coastal.jpg",
  "vehicleMake": "Toyota",
  "vehicleModel": "Corolla",
  "vehicleYear": 2021,
  "transmission": "AUTOMATIC",
  "fuelType": "PETROL",
  "dailyRate": 280,
  "driverRequired": false
}
```

#### 8.6.2 Public transport (`kind: "public_transport"`)

```json
{
  "kind": "public_transport",
  "id": "svc_stc_cape_coast",
  "mode": "INTERCITY_BUS",
  "operator": "STC",
  "originCity": "Cape Coast",
  "originStation": "STC Yard, Abura",
  "originLat": 5.1054,
  "originLng": -1.2466,
  "destinationCity": "Accra",
  "destinationRegion": "Greater Accra",
  "notes": "Departs hourly, 06:00–18:00",
  "distanceKm": 8.4,
  "source": "primary"
}
```

- `mode`: `INTERCITY_BUS | TROTRO | DOMESTIC_AIR`.
- `source`: `primary` (within radius) or `fallback` (national suggestion).
- Fallback rows carry `tag: "Suggested Alternative Transport"`.
- `distanceKm` is measured to the **boarding point**, and is `null` when the
  catalog row has no coordinates.

The same objects also appear per site under `publicTransportOptions`.

### 8.7 Dating integration

When the user opted into `casualDatingInterest` and selected profiles via
`POST /itinerary/:tourRequestId/dating-selections`, the plan includes them in
two places:

**Top-level `datingSelections[]`:**

```json
{
  "datingProfileId": "dp_1",
  "userId": "usr_456",
  "fullName": "Ama Mensah",
  "headline": "Weekend explorer",
  "photos": ["https://cdn.example.com/a.jpg"],
  "about": "Love coastal trips.",
  "interests": ["hiking", "live music"],
  "profileImage": "https://cdn.example.com/avatar.jpg",
  "selectedAt": "2026-10-01T10:02:00.000Z"
}
```

**Per touring day `socialBlocks[]`:**

```json
{
  "type": "SOCIAL",
  "profile": {
    "datingProfileId": "dp_1",
    "userId": "usr_456",
    "fullName": "Ama Mensah",
    "headline": "Weekend explorer",
    "photos": ["https://cdn.example.com/a.jpg"],
    "about": "Love coastal trips.",
    "interests": ["hiking", "live music"],
    "profileImage": "https://cdn.example.com/avatar.jpg"
  }
}
```

Profiles are distributed round-robin across **touring days only** (so they
never land on arrival/departure days).

---

## 9. Optional actions

### 9.1 Select dating profiles

`POST /itinerary/:tourRequestId/dating-selections` — Bearer, KYC-gated.

```json
{ "userIds": ["usr_456", "usr_789"] }
```

Get candidates from `GET /dating/recommendations?tourRequestId=<uuid>`; they
are filtered by the trip's geofence and schedule overlap.

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "selections": [
      {
        "userId": "usr_456",
        "datingProfileId": "dp_1",
        "selectedAt": "2026-10-01T10:02:00.000Z"
      }
    ]
  },
  "message": "Dating selections saved to your itinerary."
}
```

Errors: `400` no valid profiles, `403` KYC/ownership, `404` request not found.

Selection is additive/idempotent (upsert). Re-fetch the itinerary to see the new
`socialBlocks`.

### 9.2 List dating selections

`GET /itinerary/:tourRequestId/dating-selections` — Bearer.

**Response `200`:** `data.selections` contains the raw relation rows, including
the full `datingProfile` (with `user.fullName` and
`user.profile.bio_profile_image_url`). This is a different, lower-level shape
than `itinerary.datingSelections`; prefer the itinerary payload when rendering
the plan.

### 9.3 Confirm a car rental for one day

`POST /itinerary/:tourRequestId/days/:dayNumber/transport` — Bearer.

```json
{ "providerId": "prv_rental_1" }
```

- `providerId` must be a **verified car-rental provider** (from
  `available_transports` where `kind === "car_rental"`, or
  `mobility.carRentals`).
- Send `{ "providerId": null }` to clear the choice and fall back to
  `localTransport`.
- Only `TOURING` days accept a rental; `PREPARATION` / `DEPARTURE` return `400`.
- The itinerary must already exist (fetch it after payment first).

**Response `200`:**

```json
{
  "success": true,
  "data": { "dayNumber": 3, "transportProviderId": "prv_rental_1" },
  "message": "Car rental saved to your itinerary day."
}
```

Re-fetch the itinerary; the day's `selectedTransport` now reflects the choice.

### 9.4 List the user's requests

`GET /itinerary/requests` — Bearer. Returns `data[]` of raw tour-request rows,
newest first, each with `selectedSites[].tourSite`, plus `paymentStatus` and
`status` (`PENDING | CONFIRMED | FAILED`). Useful for a "My trips" list before
payment.

Query parameters:

| Name | Type | Default | Notes |
| ---- | ---- | ------- | ----- |
| `page` | integer | `1` | 1-based page number. |
| `limit` | integer | `50` | Capped at `100`. |

`selectedSites[].tourSite` intentionally omits the long-form `history` field so
the list stays small (previously this response reached ~660 KB). Fetch
`GET /itinerary/sites` when the full destination-detail row is needed.

### 9.5 List the user's itineraries

`GET /itinerary/my-itineraries` — Bearer. Returns `data[]` of generated
itinerary objects (the §8 shape). Calls the same lazy-generation path as the
single fetch, so entries may be generated on this call. Rows are filtered to
paid requests (all requests when payments are disabled).

Verified provider catalogues (hotels, car rentals, public transport) and dating
selections are loaded **once per HTTP request** and reused for every itinerary.
Itineraries are built through a small worker pool (default concurrency `3`,
override with `MY_ITINERARIES_CONCURRENCY`) so accounts with many trips do not
exhaust the database connection pool.

---

## 10. State model

```
TourRequest.status                    TourRequest.paymentStatus
─────────────────                     ─────────────────────────
PENDING  (created, awaiting payment)  INITIALIZED → PENDING
CONFIRMED (feasible)                  PENDING     → SUCCESS | FAILED
FAILED   (not feasible)               SUCCESS     → unlocked
                                      FAILED      → retry payment
```

- `status` describes **feasibility**, not payment.
- `paymentStatus` is the **access gate** for the itinerary.
- `feeWaived: true` + `paymentStatus: SUCCESS` means free-mode access (no
  charge, no `paymentId`).

---

## 11. Error reference

| Status | `error`                            | Meaning / UI action                                                |
| ------ | ---------------------------------- | ------------------------------------------------------------------ |
| `400`  | `Validation failed…` + `details[]` | Highlight the listed fields.                                       |
| `400`  | `ITINERARY_NOT_FEASIBLE`           | Show that the plan cannot be built; link back to the request form. |
| `400`  | `NO_SITES_FOR_ITINERARY`           | Edge case — ask the user to create a new request.                  |
| `401`  | `Unauthorized`                     | Token missing/expired → sign in.                                   |
| `403`  | `PAYMENT_REQUIRED`                 | Normal pre-payment state — complete checkout, then poll.           |
| `403`  | `FORBIDDEN`                        | The request belongs to another user.                               |
| `403`  | KYC object + `details.action`      | Redirect to `details.redirect` (`/verification`).                  |
| `404`  | `TOUR_REQUEST_NOT_FOUND`           | Request does not exist.                                            |
| `404`  | `Tour site not found.`             | Stale site ID in the picker; refresh sites.                        |
| `422`  | feasibility message                | Request saved but unworkable — show the message verbatim.          |
| `500`  | generic                            | Retry/back-off; do not mark paid.                                  |
| `502`  | checkout creation failed           | Payment provider issue; retry later.                               |

---

## 12. TypeScript types (copy-ready)

```ts
type TourType = "GROUP" | "SINGLE";
type DayType = "PREPARATION" | "TOURING" | "DEPARTURE";
type SiteCategory =
  | "NATURE"
  | "CULTURAL"
  | "HISTORICAL"
  | "BEACH"
  | "WILDLIFE"
  | "RELIGIOUS"
  | "SCENIC"
  | "ADVENTURE"
  | "URBAN"
  | "HERITAGE";
type TransitProfile = "URBAN_CENTER" | "PERI_URBAN" | "RURAL";
type ApartmentType = "HOTEL" | "GUESTHOUSE" | "AIRBNB" | "APARTMENTS" | "MOTEL";
type TransportType = "TROTRO" | "UBER" | "RENTED_VEHICLE" | "NONE";

interface TourSite {
  id: string;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  description: string;
  history: string | null; // long-form background for the detail page
  imageUrl: string | null;
  imageCredit: string | null; // photo attribution, e.g. "Wikimedia Commons"
  category: SiteCategory;
  categories: string[];
  transit_profile: TransitProfile; // snake_case only in the catalog
  createdAt: string;
}

interface ItinerarySite {
  id: string;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  description: string;
  history: string | null;
  imageUrl: string | null;
  imageCredit: string | null;
  category: SiteCategory;
  transitProfile: TransitProfile; // camelCase inside the itinerary
}

interface AccommodationOption {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  propertyType: ApartmentType | null;
  source: "verified" | "external";
  tag?: string; // "Suggested Alternative Accommodation"
}

interface CarRental {
  kind: "car_rental";
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  transportType: TransportType | null;
  locationAddress: string;
  avgRating: number;
  reviewCount: number;
  imageUrl: string | null;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number;
  transmission: string;
  fuelType: string;
  dailyRate: number;
  driverRequired: boolean;
  source?: "verified"; // present on mobility.carRentals
  tag?: string;
}

interface PublicTransportOption {
  kind: "public_transport";
  id: string;
  mode: "INTERCITY_BUS" | "TROTRO" | "DOMESTIC_AIR";
  operator: string;
  originCity: string;
  originStation: string | null;
  originLat: number | null;
  originLng: number | null;
  destinationCity: string | null;
  destinationRegion: string | null;
  notes: string | null;
  distanceKm: number | null;
  source: "primary" | "fallback";
  tag?: string; // "Suggested Alternative Transport"
}

type AvailableTransport = CarRental | PublicTransportOption;

interface SiteMobility {
  siteId: string;
  transitProfile: TransitProfile;
  rideHailing: string[];
  localTransit: string[];
  intercityBus: PublicTransportOption[];
  trotro: PublicTransportOption[];
  air: PublicTransportOption[];
  carRentals: CarRental[];
  hints: string[];
}

interface DaySite {
  visitOrder: number;
  site: ItinerarySite;
  availableAccomodation: LocalProviderRecommendation | null; // note: one "m"
  accommodationOptions: AccommodationOption[];
  publicTransportOptions: PublicTransportOption[];
  mobility: SiteMobility | null; // null when transportType === "NONE"
}

interface LocalProviderRecommendation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  apartmentType?: ApartmentType | null;
  transportType?: TransportType | null;
  source?: "verified" | "fallback";
}

interface DatingProfileSummary {
  datingProfileId: string;
  userId: string;
  fullName: string;
  headline?: string | null;
  photos: string[];
  about?: string | null;
  interests: string[];
  profileImage?: string | null;
}

interface SocialBlock {
  type: "SOCIAL";
  profile: DatingProfileSummary;
}

interface ItineraryDay {
  dayNumber: number;
  dayType: DayType;
  title: string | null;
  region: string | null;
  sites: DaySite[];
  localAccommodation: LocalProviderRecommendation | null;
  localTransport: CarRental | null;
  selectedTransport: CarRental | null;
  transportHints: string[];
  socialBlocks: SocialBlock[];
}

interface Itinerary {
  id: string;
  tourRequestId: string;
  isFeasible: boolean;
  feasibilityError: string | null;
  totalDays: number;
  dateCreated: string;
  routeRegions: string[];
  accraNights: number;
  warnings: string[];
  days: ItineraryDay[];
  available_hotels: LocalProviderRecommendation[];
  available_transports: AvailableTransport[];
  transportHints: string[];
  datingSelections: (DatingProfileSummary & { selectedAt: string })[];
}

interface TourRequestDetail {
  id: string;
  userId: string;
  tourType: TourType;
  durationDays: number;
  paymentStatus: "INITIALIZED" | "PENDING" | "SUCCESS" | "FAILED";
  paymentId: string | null;
  status: "PENDING" | "CONFIRMED" | "FAILED";
  relocationInterest: boolean;
  createdAt: string;
  selectedSites: Array<{
    id: string;
    tourRequestId: string;
    tourSiteId: string;
    tourSite: TourSite;
  }>;
}

interface ItineraryResponseData {
  itinerary: Itinerary;
  request: TourRequestDetail;
  price: number | null;
}
```

---

## 13. Frontend UX checklist

**Before creating a request**

- Load `/itinerary/sites` once and cache it for the picker.
- Enforce the 3-sites-per-day limit client-side to avoid avoidable `422`s:
  `selectedSites.length <= durationDays * 3`.
- If `durationDays === 1`, warn when two selected sites are very far apart.
- Offer `startRegion` (default Central), `apartmentType`, and `transportType`.
- Only show the "add casual dating" toggle if KYC is complete. If not, route
  to `/verification` instead of letting the request fail.

**After creating a request**

- Persist `tourRequestId`; it is the key for payment, itinerary, dating, and
  transport endpoints.
- Show `price` from the `201` response. `durationDays <= 4` → 350 GHS,
  otherwise 500 GHS (display only).
- On `422`, show `error` and keep the user's selections so they can adjust
  duration/sites.

**Payment**

- Redirect to `checkoutUrl` when present.
- Treat `freeMode` / `alreadyPaid` as unlocked — go straight to the itinerary.
- Poll the itinerary endpoint rather than charging twice.

**Itinerary rendering**

- Render `days` in `dayNumber` order. Style day 1 as arrival, last day as
  departure, `TOURING` days as the main schedule.
- Use `day.sites[].visitOrder` for ordering (the query already sorts, but the
  field is authoritative).
- Distinguish `source: "verified"` vs `external`/`fallback` rows and display
  `tag` badges ("Suggested Alternative Accommodation/Transport").
- Branch transport lists on `kind` (`car_rental` vs `public_transport`).
- If `transportType === "NONE"`, `mobility` and `localTransport` are `null`
  and no transport recommendations are returned — hide those sections.
- Render `warnings` (sanitize the allowed HTML `<span>` tag).
- Show `selectedTransport` when set; otherwise show `localTransport` as the
  recommendation.
- Empty `sites` on a touring day is valid (a spare/leisure day in the final
  region) — render it as free time, not an error.

**Mutating actions**

- After saving a day transport or dating selection, re-fetch the itinerary to
  get the recomputed view.
- `selectedTransport` is per-day; clearing it sends `providerId: null`.

---

## 14. Quick reference

| Method | Path                                                  | Auth   | Purpose                          |
| ------ | ----------------------------------------------------- | ------ | -------------------------------- |
| `GET`  | `/itinerary/sites`                                    | Public | Site picker                      |
| `GET`  | `/itinerary/sites/:siteId/mobility`                   | Public | Mobility for one site            |
| `POST` | `/itinerary/request`                                  | Bearer | Create tour request              |
| `POST` | `/itinerary/:tourRequestId/payment`                   | Bearer | Start Hubtel checkout            |
| `POST` | `/itinerary/payment-callback`                         | Hubtel | Payment settlement (server-only) |
| `GET`  | `/itinerary/:tourRequestId`                           | Bearer | Fetch/generate itinerary         |
| `GET`  | `/itinerary/requests`                                 | Bearer | List tour requests               |
| `GET`  | `/itinerary/my-itineraries`                           | Bearer | List generated itineraries       |
| `POST` | `/itinerary/:tourRequestId/dating-selections`         | Bearer | Merge dating profiles            |
| `GET`  | `/itinerary/:tourRequestId/dating-selections`         | Bearer | List merged profiles             |
| `POST` | `/itinerary/:tourRequestId/days/:dayNumber/transport` | Bearer | Confirm/clear a rental           |
