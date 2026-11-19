# Contact Discovery & Tour Start Region — Change Notes

Reference for the two product fixes delivered together:

1. **"People You May Know" / contact sync** now finds contacts across the whole
   platform (not just dating), survives restarts, handles different phone-number
   formats, and exposes an invite link for people who are not on the app yet.
2. **Tour start region** is no longer silently forced to Central when the client
   omits `startRegion`; the server infers it from the selected tour sites.

All contact endpoints are mounted under **`/contacts`** and **`/dating/contacts`**
on the API origin. The tour request endpoint is **`POST /itinerary/request`**.

---

## 1. Tour start region

### 1.1 Problem

`startRegion` was declared as `.optional().default("Central")` in both request
validators. If the mobile client did not send a hub (or the user never chose
one), the server treated Central as an explicit choice. A user who selected
only Ashanti/Volta/Accra sites therefore received a confirmation email saying
**“Start region: Central”**, and Day 1 was anchored in Central.

### 1.2 New behaviour

- `startRegion` is still optional, but **no longer defaults to Central** in the
  validator.
- If `startRegion` is supplied, it is honoured as-is (an explicit gateway choice
  is valid even when no selected site is in that region).
- If `startRegion` is omitted, the hub is inferred from the selected sites:
  - the most frequently selected region wins;
  - ties are broken by the regional centroid nearest the selection's overall
    centroid;
  - alphabetical order breaks any remaining tie;
  - Central is used only when the selection is empty.
- The resolved hub is used for planning, persisted on `TourRequest.startRegion`,
  and rendered in the confirmation email.
- Lazy itinerary generation also infers the hub from the sites when a stored
  `startRegion` is `null` (legacy rows).

### 1.3 API

`POST /itinerary/request` — unchanged response shape.

```json
{
  "tourSiteIds": ["<uuid>", "<uuid>"],
  "tourType": "SINGLE",
  "durationDays": 4,
  "startRegion": "Ashanti"
}
```

`startRegion` is optional. Omit it to let the server infer the hub:

```json
{
  "tourSiteIds": ["<uuid>", "<uuid>"],
  "tourType": "SINGLE",
  "durationDays": 4
}
```

Valid values are the Ghana regions in `GHANA_REGIONS`
(`Greater Accra`, `Central`, `Western`, `Western North`, `Volta`, `Oti`,
`Eastern`, `Ashanti`, `Bono`, `Bono East`, `Ahafo`, `Savannah`, `Northern`,
`North East`, `Upper East`, `Upper West`).

### 1.4 Client notes

- **Do not send `startRegion: "Central"` as a client-side default.** The server
  cannot distinguish that from a genuine user choice and will keep Central.
- Omit the field when the user has not chosen a hub.
- Existing tour requests created before this change already store `"Central"`,
  so their lazily generated itineraries still anchor Central. Re-inferring those
  would require a deliberate backfill or a “hub was explicit” flag; this change
  does not mutate historical rows.
- An explicit hub that is not among the selected sites is still allowed (for
  example, flying into Accra and staying in Cape Coast first). The engine treats
  it as the arrival/orientation hub.

### 1.5 Files

| File                                                                   | Change                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/helpers/itinerary-routing.ts`                                     | Added `deriveStartRegion()`                                                     |
| `src/validator/itinerary-validator.ts`                                 | `startRegion` optional, no Central default                                      |
| `src/validator/itinerary-request-validator.ts`                         | Same                                                                            |
| `src/modules/itinerary/itinerary.service.ts`                           | Resolve hub before planning, persist and email it; infer for legacy `null` rows |
| `src/validator/itinerary-swagger.ts`, `src/routes/itinerary.routes.ts` | Swagger/docs updated                                                            |
| `tests/itinerary-loop-routing.test.ts`                                 | Added `deriveStartRegion` tests                                                 |

---

## 2. Contact discovery / “People You May Know”

### 2.1 Problems fixed

| Problem                                                    | Cause                                                                                                                                       | Fix                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Contacts already on the app were not found after sync      | Phone hashes were based on raw digits only: a device contact `0244000000` hashed differently from a registered E.164 number `+233244000000` | Lookups now try every plausible digit form (local, missing leading zero, country-code) |
| Matches disappeared after a restart or on another instance | `GET /contacts/matches` read an in-memory map only                                                                                          | Matches persist in `ContactMatch` and are read from the database                       |
| Only dating users were discoverable                        | Dating matching filtered `datingProfile: { isNot: null }`                                                                                   | Matching now covers **every active account**; dating fields are optional               |
| Google/Apple/Facebook sign-ups could never match           | Those accounts may have no phone number/hash                                                                                                | Contacts may optionally include an `email`; it is matched transiently                  |
| No way to invite people who are not on the app             | No invite surface in contact APIs                                                                                                           | New invite link endpoint + `invite` object in sync/matches responses                   |

### 2.2 Matching rules

- **Accounts covered:** all `accountStatus = "ACTIVE"` users except the caller.
- **Blocked pairs:** excluded in both directions.
- **Phone formats:** for each contact phone the server hashes the raw digits plus
  local/country-code variants. Example: `0244000000`, `244000000`, and
  `+233244000000` all resolve to the same account.
- **Country code:** `DEFAULT_PHONE_COUNTRY_CODE` (default `233`, Ghana) controls
  how local numbers are expanded. Set it in the environment for other markets.
- **Emails:** if a contact includes `email`, it is compared case-insensitively
  against account emails. Raw emails are not persisted.
- **Precomputed hashes:** if the client sends `hashes`, the server cannot expand
  them into format variants. Prefer sending raw phone numbers.
- **Privacy:** raw phone numbers and emails are hashed/compared in memory and
  are never written to the database. Only matched user IDs and the match owner's
  consent/counts are stored.

### 2.3 Persistence & consent

- A successful sync upserts `ContactSyncConsent` (`granted = true`,
  `lastSyncedAt`, `contactCount`) and reconciles `ContactMatch` rows.
- `GET /contacts/matches` returns `[]` until a consent row exists, so existing
  users must re-sync once after this release.
- `DELETE /contacts/matches` removes derived matches and revokes consent.
- `DELETE /dating/contacts` does the same (shared consent/matches).

### 2.4 Endpoints

#### General contact book

| Method | Endpoint                | What it does                                                                        |
| ------ | ----------------------- | ----------------------------------------------------------------------------------- |
| POST   | `/contacts/sync`        | Match contacts against all active accounts, persist matches, return counts + invite |
| POST   | `/contacts/match`       | Alias of `/contacts/sync`                                                           |
| GET    | `/contacts/matches`     | Persisted matches + banner + invite                                                 |
| GET    | `/contacts/suggestions` | Alias of `/contacts/matches` (“People You May Know”)                                |
| GET    | `/contacts/invite-link` | Shareable app invite link                                                           |
| GET    | `/contacts/invite`      | Alias of `/contacts/invite-link`                                                    |
| DELETE | `/contacts/matches`     | Clear matches and revoke consent                                                    |

Request body accepts any of `contacts`, `phoneNumbers`, `phones`, or `hashes`.
Each contact may be a string or an object:

```json
{
  "contacts": [
    "+233201234567",
    { "name": "Ama", "phone": "0244000000" },
    { "name": "Kwame", "email": "kwame@example.com" }
  ]
}
```

`POST /contacts/sync` response:

```json
{
  "success": true,
  "message": "Contacts synced",
  "data": {
    "matchedCount": 2,
    "unmatchedCount": 141,
    "totalContacts": 143,
    "matches": [
      {
        "userId": "6f1c…",
        "name": "Ama Mensah",
        "phoneNumber": "+233244000000",
        "profileImageUrl": "https://…",
        "headline": null,
        "hasDatingProfile": false
      }
    ],
    "banner": "2 people in your contact list (including Ama Mensah) are already on Diaspora Sync!",
    "invite": {
      "inviterName": "Kojo",
      "shareUrl": "https://api.example.com/share/app?inviter=Kojo",
      "title": "Kojo wants to connect with you on Diaspora Sync",
      "imageUrl": "https://…",
      "token": "<jwt>",
      "deepLink": "diasporansync://share/app/<userId>?token=<jwt>",
      "deferredDeepLink": "diasporansync://deferred?token=<jwt>",
      "storeUrl": "https://play.google.com/…",
      "playStoreUrl": "https://play.google.com/…",
      "appStoreUrl": "https://apps.apple.com/…"
    }
  }
}
```

`GET /contacts/matches` returns `matches`, `matchedCount`, `banner`, and
`invite` (no `unmatchedCount`).

#### Dating contact book

The same matching engine powers the dating contact endpoints. They now include
**all active accounts**, not just dating profiles.

| Method | Endpoint                   | What it does                                                      |
| ------ | -------------------------- | ----------------------------------------------------------------- |
| POST   | `/dating/contacts/sync`    | Same matching/persistence; requires `consent: true` on first sync |
| GET    | `/dating/contacts/matches` | Persisted matches + banner + invite                               |
| GET    | `/dating/contacts/status`  | Consent, last sync, contact/match counts                          |
| DELETE | `/dating/contacts`         | Revoke consent and delete matches                                 |

Dating match shape:

```json
{
  "userId": "6f1c…",
  "fullName": "Ama Mensah",
  "headline": "Coffee and road trips",
  "photos": ["https://…"],
  "profileImageUrl": "https://…",
  "hasDatingProfile": true
}
```

When the matched account has no dating profile, `headline` is `null`,
`photos` is `[]`, and `hasDatingProfile` is `false`. The client should use that
flag to decide whether to render dating-specific UI.

`POST /dating/contacts/sync` also returns `unmatchedCount` and `invite`.

### 2.5 Inviting contacts who are not on the app

1. Call `POST /contacts/sync` (or `GET /contacts/matches`).
2. Compare the returned `matchedCount` with `totalContacts`/`unmatchedCount`.
3. If there are unmatched contacts, present “Invite to Diaspora Sync” using the
   returned `invite.shareUrl` (rich preview page) or `invite.deepLink` (in-app
   navigation). The client can forward the link through the OS share sheet / SMS.
4. To regenerate the link later, call `GET /contacts/invite-link`.

The invite page is the existing public `/share/app?inviter=<name>` preview and
requires `API_URL` or `RENDER_EXTERNAL_URL` to be configured for absolute URLs.

### 2.6 Client checklist

- [ ] Re-run contact sync after deploying this release (old in-memory matches are gone).
- [ ] Send raw phone numbers where possible; include `email` to match social sign-ups.
- [ ] Use `hasDatingProfile` before showing dating-only fields.
- [ ] Show an “Invite” action when `unmatchedCount > 0` using `invite.shareUrl`.
- [ ] Keep phone normalization consistent in the OS permission flow; the server
      handles local vs E.164 differences but cannot reverse a wrong local hash.

### 2.7 Environment

| Variable                          | Default                       | Purpose                                                      |
| --------------------------------- | ----------------------------- | ------------------------------------------------------------ |
| `DEFAULT_PHONE_COUNTRY_CODE`      | `233`                         | Country code used to expand local phone numbers for matching |
| `API_URL` / `RENDER_EXTERNAL_URL` | —                             | Base URL for invite/share links                              |
| `PLAY_STORE_URL`                  | configured Play Store listing | Android invite fallback                                      |
| `APP_STORE_URL`                   | —                             | iOS invite fallback                                          |
| `APP_DEEP_LINK_SCHEME`            | `diasporansync`               | Deep-link scheme in `invite.deepLink`                        |

### 2.8 Files

| File                                                           | Change                                                                            |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/helpers/phoneHash.ts`                                     | Added `phoneDigitCandidates()` / `hashPhoneCandidates()`                          |
| `src/helpers/phone-hash.ts`                                    | Re-exports the shared helpers                                                     |
| `src/modules/contacts/contacts.service.ts`                     | Lookup candidates, email matching, persistence, invite builder, DB-backed matches |
| `src/modules/contacts/contacts.controller.ts`                  | Async matches/clear, invite handler, invite in sync responses                     |
| `src/routes/contacts.routes.ts`                                | Added `/invite-link` and `/invite`                                                |
| `src/services/dating-contacts.service.ts`                      | Uses shared matching; all active accounts; dating fields optional                 |
| `src/modules/dating/dating-contacts.controller.ts`             | Includes invite in matches response                                               |
| `src/validator/datingValidation.ts`                            | Contact entries accept `email`                                                    |
| `src/config/swagger-schemas.ts`, `src/routes/dating.routes.ts` | Schema/docs updated                                                               |
| `prisma/schema.prisma`                                         | Comment only (no migration required)                                              |
| `tests/phone-hash.test.ts`                                     | Phone-variant matching tests                                                      |

---

## 3. Rollout notes

- **No database migration is required.** Only comments changed in `schema.prisma`.
- Deploy the server first; clients can adopt the new fields without breaking old
  responses (fields are additive).
- Contact matches are derived data: users who synced under the old release should
  sync once more to populate the persisted table.
- Historical tour requests that stored `"Central"` before this change are not
  rewritten automatically. Decide whether to leave them or run a targeted
  backfill after confirming which rows were genuine Central choices.
- `DEFAULT_PHONE_COUNTRY_CODE` defaults to Ghana (`233`); set it explicitly for
  non-Ghana deployments.

---

## 4. Verification

- `npx tsc --noEmit`
- `npx eslint` on the touched modules
- `npx vitest run tests/phone-hash.test.ts tests/itinerary-loop-routing.test.ts`
- `npx prettier --check` on the touched files

End-to-end contact matching still depends on the client sending the same contact
values and on real user phone/email data; the automated coverage above is unit
level.
