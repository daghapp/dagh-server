# Frontend Guide — Tour Sites, Destination Details & Galleries

This guide is for the web/mobile frontend consuming the DAGH tour catalogue.
It covers the fields and endpoints added for the **destination detail page**:
long-form history, hero images with attribution, the moderated photo gallery,
and user-submitted tour sites.

All endpoints are relative to the API host (for example
`https://dagh-server-fo64.onrender.com`). Responses use the standard envelope:

```ts
// success
{ success: true, data: T, message?: string }

// error
{ success: false, error: string | { code: string; message: string }, details?: unknown }
```

The catalogue is **156 seeded sites across all 16 regions**. Every seeded site
has `history`, `imageUrl` and `imageCredit`, and one approved gallery photo.
Gallery items can also be user experiences: a caption, an optional image, or
both.

---

## 1. Data model

### `TourSite` (catalogue row)

```ts
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

interface TourSite {
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
  categories: string[];
  transit_profile: TransitProfile; // snake_case in the catalogue
  createdAt: string;
}
```

Rendering rules:

- `history` is long-form text for the detail page. Render it when present and
  fall back to `description` when it is `null`.
- `imageUrl` is the hero image. Show a placeholder when it is `null`. Hero URLs are returned as-is (full resolution) for Wikimedia sources to ensure they render reliably; other supported sources may still be optimized.
- `imageCredit` is attribution text (for example `"Wikimedia Commons"`). Render
  it only when present, typically as a small caption under the hero or in the
  lightbox.
- `transit_profile` is **snake_case** in this payload. Inside generated
  itineraries it is **camelCase** (`transitProfile`). Do not mix them up.
- `categories` is an array of supplementary album tags. `category` is the
  primary enum value.

### `AlbumSite` (album payload)

```ts
interface AlbumSite {
  id: string;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  category: SiteCategory;
  history: string | null;
  imageUrl: string | null;
  imageCredit: string | null;
  transitProfile: TransitProfile | null;
}
```

Album sites intentionally do **not** include `description` or `categories`.
Use the catalogue endpoint (`GET /itinerary/sites`) when you need the full row,
or navigate to the detail page with the `id` and reuse a cached catalogue row.

### `SitePhoto` (gallery item)

```ts
type PhotoStatus = "PENDING" | "APPROVED" | "REJECTED";

interface SitePhoto {
  id: string;
  tourSiteId: string;
  uploaderId: string | null;
  caption: string | null;
  url: string | null; // null for text-only experience posts
  publicId: string | null;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  status: PhotoStatus;
  rejectReason: string | null;
  moderatedBy: string | null;
  moderatedAt: string | null;
  createdAt: string;
}
```

For gallery grids prefer `thumbUrl ?? url`; use `url` for the lightbox. When both
`caption` and `url` are present render the caption under the image. Text-only
posts have `url: null` and should be rendered as a caption card.

### `PendingSite` (user submission)

```ts
type PendingSiteStatus = "pending" | "approved" | "rejected";

interface PendingSite {
  id: string;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  description: string | null;
  history: string | null;
  category: string; // free-text tag, normalized on approval
  imageUrl: string | null;
  imageCredit: string | null;
  status: PendingSiteStatus;
  submittedBy: string;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
}
```

---

## 2. Endpoints

### 2.1 `GET /itinerary/sites` — catalogue / site picker

Public. Returns every tour site sorted by region then name. There is no
pagination (the catalogue is ~156 rows), so cache the response and filter
client-side for the picker or map.

**Response `200`**

```json
{
  "success": true,
  "data": [
    {
      "id": "9f2b1c3d-4e5f-4a6b-8c7d-1e2f3a4b5c6d",
      "name": "Kakum National Park",
      "region": "Central",
      "latitude": 5.35,
      "longitude": -1.3833,
      "description": "Rainforest canopy walkway…",
      "history": "Protected as a national park in 1992…",
      "imageUrl": "https://…/Kakum.jpg",
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

Use this endpoint to bootstrap a deep-linked detail page by finding the row
whose `id` matches the route parameter. There is currently no
`GET /itinerary/sites/:siteId` detail endpoint; only
`GET /itinerary/sites/:siteId/mobility` exists.

### 2.2 `GET /tours/albums` — album index

Public. Returns two browse lists:

```json
{
  "success": true,
  "data": {
    "categories": [
      {
        "key": "category:Nature",
        "title": "Nature",
        "coverImage": "https://…",
        "siteCount": 34,
        "packageCount": 2
      }
    ],
    "regions": [
      {
        "key": "region:Central",
        "title": "Central",
        "coverImage": "https://…",
        "siteCount": 12
      }
    ]
  },
  "message": "Albums retrieved successfully"
}
```

Use `key` as the route value after splitting on the first `:` if needed, or use
`title` with the category/region endpoints.

### 2.3 `GET /tours/albums/category/:tag` and `/tours/albums/region/:region`

Public. Query: `page` (default `1`), `limit` (default `20`, max `100`).
Matching is case-insensitive. Package results are capped at 20.

**Response `200`**

```json
{
  "success": true,
  "data": {
    "album": {
      "key": "region:Central",
      "type": "region",
      "title": "Central",
      "coverImage": "https://…",
      "siteCount": 12,
      "packageCount": 4
    },
    "sites": [
      {
        "id": "…",
        "name": "Kakum National Park",
        "region": "Central",
        "latitude": 5.35,
        "longitude": -1.3833,
        "category": "NATURE",
        "history": "Protected as a national park in 1992…",
        "imageUrl": "https://…",
        "imageCredit": "Wikimedia Commons",
        "transitProfile": "PERI_URBAN"
      }
    ],
    "tours": [],
    "pagination": { "total": 12, "page": 1, "limit": 20, "totalPages": 1 }
  },
  "message": "Region album retrieved successfully"
}
```

Errors: `400` when the tag/region is empty, `500` on failure.

### 2.4 `GET /itinerary/:tourRequestId` — generated itinerary

Bearer auth. Each `days[].sites[].site` includes the detail fields:

```json
{
  "visitOrder": 1,
  "site": {
    "id": "…",
    "name": "Kakum National Park",
    "region": "Central",
    "latitude": 5.35,
    "longitude": -1.3833,
    "description": "Rainforest canopy walkway…",
    "history": "Protected as a national park in 1992…",
    "imageUrl": "https://…",
    "imageCredit": "Wikimedia Commons",
    "category": "NATURE",
    "transitProfile": "PERI_URBAN"
  },
  "availableAccomodation": null,
  "accommodationOptions": [],
  "publicTransportOptions": [],
  "mobility": null
}
```

Note the field name `availableAccomodation` (one `m`) is intentional and
unrelated to `accommodationOptions`.

### 2.5 `GET /tour-sites/:siteId/photos` — approved gallery

Public. Query: `page` (default `1`), `limit` (default `20`, max `100`). Only
`APPROVED` photos are returned, newest first.

**Response `200`**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "…",
        "tourSiteId": "…",
        "uploaderId": null,
        "caption": "The canopy walk at sunrise was unforgettable.",
        "url": "https://…/photo.jpg",
        "publicId": "seed-gallery:Kakum National Park",
        "thumbUrl": "https://…/photo.jpg",
        "width": null,
        "height": null,
        "sizeBytes": null,
        "status": "APPROVED",
        "rejectReason": null,
        "moderatedBy": null,
        "moderatedAt": "2026-10-29T…",
        "createdAt": "2026-10-29T…"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

Pagination lives **inside `data`**, unlike the album endpoints. Errors: `400`
invalid query, `404` site not found, `500`.

### 2.6 `POST /tour-sites/:siteId/photos` — submit an experience

Bearer auth. Submit an experience with a caption, a photo, or both:

- `multipart/form-data`: `caption` (text) and/or `image` (file).
- `application/json`: `{ "caption": "…" }` for a text-only experience.

Constraints:

- Caption: optional only when an image is attached; max 2000 characters.
- Formats: JPEG or PNG.
- Maximum size: 10 MB.
- Minimum resolution: 800 × 600.
- The submission is stored with `status: "PENDING"` and only appears publicly
  after an admin approves it.

**Response `201`** returns the created `SitePhoto` (with its `id`,
`caption`, and `status: "PENDING"`) inside the standard success envelope.
Text-only posts have `url: null`.

Errors: `400` (no caption and no image, wrong format, too large, too small),
`401`, `404` tour site not found, `500`.

### 2.6.1 `PATCH /tour-sites/:siteId/photos/:photoId` — edit your caption

Bearer auth, owner only. JSON body `{ "caption": "…" }` (1–2000 chars).
Editing resets the submission to `PENDING` so the new text is moderated again.
Errors: `400` invalid caption, `401`, `403` not the owner, `404`, `500`.

### 2.6.2 `DELETE /tour-sites/:siteId/photos/:photoId` — delete an experience

Bearer auth, owner or admin. Removes the gallery item and its Cloudinary asset.
Errors: `401`, `403` not the owner, `404`, `500`.

### 2.7 `POST /pending-sites` — submit a missing site

Bearer auth. JSON body:

```json
{
  "name": "Wli Waterfalls",
  "region": "Volta",
  "latitude": 7.0131,
  "longitude": 0.5126,
  "description": "The highest waterfall in West Africa…",
  "history": "Long used as a sacred site by the communities around Hohoe…",
  "category": "Nature / Waterfall",
  "imageUrl": "https://…/wli.jpg",
  "imageCredit": "Wikimedia Commons"
}
```

Validation:

| Field                    | Rules                                                                 |
| ------------------------ | --------------------------------------------------------------------- |
| `name`                   | 3–100 chars, unique (case-insensitive) against live and pending sites |
| `region`                 | One of the 16 Ghana regions                                           |
| `latitude` / `longitude` | Must fall inside Ghana's bounding box                                 |
| `description`            | Optional, 10–2000 chars                                               |
| `history`                | Optional, max 5000 chars                                              |
| `category`               | Optional free text, max 50 chars (normalized on approval)             |
| `imageUrl`               | Optional valid URL                                                    |
| `imageCredit`            | Optional, max 200 chars                                               |

**Response `201`** returns the full `PendingSite` row. Errors: `400`
validation, `401`, `409` duplicate name, `500`.

### 2.8 `GET /pending-sites/mine` — my submissions

Bearer auth. Returns the caller's submissions newest first. Selected fields:
`id`, `name`, `region`, `category`, `status`, `rejectReason`, `createdAt`,
`imageUrl`, `imageCredit`. (`history` is kept on the row and in the moderation
queue, but is not part of this list response.)

---

## 3. Admin console endpoints

Only relevant to the admin frontend.

| Method | Endpoint                                        | Auth  | Notes                                                                      |
| ------ | ----------------------------------------------- | ----- | -------------------------------------------------------------------------- |
| POST   | `/tour-sites/admin`                             | Admin | Add a live site directly; requires `tours.edit`                            |
| GET    | `/pending-sites/admin?status=&page=&limit=`     | Admin | `status` = `pending`, `approved`, `rejected`, or omit for all              |
| POST   | `/pending-sites/admin/:siteId/approve`          | Admin | Copies `description`, `history`, `imageUrl`, `imageCredit` to `tour_sites` |
| POST   | `/pending-sites/admin/:siteId/reject`           | Admin | Body `{ "rejectReason": "…" }` (5–500 chars)                               |
| GET    | `/tour-sites/admin/photos?status=&page=&limit=` | Admin | Moderation queue; defaults to `PENDING`, includes `tourSite.name`/`region` |
| POST   | `/tour-sites/admin/photos/:photoId/approve`     | Admin | Photo becomes public                                                       |
| POST   | `/tour-sites/admin/photos/:photoId/reject`      | Admin | Body `{ "rejectReason": "…" }` (5–500 chars)                               |

Moderation errors: `404` photo not found, `409` already moderated, `400`
invalid reason, `403` missing admin role.

### 3.1 `POST /tour-sites/admin` — add a site directly

Admin only (`tours.edit`). Creates a live `TourSite` without the pending
review queue. Body matches the `POST /pending-sites` shape, except
`description` is **required**:

```json
{
  "name": "Wli Waterfalls",
  "region": "Volta",
  "latitude": 7.0131,
  "longitude": 0.5126,
  "description": "The highest waterfall in West Africa…",
  "history": "Long used as a sacred site…",
  "category": "Nature / Waterfall",
  "categories": ["Hiking"],
  "imageUrl": "https://…/wli.jpg",
  "imageCredit": "Wikimedia Commons"
}
```

`category` is free text and is normalized into the `SiteCategory` enum;
`categories` adds extra album tags (merged with the tag derived from
`category`). `transit_profile` is derived from `region`. Responds `201` with
the created row; `409` when the name already exists (case-insensitive).

---

## 4. UI recipes

### 4.1 Destination detail page

1. Resolve the site:
   - From a list/map: keep the selected `TourSite` in state/cache.
   - From a deep link: call `GET /itinerary/sites`, then `find(site => site.id === id)`.
2. Render the hero:
   ```tsx
   {
     site.imageUrl ? (
       <img
         src={site.imageUrl}
         alt={site.name}
         onError={(e) => {
           e.currentTarget.src = "/images/site-placeholder.jpg";
         }}
       />
     ) : (
       <img src="/images/site-placeholder.jpg" alt={site.name} />
     );
   }
   {
     site.imageCredit && <small>Photo: {site.imageCredit}</small>;
   }
   ```
3. Render the history, falling back to the description:
   ```tsx
   <p>{site.history ?? site.description}</p>
   ```
4. Fetch the gallery:
   ```ts
   const res = await fetch(`${API}/tour-sites/${site.id}/photos?page=1&limit=20`);
   const { data } = await res.json();
   // data.items, data.totalPages
   ```
5. Render `thumbUrl ?? url` in the grid and `url` in the lightbox.
6. Add a "Load more" button while `page < totalPages`.

### 4.2 Missing images and content

- `imageUrl` and `imageCredit` can be `null`; always render a placeholder and
  only show the credit line when a credit exists.
- `history` can be `null`; fall back to `description`.
- On image load failure, swap to the placeholder rather than showing a broken
  icon.

### 4.3 Caching

`GET /itinerary/sites` is public and changes only when the catalogue is synced.
Cache it (memory + `stale-while-revalidate`) and reuse it for the picker,
detail bootstrap and album fallbacks. The gallery and album endpoints are also
public and can be cached briefly.

---

## 5. Gotchas

- **Snake vs camel:** `GET /itinerary/sites` uses `transit_profile`; albums and
  itineraries use `transitProfile`.
- **Album sites are lean:** they have no `description` and no `categories`.
- **Gallery pagination shape:** the gallery response nests pagination under
  `data` (`data.page`, `data.totalPages`), not at the top level.
- **Uploads are moderated:** a successful upload returns `201` with
  `status: "PENDING"`; it will not appear in `GET /tour-sites/:siteId/photos`
  until approved.
- **Newly approved sites and galleries:** approving a `PendingSite` copies its
  image to `TourSite.imageUrl`, but does not create a gallery row immediately.
  The next catalogue sync adds one.
- **Seeded images are illustrative in a few cases:** the catalogue uses
  Wikimedia Commons URLs with a generic `"Wikimedia Commons"` credit. Some
  obscure sites use a representative regional/category photo; do not treat the
  image as a guarantee of the exact location.
- **No site-by-id endpoint:** deep links must resolve the id against
  `GET /itinerary/sites` (or pass the row through navigation state).
- **Google Maps key:** not required by any of these endpoints. The current
  server key is Android-app-restricted and cannot be used for server-side
  Google calls.

---

## 6. Quick reference

```ts
const API = import.meta.env.VITE_API_URL; // your configured base URL

// catalogue
const sites = await fetch(`${API}/itinerary/sites`).then((r) => r.json());

// albums
const albums = await fetch(`${API}/tours/albums`).then((r) => r.json());
const region = await fetch(`${API}/tours/albums/region/Central?page=1&limit=20`).then((r) =>
  r.json(),
);

// gallery
const gallery = await fetch(`${API}/tour-sites/${siteId}/photos?page=1&limit=20`).then((r) =>
  r.json(),
);

// upload (authenticated)
const form = new FormData();
form.append("image", file);
const uploaded = await fetch(`${API}/tour-sites/${siteId}/photos`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: form,
}).then((r) => r.json());

// submit a missing site (authenticated)
const submission = await fetch(`${API}/pending-sites`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "Wli Waterfalls",
    region: "Volta",
    latitude: 7.0131,
    longitude: 0.5126,
    description: "The highest waterfall in West Africa…",
    history: "Long used as a sacred site by the communities around Hohoe…",
    imageUrl: "https://…/wli.jpg",
    imageCredit: "Wikimedia Commons",
  }),
}).then((r) => r.json());
```
