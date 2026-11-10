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
| `maxDistanceKm` | 50 | Used only when `globalDiscovery = false` and a location is set. Capped at 20,000 km. |
| `locationLat` / `locationLng` / `locationName` | null | User's chosen center point for nearby matching. |
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
