# Frontend Guide: Pending (User-Submitted) Tour Sites

Reference for the frontend team to design the **submit-a-missing-site**, **my submissions**, and **admin moderation** pages. Backend endpoints are mounted under `/pending-sites`.

## 1. Overview & lifecycle

A non-admin user can propose a new tour site. It lands in the `pending_sites` staging table with status `pending`, admins review it, and either:

- **Approve** → the row is migrated into the live `tour_sites` catalogue (category normalized, transit profile derived, images carried over). Submitter is emailed.
- **Reject** → row stays in `pending_sites` with `status = rejected` and a `rejectReason`. Submitter is emailed and may resubmit.

Statuses: `pending` → `approved` | `rejected`. There is no "in review" sub-state.

```
user submits ──► pending ──► admin approves ──► approved (live tour_site created)
                  │
                  └──► admin rejects ──► rejected (reason stored) ──► user resubmits (new row)
```

Resubmission is done by submitting a **new** `POST /pending-sites` (the rejected row is not edited in place). A rejected name is allowed again because the duplicate guard only blocks `pending` rows and live `tour_sites`.

## 2. Data model (`PendingSite`)

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | |
| `name` | string | 3–100 chars |
| `region` | string | one of 16 Ghana regions |
| `latitude` / `longitude` | number | Ghana bounding box |
| `description` | string \| null | |
| `history` | string \| null | long-form background |
| `category` | string | free text from submitter; normalized on approval |
| `imageUrl`, `imageUrl2`, `imageUrl3`, `imageUrl4` | string \| null | up to 4 images |
| `imageCredit` | string \| null | attribution for the photo(s) |
| `status` | `"pending"` \| `"approved"` \| `"rejected"` | |
| `submittedBy` | uuid | user id |
| `rejectReason` | string \| null | set on rejection (5–500 chars) |
| `moderatedBy` | uuid \| null | admin who decided |
| `moderatedAt` | ISO date-time \| null | when decided |
| `createdAt` / `updatedAt` | ISO date-time | |

On approval the following are copied to `tour_sites`: `name`, `region`, `latitude`, `longitude`, `description`, `history`, `imageUrl`, `imageCredit`. `category` is normalized via keyword map to the `SiteCategory` enum and the user's wording is preserved as an album tag (`categories`) when it does not duplicate the enum name. `transit_profile` is derived from `region`.

## 3. User pages

### 3.1 Submit a missing site — `POST /pending-sites`

Bearer auth. Body:

```json
{
  "name": "Wli Waterfalls",
  "region": "Volta",
  "latitude": 7.0131,
  "longitude": 0.5126,
  "description": "The highest waterfall in West Africa…",
  "history": "Long used as a sacred site…",
  "category": "Nature / Waterfall",
  "imageUrl": ["https://…/1.jpg", "https://…/2.jpg"],
  "imageCredit": "Wikimedia Commons"
}
```

Required: `name`, `region`, `latitude`, `longitude`. `imageUrl` may be a single string **or** an array of up to 4 URLs (see `docs/TOUR_SITE_IMAGES_GUIDE.md`).

Validation rules:

| Field | Rules |
|-------|-------|
| `name` | 3–100 chars; unique (case-insensitive) vs live **and** pending sites |
| `region` | one of the 16 Ghana regions |
| `latitude` | 4.5–11.5 |
| `longitude` | -3.3–1.3 |
| `description` | optional, 10–2000 chars |
| `history` | optional, max 5000 chars |
| `category` | optional free text, max 50 chars |
| `imageUrl` | optional valid URL or array (max 4) |
| `imageCredit` | optional, max 200 chars |

Response `201` returns the full `PendingSite` row. Errors: `400` validation, `401` unauthenticated, `409` duplicate name, `500`.

UI recipe:

1. Form with name/region/map-picker (lat/lng)/description/history/category/image uploader/credit.
2. On submit, show spinner; on `201` show "Submitted for review" toast and reset form; offer "View my submissions".
3. On `409`, inline error under name: "A site with this name already exists or is pending review."
4. Images: collect 1–4 URLs (upload via `POST /upload` first if needed), send as array when >1.

### 3.2 My submissions — `GET /pending-sites/mine`

Bearer auth. Returns the caller's submissions newest first. Selected fields:

`id`, `name`, `region`, `category`, `status`, `rejectReason`, `moderatedBy`, `moderatedAt`, `createdAt`, `imageUrl`, `imageCredit`.

(`history`, `imageUrl2/3/4`, coordinates are kept on the row but are **not** part of this list response — use the admin queue or re-fetch if needed.)

UI recipe:

- List cards with status badge: `pending` (amber), `approved` (green), `rejected` (red).
- Rejected cards show `rejectReason` in an alert and a "Resubmit" button that re-opens the submit form pre-filled with the row's data (the user submits a new row).
- Approved cards link to the live site (search `tour_sites` by name) / show "Now live".
- Empty state: "You haven't submitted any sites yet."

## 4. Admin pages

All admin endpoints require `accountType = ADMIN` (`requireRole(["ADMIN"])`). Bearer auth.

### 4.1 Moderation queue — `GET /pending-sites/admin?status=&page=&limit=`

- `status`: `pending` | `approved` | `rejected`, or omit for all.
- `page` default 1, `limit` default 20 (max 100).
- Returns `{ sites, total, page, limit }`, newest first.

Each `site` is the full row (all fields incl. `imageUrl2/3/4`, `history`, `moderatedBy`, `moderatedAt`).

UI recipe:

- Tabs: Pending / Approved / Rejected / All with counts.
- Table/card list with name, region, submitter, category, submitted date, status.
- Click row → detail drawer showing description, history, all images, coordinates map, credit, moderation audit (moderatedBy/moderatedAt).
- Pagination controls using `total`.

Errors: `400` invalid status, `401`, `403` not admin, `500`.

### 4.2 Approve — `POST /pending-sites/admin/:siteId/approve`

No body. On success returns `{ siteId, tourSiteId }`. The new `tourSiteId` can be used to navigate to the live site.

Errors: `400` not pending, `401`, `403`, `404` not found, `409` name conflict (a live site with that name now exists), `500`.

UI recipe: confirm dialog "Approve and publish this site?"; on success toast + remove from pending tab; optionally navigate to `/tour-sites/:tourSiteId`.

### 4.3 Reject — `POST /pending-sites/admin/:siteId/reject`

Body `{ "rejectReason": "…" }` (5–500 chars after trim).

Returns `{ siteId, rejectReason }`. Errors: `400` (short reason or not pending), `401`, `403`, `404`, `500`.

UI recipe: modal with textarea (min 5 chars, max 500, live counter); submit; on success toast + move to rejected tab.

## 5. State machine & badges

| status | Badge color | Admin actions available | User actions |
|--------|-------------|------------------------|--------------|
| `pending` | amber | Approve / Reject | View only |
| `approved` | green | none (already migrated) | View; link to live site |
| `rejected` | red | none | View reason; Resubmit |

## 6. Notifications

- On submission: admins receive an in-app `AdminNotification` (category `tours`) and an email (best-effort, fan-out to all active admins).
- On approval/rejection: the submitter receives an email (best-effort).

Frontend should not depend on email delivery for correctness; poll/refresh the queue and "my submissions" after actions.

## 7. Error code → HTTP status

| Code | Status | Meaning |
|------|--------|---------|
| `SITE_NOT_FOUND` | 404 | unknown id |
| `SITE_NOT_PENDING` | 400 | already approved/rejected |
| `DUPLICATE_SITE_NAME` | 409 | name exists (live or pending) |
| `NAME_CONFLICT` | 409 | race: live site created meanwhile |
| `INVALID_REJECT_REASON` | 400 | reason < 5 chars |
| `INVALID_STATUS` | 400 | bad `?status=` filter |

## 8. Audit trail

`moderatedBy` (admin id) and `moderatedAt` are set on both approve and reject. Surface them in the admin detail drawer as "Decided by {admin} on {date}". `moderatedBy` may be null for legacy rows.

## 9. Implementation checklist

- [ ] Submit form with all fields + image uploader (1–4)
- [ ] Client-side validation matching backend rules
- [ ] My submissions list with status badges + rejection reason + resubmit
- [ ] Admin queue with tabs/filters/pagination
- [ ] Approve/reject modals with confirmations
- [ ] Audit info in admin detail drawer
- [ ] Handle 409 duplicate/conflict gracefully
- [ ] Empty/loading/error states
- [ ] Link approved submissions to live `tour_sites`

## 10. Related docs

- `docs/TOUR_SITE_IMAGES_GUIDE.md` — multi-image submission & display
- `docs/frontend-tour-sites-guide.md` — live tour sites, photos, deep links
- `docs/admin-endpoints.md` — admin endpoint summary
