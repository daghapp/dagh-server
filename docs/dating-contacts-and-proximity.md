# Dating: Contact Discovery & Proximity Alerts — Frontend Integration Guide

This guide covers the backend additions that let dating users:

1. **See familiar people** — contacts already on Diaspora Sync, surfaced in discovery.
2. **Get a "someone nearby" alert** — a non-identifying push when another dating
   user is physically close.

Both features live under `/dating` and require the normal authenticated
`Authorization: Bearer <token>` header.

> **Privacy model**
>
> - Contact access is opt-in. The app must obtain OS-level contact permission
>   first and send `consent: true` on the first sync.
> - The client may send raw phone numbers or pre-computed SHA-256 hashes. The
>   server hashes raw values in memory; **only phone hashes and the resulting
>   public profile matches are stored**. Raw contact data is never returned.
> - Proximity alerts never reveal who is nearby, only that someone is within
>   range. The payload contains a distance rounded to whole kilometres.
> - Users can revoke contact access at any time. Revoking deletes all matches
>   derived from their contact book.

---

## 1. Contact discovery

### 1.1 Check current status

`GET /dating/contacts/status`

Use this on the Dating tab or Settings screen to decide whether to show
"Sync contacts", "Manage contacts", or nothing.

```json
{
  "success": true,
  "data": {
    "granted": true,
    "grantedAt": "2026-11-18T09:00:00.000Z",
    "lastSyncedAt": "2026-11-18T09:05:00.000Z",
    "contactCount": 143,
    "matchedCount": 2
  }
}
```

`granted: false` means the user has never granted permission or has revoked it.

### 1.2 Sync contacts

`POST /dating/contacts/sync`

Call this after the OS permission prompt is accepted. The endpoint is
idempotent — re-syncing replaces the previous match set.

**Request**

```json
{
  "consent": true,
  "contacts": [
    "+233201234567",
    { "name": "Ama", "phone": "0244000000" }
  ]
}
```

Alternative keys accepted for convenience: `phoneNumbers`, `phones`, `hashes`.
If your app hashes locally, send the SHA-256 hex strings under `hashes` (or as
plain strings).

**Response**

```json
{
  "success": true,
  "data": {
    "matchedCount": 2,
    "totalContacts": 143,
    "matches": [
      {
        "userId": "6f1c…",
        "fullName": "Ama Mensah",
        "headline": "Coffee and road trips",
        "photos": ["https://res.cloudinary.com/…"],
        "profileImageUrl": "https://res.cloudinary.com/…"
      }
    ],
    "banner": "2 people in your contact list (including Ama) are on Diaspora Sync. Tap to connect."
  },
  "message": "Contacts synced for dating discovery"
}
```

**Errors**

| Status | Meaning |
|---|---|
| `400` | No contacts supplied |
| `403` | `consent` was not `true` and no previous consent exists |
| `500` | Unexpected server error |

> Only users with an **active dating profile** are returned. Contacts who are
> blocked or have hidden their profile are excluded.

### 1.3 List contact matches

`GET /dating/contacts/matches`

Returns the persisted matches (same `DatingContactMatch` shape as above) plus
`matchedCount` and a display-ready `banner`.

```json
{
  "success": true,
  "data": {
    "matchedCount": 1,
    "banner": "1 person in your contact list is on Diaspora Sync. Tap to connect.",
    "matches": [
      {
        "userId": "6f1c…",
        "fullName": "Ama Mensah",
        "headline": "Coffee and road trips",
        "photos": [],
        "profileImageUrl": null
      }
    ]
  }
}
```

Use this for a **"From your contacts"** horizontal row or a dedicated screen.

### 1.4 Revoke access

`DELETE /dating/contacts`

Deletes the consent record and every match derived from the contact book.

```json
{ "success": true, "data": { "granted": false }, "message": "Contact access revoked" }
```

Show this as **"Remove imported contacts"** in Settings.

---

## 2. Contact matches in discovery

`GET /dating/recommendations` now includes two extra fields per candidate:

| Field | Type | Meaning |
|---|---|---|
| `isContactMatch` | `boolean` | Candidate is in the caller's synced contacts |
| `familiar` | `boolean` | Same value, provided for direct UI use |

Contact matches are also **ranked higher** (a familiarity bonus is applied after
the normal interest/age/completeness score).

`reasons` may contain `"In your contacts"`, which you can render as a badge.

### "Only my contacts" view

Pass `contactsOnly=true`:

```
GET /dating/recommendations?contactsOnly=true&limit=20&offset=0
```

Returns only candidates who are in the caller's synced contacts. Combine with the
normal pagination fields. If the user has not synced contacts, the result is an
empty array — prompt them to sync first.

The endpoint remains KYC-gated and still applies the legal opposite-gender
filter, blocks, passes, and hidden-profile rules.

---

## 3. Proximity alerts

### 3.1 How it works

- The user's dating location is stored on `DiscoveryPreference`.
- A background job runs every 30 minutes and compares recently refreshed
  locations.
- If two eligible dating users are within range, each receives at most **one
  non-identifying push per 24 hours**.
- Range is the smaller of **10 km** and each user's `maxDistanceKm`.
- Blocked users, users of the same gender, and users without a recent location
  are skipped.
- Locations older than **12 hours** are ignored, so the app should refresh the
  location while the Dating tab is in use (for example, on open and after
  significant movement).

### 3.2 Location heartbeat

`PUT /dating/location`

Use this instead of `PUT /dating/preferences` when you only need to update the
position. It requires an existing dating profile.

```json
{
  "locationLat": 5.6037,
  "locationLng": -0.187,
  "locationName": "Accra"
}
```

`latitude` / `longitude` are accepted as aliases. The response is the updated
discovery preference, including `locationUpdatedAt`.

> `PUT /dating/preferences` also refreshes `locationUpdatedAt` whenever it
> receives both coordinates, so either endpoint works.

### 3.3 Push payload

Proximity pushes arrive through the normal device notification channel with:

```json
{
  "type": "DATING_NEARBY",
  "distanceKm": "4",
  "route": "/dating/discovery"
}
```

| Key | Meaning |
|---|---|
| `type` | Always `DATING_NEARBY` |
| `distanceKm` | Rounded distance in kilometres (string, as required by push providers) |
| `route` | Suggested in-app route to open |

Suggested copy:

- Title: **Someone is nearby**
- Body: **A dating member is within 4 km of you. Open Discovery to see who's around.**

Do **not** try to identify the nearby user from the payload — the backend
intentionally does not include it. Opening Discovery fetches the normal,
consent-aware recommendations.

### 3.4 Eligibility summary

| Rule | Value |
|---|---|
| Alert radius | `min(10 km, user's maxDistanceKm)` |
| Per-user frequency | 1 alert / 24 hours |
| Location freshness | 12 hours |
| Gender | Opposite gender only (legal compliance) |
| Blocks | Always excluded |
| Dating profile | Required |
| Push provider | Expo push token registered via `POST /devices/register` |

---

## 4. Client implementation checklist

- [ ] Request OS contact permission before calling `/dating/contacts/sync`.
- [ ] Send `consent: true` on the first sync.
- [ ] Re-sync when the user taps "Refresh contacts" (manual is enough; avoid
      syncing on every app launch).
- [ ] Show a "From your contacts" row using `/dating/contacts/matches`.
- [ ] Render `familiar` / `isContactMatch` badges from recommendations.
- [ ] Add a "Remove imported contacts" action calling `DELETE /dating/contacts`.
- [ ] Refresh `/dating/location` while the Dating tab is active.
- [ ] Register an Expo push token with `/devices/register`.
- [ ] Handle `type: "DATING_NEARBY"` in the push handler and route to Discovery.
- [ ] Respect the existing KYC gate and date-of-birth/age rules.

---

## 5. API summary

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/dating/contacts/status` | Consent + last sync/match counts |
| `POST` | `/dating/contacts/sync` | Upload contacts and persist matches |
| `GET` | `/dating/contacts/matches` | List familiar users |
| `DELETE` | `/dating/contacts` | Revoke consent and delete matches |
| `PUT` | `/dating/location` | Refresh dating location for proximity alerts |
| `GET` | `/dating/recommendations?contactsOnly=true` | Only familiar candidates |

OpenAPI/Swagger: these paths and schemas are included in `/api-docs`
(`DatingContactMatch`, `DatingContactSyncResult`, `DatingContactStatus`).

## 6. Backend files

| File | Responsibility |
|---|---|
| `src/modules/dating/dating-contacts.controller.ts` | Contact sync/list/status/revoke handlers |
| `src/services/dating-contacts.service.ts` | Hashing, matching, persistence, consent |
| `src/services/dating-proximity.service.ts` | Nearby scan, cooldown, Expo push |
| `src/jobs/dating-proximity.ts` | 30-minute proximity worker |
| `src/services/matching.service.ts` | Contact boost + `contactsOnly` filter |
| `prisma/schema.prisma` | `ContactSyncConsent`, `ContactMatch`, `DatingProximityNotification` |
