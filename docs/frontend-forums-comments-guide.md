# Frontend Guide: Forums & Comments (Module 3)

Reference for implementing the forum list, thread detail, discussion composer, and admin moderation screens. The backend routes are mounted at the **root** (`/forums`, `/threads`, `/comments`) and the admin routes under `/admin/forums`.

## 1. Scope & lifecycle

- A **forum** is a public container (e.g. `slug: "community"`).
- A **thread** is a post inside a forum. Creating a thread requires a verified identity.
- A **comment** belongs to a thread and may be a nested reply via `parentId`.
- All user text (thread title/body and comment body) is screened synchronously before the row is stored.

Statuses (`ModerationStatus`): `PENDING`, `APPROVED`, `FLAGGED`, `REJECTED`.

```
create thread/comment ──► screening ──► APPROVED  (visible in lists / thread detail)
                                     ├─ FLAGGED   (hidden from lists, in admin queue)
                                     └─ REJECTED  (hidden)
```

Score bands used by the backend:

| Risk score  | Resulting status | Visibility                             |
| ----------- | ---------------- | -------------------------------------- |
| `< 0.3`     | `APPROVED`       | Public list + thread detail            |
| `0.3 – 0.7` | `FLAGGED`        | Not in list; admin queue               |
| `>= 0.7`    | `REJECTED`       | Hidden; admin can still find by status |

There is no user-facing appeal endpoint for forums/comments; only the content-post module has appeals. `PENDING` rows can appear in the admin queue but normal creation does not produce them.

## 2. Data model (fields returned by the API)

### `Forum`

| Field                     | Type           | Notes                |
| ------------------------- | -------------- | -------------------- |
| `id`                      | uuid           |                      |
| `slug`                    | string         | unique; used in URLs |
| `name`                    | string         |                      |
| `description`             | string \| null |                      |
| `isPublic`                | boolean        | default `true`       |
| `createdAt` / `updatedAt` | ISO date-time  |                      |

### `ForumThread`

| Field                     | Type               | Notes                                              |
| ------------------------- | ------------------ | -------------------------------------------------- |
| `id`                      | uuid               |                                                    |
| `forumId`                 | uuid               |                                                    |
| `authorId`                | uuid               |                                                    |
| `title` / `body`          | string             | body is long-form text                             |
| `status`                  | `ModerationStatus` | see lifecycle                                      |
| `pinned` / `locked`       | boolean            | locked threads reject new comments from non-admins |
| `replyCount`              | number             | counts **approved** comments only                  |
| `lastActivityAt`          | ISO date-time      | updated when an approved comment is added          |
| `createdAt` / `updatedAt` | ISO date-time      |                                                    |
| `author`                  | `{ id, fullName }` | present in list/detail responses                   |

### `Comment`

| Field                     | Type               | Notes                                                  |
| ------------------------- | ------------------ | ------------------------------------------------------ |
| `id`                      | uuid               |                                                        |
| `threadId` / `postId`     | uuid \| null       | forum comments use `threadId`                          |
| `parentId`                | uuid \| null       | nested reply target                                    |
| `authorId`                | uuid               |                                                        |
| `body`                    | string             |                                                        |
| `status`                  | `ModerationStatus` | only `APPROVED` comments are returned in thread detail |
| `createdAt` / `updatedAt` | ISO date-time      |                                                        |
| `author`                  | `{ id, fullName }` | present in thread detail                               |

`GET /threads/:id` returns one flat array of approved comments. Build the reply tree on the client using `parentId`.

## 3. Auth & permission rules

| Action                             | Auth   | Extra requirement                                                |
| ---------------------------------- | ------ | ---------------------------------------------------------------- |
| List forums / threads, read thread | none   | public                                                           |
| Create forum                       | Bearer | `accountType === "ADMIN"`                                        |
| Create thread                      | Bearer | verified identity (`IdentityVerification.status === "APPROVED"`) |
| Create comment                     | Bearer | verified identity; thread must not be locked                     |
| Edit/delete own thread or comment  | Bearer | owner or `accountType === "ADMIN"`                               |
| Admin moderation queues            | Bearer | `CONTENT.VIEW` permission                                        |
| Admin approve/reject               | Bearer | `CONTENT.MODERATE` permission                                    |

Bearer tokens are the normal access JWT (`Authorization: Bearer <token>`). MFA/reset tokens are rejected.

When identity verification is missing, the API returns:

```json
{
  "success": false,
  "error": "Identity verification required",
  "details": {
    "code": "VERIFICATION_REQUIRED",
    "action": "post",
    "status": "PENDING_REVIEW"
  }
}
```

Use `details.action` to open the correct verification step and `details.status` to choose the message (e.g. pending review vs not started).

All success responses use `{ "success": true, "data": ... }`; errors use `{ "success": false, "error": ..., "details": ... }`.

## 4. User endpoints

### 4.1 List forums — `GET /forums`

Public. Returns an array of `Forum` rows ordered by name.

```json
{
  "success": true,
  "data": [
    {
      "id": "…",
      "slug": "community",
      "name": "Community",
      "description": null,
      "isPublic": true,
      "createdAt": "…",
      "updatedAt": "…"
    }
  ]
}
```

### 4.2 Create forum — `POST /forums`

Admin only. Body: `{ "slug": string, "name": string, "description"?: string }`. Errors: `400` missing fields/slug conflict, `403` non-admin.

### 4.3 List threads — `GET /forums/:slug/threads?limit=20&offset=0`

Public. Only `APPROVED` threads are returned, pinned first, then `lastActivityAt` descending. Thread lists are cached in Redis for 60s and invalidated on thread/comment create, edit, and delete.

```json
{
  "success": true,
  "data": {
    "forum": { "id": "…", "slug": "community", "name": "Community", "description": null },
    "rows": [
      {
        "id": "…",
        "forumId": "…",
        "authorId": "…",
        "title": "Welcome",
        "body": "Introduce yourself…",
        "status": "APPROVED",
        "pinned": true,
        "locked": false,
        "replyCount": 12,
        "lastActivityAt": "2026-11-28T06:00:00.000Z",
        "createdAt": "…",
        "updatedAt": "…",
        "author": { "id": "…", "fullName": "Ama Mensah" }
      }
    ],
    "total": 1
  }
}
```

### 4.4 Create thread — `POST /forums/:slug/threads`

Bearer + verified identity. Body: `{ "title": string, "body": string }`. Returns the created `ForumThread` row with its moderation `status`. Errors: `401`, `403` (verification), `400` unknown forum / missing fields.

UI: after success, check `status`. `APPROVED` → navigate to thread; `FLAGGED`/`REJECTED` → show "Submitted for review" / "Not published" with the returned `status`.

### 4.5 Read thread — `GET /threads/:id`

Public. Returns the thread plus `author` and **approved** comments only (also with `author`).

```json
{
  "success": true,
  "data": {
    "id": "…",
    "title": "Welcome",
    "body": "…",
    "status": "APPROVED",
    "pinned": false,
    "locked": false,
    "replyCount": 2,
    "lastActivityAt": "…",
    "author": { "id": "…", "fullName": "…" },
    "comments": [
      {
        "id": "c1",
        "parentId": null,
        "body": "First!",
        "status": "APPROVED",
        "author": { "id": "…", "fullName": "…" },
        "createdAt": "…"
      },
      {
        "id": "c2",
        "parentId": "c1",
        "body": "Welcome too",
        "status": "APPROVED",
        "author": { "id": "…", "fullName": "…" },
        "createdAt": "…"
      }
    ]
  }
}
```

Caveat: this endpoint currently returns the thread even when `status` is `FLAGGED` or `REJECTED`. The client should hide the thread body and show a "not available" state unless `status === "APPROVED"`.

### 4.6 Update thread — `PATCH /threads/:id`

Bearer; owner or admin. Body accepts `title` and/or `body`. Editing `body` re-screens the thread and can change `status`. A locked thread can only be edited by an admin. Errors: `400` nothing to update / not allowed / locked.

### 4.7 Delete thread — `DELETE /threads/:id`

Bearer; owner or admin. Deletes the thread and all of its comments (hard delete). Returns `{ "id": "…" }` with message `"Thread deleted"`.

### 4.8 Create comment — `POST /threads/:id/comments`

Bearer + verified identity. Body: `{ "body": string, "parentId"?: string }`. Set `parentId` to the comment being replied to; omit for a top-level comment. Returns the created `Comment` with `status`. Errors: `401`, `403` (verification), `400` unknown thread / locked thread / missing body.

UI: optimistically add the comment only when `status === "APPROVED"`. For `FLAGGED`, show "Awaiting review" in place of the row.

### 4.9 Update comment — `PATCH /comments/:id`

Bearer; owner or admin. Body: `{ "body": string }`. Re-screens the comment and can change `status`.

### 4.10 Delete comment — `DELETE /comments/:id`

Bearer; owner or admin. Deletes the comment and its direct replies. Returns `{ "id": "…" }`.

## 5. Admin endpoints (moderation queue)

Mounted at `/admin/forums`. All require Bearer + permission (`CONTENT.VIEW` for reads, `CONTENT.MODERATE` for decisions).

### 5.1 Thread queue — `GET /admin/forums/pending-threads?status=PENDING&limit=50&offset=0`

`status` defaults to `PENDING`; pass `FLAGGED` to see auto-flagged threads. Returns threads with `author` and `total`.

### 5.2 Comment queue — `GET /admin/forums/pending-comments?status=PENDING&limit=50&offset=0`

Same shape, comments only (no `author` expansion in this list).

### 5.3 Decide thread — `PATCH /admin/forums/threads/:id/decide`

Body: `{ "approve": boolean, "reason"?: string }`. Sets status to `APPROVED` or `REJECTED`. Returns the updated thread.

### 5.4 Decide comment — `PATCH /admin/forums/comments/:id/decide`

Body: `{ "approve": boolean }`. Sets status to `APPROVED` or `REJECTED`. Returns the updated comment.

## 6. Frontend implementation recipes

### Forum list → thread list → detail

1. `GET /forums` → render forum cards; link to `/forums/:slug`.
2. `GET /forums/:slug/threads` → show title, author, `replyCount`, `lastActivityAt`, pinned badge.
3. On thread click, `GET /threads/:id`; if `status !== "APPROVED"`, show unavailable state.
4. Group comments with `parentId === null` as roots; attach children by `parentId`. Comments are pre-ordered by `createdAt`, so keep that order when building the tree.

### Composer states

- Gate the "New thread" / "Reply" buttons on verified identity. Fetch `GET /verification/identity/status`; only `status === "APPROVED"` enables them. Alternatively, call and handle the `VERIFICATION_REQUIRED` error.
- After create, use the returned `status` to decide between "Published", "In review", and "Not published".
- Do not assume a `201` means visible; `APPROVED` is the visibility flag.

### Ownership UI

- Show edit/delete controls when `currentUser.id === item.authorId || currentUser.accountType === "ADMIN"`.
- Disable reply on threads where `locked === true`, unless the viewer is an admin.

### Moderation console

- Tabs: `PENDING` and `FLAGGED` for threads/comments.
- Approve/reject buttons call the decide endpoints; refresh the queue and invalidate any cached thread list on success.
- Show `reason` only for thread rejections (the comment decide endpoint ignores it).

## 7. Quick reference

| Method | Path                                | Auth               | Key body/query                 |
| ------ | ----------------------------------- | ------------------ | ------------------------------ |
| GET    | `/forums`                           | public             | —                              |
| POST   | `/forums`                           | admin              | `slug`, `name`, `description?` |
| GET    | `/forums/:slug/threads`             | public             | `limit`, `offset`              |
| POST   | `/forums/:slug/threads`             | verified           | `title`, `body`                |
| GET    | `/threads/:id`                      | public             | —                              |
| PATCH  | `/threads/:id`                      | owner/admin        | `title?`, `body?`              |
| DELETE | `/threads/:id`                      | owner/admin        | —                              |
| POST   | `/threads/:id/comments`             | verified           | `body`, `parentId?`            |
| PATCH  | `/comments/:id`                     | owner/admin        | `body`                         |
| DELETE | `/comments/:id`                     | owner/admin        | —                              |
| GET    | `/admin/forums/pending-threads`     | `CONTENT.VIEW`     | `status`, `limit`, `offset`    |
| GET    | `/admin/forums/pending-comments`    | `CONTENT.VIEW`     | `status`, `limit`, `offset`    |
| PATCH  | `/admin/forums/threads/:id/decide`  | `CONTENT.MODERATE` | `approve`, `reason?`           |
| PATCH  | `/admin/forums/comments/:id/decide` | `CONTENT.MODERATE` | `approve`                      |
