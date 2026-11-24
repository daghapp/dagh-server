# Dating Module Enhancements — Documentation

## Overview

This document describes all enhancements made to the DAGH dating module, including safety features, recommendation UX improvements, manual profile discovery, and social sharing with images. All changes are **backend-only** and compile without database migration.

---

## Table of Contents

1. [Safety & Moderation](#1-safety--moderation)
2. [Recommendation Enhancements](#2-recommendation-enhancements)
3. [Manual Profile Discovery](#3-manual-profile-discovery)
4. [Sharing Profiles with Images](#4-sharing-profiles-with-images)
5. [Audit & Compliance](#5-audit--compliance)
6. [Files Modified](#6-files-modified)
7. [API Reference](#7-api-reference)
8. [Pending: Prisma Schema Migration](#8-pending-prisma-schema-migration)

---

## 1. Safety & Moderation

### 1.1 Block User

**Endpoint:** `POST /dating/block/{targetId}`

**Description:** Blocks a user, preventing them from appearing in recommendations and blocking all future interaction. The action is audit-logged.

**Request:**
```
POST /dating/block/{targetId}
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "success": true,
  "data": null,
  "message": "User blocked successfully"
}
```

**Response (400):** Cannot block yourself
**Response (409):** User is already blocked

**Implementation:**
- Creates a `UserBlock` record (bidirectional check)
- Logs to `dating_activity_logs` with `entityType: "BLOCK"`, `action: "USER_BLOCKED"`
- Blocked users are filtered out of `GET /dating/recommendations` results

**Controller:** `src/modules/dating/swipe.controller.ts` → `blockUser`

---

### 1.2 Report User

**Endpoint:** `POST /dating/report/{targetId}`

**Description:** Flags a user for moderation with a reason. The action is audit-logged.

**Request:**
```json
POST /dating/report/{targetId}
Authorization: Bearer <token>
Content-Type: application/json

{
  "reason": "Inappropriate behavior"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": null,
  "message": "User reported successfully. Moderation will review."
}
```

**Response (400):** Cannot report yourself or missing reason
**Response (409):** User is already blocked or reported

**Implementation:**
- Creates a `UserReport` record with `status: PENDING`
- Logs to `dating_activity_logs` with `entityType: "REPORT"`, `action: "USER_REPORTED"`
- Tracks `reporterId`, `targetId`, `reason`

**Controller:** `src/modules/dating/swipe.controller.ts` → `reportUser`

---

## 2. Recommendation Enhancements

### 2.1 Overview

All enhancements are applied to the existing `GET /dating/recommendations` endpoint. No new endpoints were created. Each candidate in the response now includes additional fields.

### 2.2 New Fields in Response

| Field | Type | Description |
|---|---|---|
| `isPrimary` | `boolean` | `true` if the candidate's first photo is the primary profile image |
| `photoCount` | `number` | How many photos the candidate has (0-9) |
| `photoRatio` | `number` | Profile photo completeness ratio (0-100%), calculated as `(photoCount / 9) * 100` |
| `reasons` | `String[]` | Top 3 reasons why this candidate was recommended (e.g., `"Shared 3 interests"`, `"Complete profile"`, `"Nearby (5km)"`, `"Great match"`) |
| `isLuckyToday` | `boolean` | 30% daily chance — candidate marked as "surprise me" to encourage exploration outside normal preferences |
| `stackType` | `String` | Curated stack assignment: `"MOST_COMPATIBLE"` (first 3 candidates), `"NEW_PROFILES"` (last 1-2 candidates), `"NONE"` (all others) |

### 2.3 Implementation Details

**Primary Photo Highlight (`isPrimary`):**
- Calculated as: `photoCount > 0 && c.profileImage === c.photos[0]`
- Helps users quickly identify the main profile picture vs. additional photos

**Photo Count Badge (`photoCount`, `photoRatio`):**
- `photoCount`: `c.photos?.length || 0`
- `photoRatio`: `Math.round((photoCount / 9) * 100)`
- Encourages profile completeness by showing users how many photos others have

**"Why This Profile?" Reasons (`reasons`):**
- Built from available candidate data:
  - Interest count: `"Has 3 interests"` or `"Has multiple interests"`
  - Age: `"28+"` (age indicator)
  - Profile completeness: `"Complete profile"` (15+ points) or `"Almost complete"` (5+ points)
  - Distance: `"Nearby (5km)"` (within 50km)
  - Default: `"Great match"` (if no specific reasons found)
- Returns top 3 reasons only (`reasons.slice(0, 3)`)

**"Surprise Me" Gamified Button (`isLuckyToday`):**
- 30% chance per candidate to mark as "surprise me"
- Encourages users to explore candidates outside their normal filter bubble
- Daily tracking to be implemented with cooldown store in future

**Curated Stacks (`stackType`):**
- `"MOST_COMPATIBLE"`: First 3 candidates (highest scored)
- `"NEW_PROFILES"`: Last 1-2 candidates (recently created profiles)
- `"NONE"`: All other candidates
- Helps surface variety and fresh profiles without overwhelming the user

**Controller:** `src/modules/dating/swipe.controller.ts` → `getRecommendations`

---

## 3. Manual Profile Discovery

### 3.1 Search by Name

**Endpoint:** `GET /dating/profile/search?name={name}`

**Description:** Find a user's public dating profile by name. Search is
case-insensitive and matches `fullName` or `username`. When OpenSearch is
configured it is fuzzy/typo-tolerant and relevance-ranked; otherwise the
endpoint falls back to Postgres `contains`.

**Request:**
```
GET /dating/profile/search?name=john
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "userId": "...",
    "headline": "...",
    "about": "...",
    "photos": [...],
    "user": { ... },
    "ogTitle": "John Doe's Dating Profile",
    "ogDescription": "Looking for long-term partner",
    "ogImage": "https://...",
    "ogUrl": "http://app.com/dating/profile/search?username=john_doe"
  }
}
```

**Response (400):** Name is required or empty
**Response (404):** User not found or profile not created
**Response (403):** Cannot view this profile (blocked or same gender)

**Implementation:**
- Searches OpenSearch (`fullName`, `username`, `headline`, `about`) with fuzziness
- Falls back to `fullName`/`username` `contains` in Postgres when search is off
- Includes block check (bidirectional) and opposite-gender filter
- Returns full dating profile with user info
- Includes OG metadata for social sharing

**Controller:** `src/modules/dating/dating.controller.ts` → `getDatingProfileByName`

---

### 3.1a Name Suggestions

**Endpoint:** `GET /dating/profile/suggestions?name={name}`

**Description:** Lightweight typeahead suggestions. Returns up to 10 matching
opposite-gender users (`id`, `fullName`, `username`, `profileImageUrl`). Uses the
same OpenSearch query with a Postgres fallback.

**Controller:** `src/modules/dating/dating.controller.ts` → `getDatingProfileSuggestions`

### OpenSearch configuration

Set `OPENSEARCH_NODE` (and optionally `OPENSEARCH_USERNAME`,
`OPENSEARCH_PASSWORD`, `OPENSEARCH_INDEX`, `OPENSEARCH_TIMEOUT_MS`). Without
`OPENSEARCH_NODE`, search uses the Postgres fallback. After enabling it, run:

```bash
npm run search:reindex
```

Profile create/update/deactivate keeps the index in sync automatically.

---

### 3.2 Share Profile Link

**Endpoint:** `GET /dating/profile/share`

**Description:** Generate a shareable profile link with the user's primary image URL. Useful for sharing via social media, QR codes, or invites.

**Request:**
```
GET /dating/profile/share
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "shareUrl": "http://app.com/dating/profile/share",
    "url": "http://app.com/dating/profile/share",
    "primaryImage": "https://app.com/uploads/photos/john/primary.jpg",
    "note": "Shareable profile link generated"
  }
}
```

**Implementation:**
- Returns the user's dating profile primary photo URL
- `primaryImage` = `profile.photos[0]` or fallback to `bio_profile_image_url`
- Frontend appends username to create the final shareable URL

**Controller:** `src/modules/dating/dating.controller.ts` → `getDatingProfileShare`

---

## 4. Sharing Profiles with Images

### 4.1 Overview

When a user shares their dating profile on social media (Twitter/X, Facebook, LinkedIn, etc.), the preview card will include the user's photo — but only if the frontend renders the Open Graph meta tags.

### 4.2 Backend Data (Ready)

The `GET /dating/profile/search?username=` endpoint now returns OG metadata:

| Field | Source | Example |
|---|---|---|
| `ogTitle` | `user.fullName + "'s Dating Profile"` | `"John Doe's Dating Profile"` |
| `ogDescription` | `headline + about` (trimmed) | `"Looking for long-term partner"` |
| `ogImage` | `profile.photos[0]` or `bio_profile_image_url` fallback | `"https://app.com/uploads/photos/john/primary.jpg"` |
| `ogUrl` | Profile search URL | `"http://app.com/dating/profile/search?username=john_doe"` |

### 4.3 Frontend Requirement

The profile search page must render these OG tags in the HTML `<head>`:

```html
<meta property="og:title" content="John Doe's Dating Profile">
<meta property="og:description" content="Looking for long-term partner">
<meta property="og:image" content="https://app.com/uploads/photos/john/primary.jpg">
<meta property="og:url" content="http://app.com/dating/profile/search?username=john_doe">
<meta property="og:type" content="website">
<meta property="og:sitename" content="DAGH Dating">
```

### 4.4 Why This Matters

Profile images are the **primary attraction factor** in dating apps. When sharing without images:
- Social media shows generic preview or just the URL text
- Users are less likely to click through
- The "cold link" problem reduces engagement

With OG tags:
- Social media displays a rich preview card with the user's photo
- Higher click-through rates
- Better user acquisition through organic sharing

---

## 5. Audit & Compliance

### 5.1 Dating Activity Log

A new `DatingActivityLog` Prisma model was added to track all dating-related actions:

```prisma
model DatingActivityLog {
  id         String   @id @default(uuid())
  actorId    String
  entityType String   // e.g., "BLOCK", "REPORT", "SWIPE"
  entityId   String
  action     String   // e.g., "USER_BLOCKED", "USER_REPORTED", "SWIPE_LIKE"
  note       String?
  metadata   Json?
  createdAt  DateTime @default(now())

  @@index([actorId])
  @@index([entityType, entityId])
  @@index([createdAt])
  @@map("dating_activity_logs")
}
```

### 5.2 Logged Actions

| Action | entityType | action | note |
|---|---|---|---|
| Block user | `BLOCK` | `USER_BLOCKED` | `User {userId} blocked {targetId}` |
| Report user | `REPORT` | `USER_REPORTED` | `User {userId} reported {targetId}: {reason}` |
| Swipe | `SWIPE` | `SWIPE_LIKE` / `SWIPE_PASS` / `SWIPE_SUPER_LIKE` | `User {swiperId} swiped {direction} on target {targetId}` |

### 5.3 Admin Entity Type

Added `DATING` to the `AdminEntityType` enum in `src/helpers/admin-activity.ts`:

```typescript
export const AdminEntityType = {
  // ... existing types ...
  DATING: "DATING",
} as const;
```

### 5.4 Helper Function

**File:** `src/helpers/dating-activity.ts`

```typescript
export function logDatingActivity(input: LogDatingActivityInput) {
  return prisma.datingActivityLog.create({
    data: {
      actorId: input.actorId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      note: input.note ?? null,
      ...(input.metadata ? { metadata: input.metadata as object } : {}),
    },
  });
}
```

---

## 6. Files Modified

| File | Change |
|---|---|
| `src/modules/dating/swipe.controller.ts` | Block/report controllers, cooldown logic, recommendation enhancements (isPrimary, photoCount, photoRatio, reasons, isLuckyToday, stackType) |
| `src/modules/dating/dating.controller.ts` | `getDatingProfileByUsername`, `getDatingProfileShare` controllers, OG metadata in profile search |
| `src/routes/dating.routes.ts` | Added routes for `/block/:targetId`, `/report/:targetId`, `/profile/search`, `/profile/share` |
| `src/helpers/admin-activity.ts` | Added `DATING` entity type |
| `src/helpers/dating-activity.ts` | **New file** — dating activity logging helper |
| `prisma/schema.prisma` | Added `DatingActivityLog` model |
| `README.md` | Documentation updated |

---

## 7. API Reference

### New Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/dating/block/{targetId}` | Block a user |
| `POST` | `/dating/report/{targetId}` | Report a user for moderation |
| `GET` | `/dating/profile/search?username=` | Find user by username |
| `GET` | `/dating/profile/share` | Generate shareable profile link |

### Modified Endpoints

| Method | Path | New Fields/Behavior |
|---|---|---|
| `GET` | `/dating/recommendations` | Added: `isPrimary`, `photoCount`, `photoRatio`, `reasons`, `isLuckyToday`, `stackType` |
| `GET` | `/dating/profile/search?username=` | Added: `ogTitle`, `ogDescription`, `ogImage`, `ogUrl` |

---

## 8. Pending: Prisma Schema Migration

The following features require database schema changes and are deferred:

| Feature | Schema Change Required |
|---|---|
| **Photo verified badge** | Add `photoVerified: Boolean @default(false)` to `DatingProfile` model |
| **Expanded filters** | Add `educationLevel`, `drinkSmoke`, `zodiacSign` to `User`/`DatingProfile` models |
| **Behavioral learning** | New tables: `user_swipe_feedback`, `preference_drift` |
| **Last active** | Add `lastActiveAt: DateTime?` to `User` model |

These can be implemented in a follow-up session when database migration is acceptable.

---

## 9. Testing & Verification

- **TypeScript:** `npx tsc --noEmit` → **zero errors** in the dating module
- **Compilation:** All new code compiles with existing Prisma schema (no migration needed)
- **Pattern:** Follows existing codebase conventions (controller → service → Prisma, Zod validation, standard response format)

---

## 10. Architecture Notes

### Recommendation Flow (Updated)

```
GET /dating/recommendations
  │
  ├── 1. KYC verification gate
  │
  ├── 2. Travel context (optional, from tourRequestId)
  │
  ├── 3. getDiscoveryCandidates(userId, filters, travel)
  │       └── Applies: hard opposite-gender rule, age range, distance, location, global discovery
  │       └── Excludes: self, PASS swipes, blocked users, hidden profiles
  │
  ├── 4. Enrich candidates with:
  │       ├── relationshipStatus (NONE, INTEREST_SENT, INTEREST_RECEIVED, MATCHED, PASSED, BLOCKED)
  │       ├── canSendInterest
  │       ├── isPrimary (photo highlight)
  │       ├── photoCount, photoRatio (profile completeness)
  │       ├── reasons[] (top 3 "why this profile?" factors)
  │       ├── isLuckyToday (30% surprise chance)
  │       └── stackType (curated stack assignment)
  │
  └── 5. Return ranked candidates
```

### Share Profile Flow

```
GET /dating/profile/share
  │
  ├── 1. Get user's dating profile (photos, headline, about)
  ├── 2. Extract primaryImage = photos[0] || bio_profile_image_url
  ├── 3. Return { shareUrl, url, primaryImage, note }
  │
  └── Frontend appends username to shareUrl
  └── Social media crawls URL → renders OG tags → shows primary image in preview
```

---

## 11. Gender compliance hardening

- `src/helpers/dating-gender.ts` is the single source of truth for gender
  normalization and opposite-gender compatibility.
- Discovery fails closed: an empty compatibility list returns zero candidates,
  and the Prisma query always includes `gender IN (<opposite gender>)`.
- The same compatibility helper now guards swipes, likes received/sent, matches,
  relationship status, direct profile lookup, name search/suggestions, dating
  contacts, tour dating selections, and proximity alerts.
- Write validators normalize `woman`/`man`/case/whitespace/separator variants and
  reject unknown gender values. Migration
  `20261124000000_normalize_user_gender` cleans legacy rows and adds a database
  `CHECK` constraint.
- `genderPreference` remains accepted by `PUT /dating/preferences` for client
  storage but is ignored by the server compliance rule.

---

*Document generated for the DAGH dating module enhancements.*
