# Dating Discovery & Distance

How candidate discovery and the distance/location preference work in the dating
module (`src/services/matching.service.ts`, `src/modules/dating/*`).

## Overview

- Discovery is **global by default**: all active, non-blocked dating profiles are
  candidates regardless of country. There is no country/IP restriction.
- Candidate pool is filtered only by gender (opposite of viewer, compliance rule),
  age range, and hidden/blocked/passed users.
- Distance and location influence **ranking (score)**, never the candidate pool,
  unless the user opts into nearby matching.

## User preference (`DiscoveryPreference`)

| Field | Default | Meaning |
|---|---|---|
| `globalDiscovery` | `true` | When true, discovery is worldwide and ignores location/distance. |
| `maxDistanceKm` | 50 | Used only when `globalDiscovery = false` and a location is set. Capped at 20,000 km. Also caps proximity alerts at 10 km. |
| `locationLat` / `locationLng` / `locationName` | null | User's chosen center point for nearby matching. |
| `locationUpdatedAt` | null | Server-managed timestamp of the last location refresh. Proximity alerts only use locations refreshed within 12 hours. |
| `minAge` / `maxAge` | 18 / 60 | Age filter. |
| `lookingFor` | — | Optional intent filter. |
| `showProfile` / `showOnlineStatus` | true | Visibility toggles. |

Toggle via `PUT /dating/preferences` with `globalDiscovery: true|false`.

`locationLat`, `locationLng`, and `locationName` are all nullable. Send `null`
(not just omit them) to clear a previously saved location; the fields are
validated as optional-and-nullable, so an unset location never fails the
request.

## Scoring

- Base score: interest overlap (up to 40), age proximity (up to 30), profile
  completeness (up to 20), membership tier boost.
- Contact familiarity bonus: **+15** when the candidate is in the viewer's synced
  contacts (`isContactMatch` / `familiar` is `true`).
- Distance score is added **only** when `globalDiscovery === false`:
  - With a travel context (tour request): `max(0, 15 - distanceKm/20)`.
  - With a saved location: `max(0, 10 - distanceKm/100)`.
- Travel context (tour request) adds schedule-overlap bonus and a geofence
  bonus for candidates inside the tour radius, plus requires schedule overlap.

## Travel mode

Pass `?tourRequestId=<uuid>` to `GET /dating/recommendations`. The server
derives a geofence (centroid + radius of selected tour sites, floor 50 km) and
a schedule window from the tour request. Candidates must have overlapping
availability; proximity/geofence adds score.

## Contact discovery

Users can opt in to compare their contacts against **all active accounts**, not
only users with a dating profile. Phone numbers are matched across local/E.164
formats, and contacts may include an optional email (useful for social sign-ups
with no phone hash). Only SHA-256 phone hashes are stored; raw contacts are never
persisted. Responses include `hasDatingProfile`, `unmatchedCount`, and an
`invite` link for people who are not on the platform yet.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/dating/contacts/status` | Consent state + last sync/match counts |
| `POST` | `/dating/contacts/sync` | Sync contacts (`consent: true` on first call) |
| `GET` | `/dating/contacts/matches` | List familiar users (dating fields where present) |
| `DELETE` | `/dating/contacts` | Revoke consent and delete derived matches |

Candidates from the contact book are marked with `isContactMatch` (and the
`familiar` alias) in `GET /dating/recommendations`, ranked with the +15 bonus, and
receive an `"In your contacts"` reason label. Pass `?contactsOnly=true` to
restrict discovery to familiar candidates.

Full frontend integration guide:
[`docs/dating-contacts-and-proximity.md`](./dating-contacts-and-proximity.md).
Change notes (format variants, app-wide matching, invites):
[`docs/contact-discovery-and-start-region.md`](./contact-discovery-and-start-region.md).

## Proximity alerts

`PUT /dating/location` refreshes the stored dating coordinates without changing
other preferences. A worker runs every 30 minutes and compares locations
refreshed within the last 12 hours. Eligible users (opposite gender, not
blocked, within `min(10 km, maxDistanceKm)`) receive a non-identifying
`DATING_NEARBY` push at most once per 24 hours. The payload contains only the
rounded distance and a suggested route; it never identifies the nearby user.

## KYC gate

Dating is only available to KYC-verified users (`requireKYCVerification`).

## Paid vs free

- Discovery/swiping is free after KYC.
- Paid tier unlocks: viewing full list of users who liked you (free gets count
  only), higher super-like daily limits, ranking boost.

## Global vs nearby summary

- Default: global, no distance restriction.
- Opt-in nearby: set `globalDiscovery=false` with a location; distance scoring
  applies up to `maxDistanceKm`.
- Earth's max antipodal distance is ~20,037 km, so the 20,000 km cap is
  effectively "anywhere".
