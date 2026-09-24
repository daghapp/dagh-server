# YouTube Video Feed — Setup & Requirements

What you need to get the **community YouTube video feed** working end-to-end
(channel sync → video cards → gated playback). The backend is ready; this doc
covers the credentials, environment setup, how to populate the feed, and what
the mobile app must implement to display the videos.

---

## 1. How it works (quick overview)

| Step | Who does it | Where |
|------|-------------|-------|
| Latest uploads are pulled from the channel | Admin sync call | `POST /community/admin/sync-youtube` |
| Video cards are stored | Backend DB | `CommunityVideo` table |
| App shows gated cards with a 45s teaser | Mobile app | `GET /community/videos` |
| User subscribes on YouTube, returns → unlock | Mobile app | `POST /community/videos/:id/unlock` |
| Every tap is logged for funnel analytics | Mobile app | `POST /community/videos/:id/interact` |

---

## 2. What you need (checklist)

### Required
- **`YOUTUBE_API_KEY`** — the only mandatory credential. Without it the sync
  endpoint returns `503` (`YOUTUBE_NOT_CONFIGURED`).

### Optional (but recommended)
- **`YOUTUBE_CHANNEL_ID`** (e.g. `UC...`) **or** **`YOUTUBE_CHANNEL_HANDLE`**
  (e.g. `@diasporaaffairsgh`). Only one is needed — if only the handle is set,
  the sync endpoint resolves the channel ID automatically via the API.
  `YOUTUBE_CHANNEL_HANDLE=@diasporaaffairsgh` is already pre-filled in
  `.env.example`.

### Not required
- No YouTube OAuth / user tokens. By default the unlock is a client-triggered
  flag after the user returns from YouTube. **Optional:** you can enable
  **server-side subscription verification** so a video only unlocks when the
  YouTube Data API confirms the user is actually subscribed to the channel
  (see [section 8](#8-optional-server-side-subscription-verification)).

---

## 3. Getting a YouTube API key (≈ 5 minutes)

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or pick an existing one).
3. **Enable the API:** APIS & Services → Library → search "YouTube Data API v3" →
   **Enable**.
4. **Create the key:** APIS & Services → Credentials → **Create credentials** →
   **API key**.
5. Copy the key string. Keep it server-side only — never ship it in the app.

> **Quota note:** the sync uses the `channels` (1 point) and `playlistItems`
> (1 point/item) endpoints. A max-results sync of 20 costs ~22 points out of
> the default 10,000/day — the Redis cooldown (default 1h) prevents accidental
> quota burn.

---

## 4. Finding the channel ID (optional)

If you'd rather set `YOUTUBE_CHANNEL_ID` than the handle:

1. Open the channel: `https://www.youtube.com/@diasporaaffairsgh`.
2. **About** tab → **Share** → **Copy channel ID**.
3. Paste it into `YOUTUBE_CHANNEL_ID`.

Or just skip this and rely on `YOUTUBE_CHANNEL_HANDLE` — the sync resolves it
for you.

---

## 5. Environment setup

Copy `.env.example` to `.env` and fill in:

```env
# YouTube Data API
YOUTUBE_API_KEY=AIza...                     # REQUIRED
YOUTUBE_CHANNEL_ID=UC...                    # optional — either this...
YOUTUBE_CHANNEL_HANDLE=@diasporaaffairsgh   # ...or this (already pre-filled)
YOUTUBE_SYNC_COOLDOWN_MS=3600000            # optional, ms between syncs (default 1h)
```

Restart the server after changing these. If you skipped step 4 and set only the
handle, you can confirm which channel the sync resolved by reading `channelId`
from the sync response (section 6).

---

## 6. Populate the feed (admin step)

Authenticate as an **admin** (Bearer token) and call:

```bash
curl -X POST https://<api>/community/admin/sync-youtube \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"maxResults": 6}'
```

Body is optional:

| Field | Type | Description |
|-------|------|-------------|
| `channelId` | string | Override the configured channel ID |
| `handle` | string | Override the configured handle (e.g. `@diasporaaffairsgh`) |
| `maxResults` | int 1–20 | How many of the latest uploads to sync (default 6) |

Example response:

```json
{
  "success": true,
  "data": {
    "channelId": "UC...",
    "fetched": 6,
    "created": 4,
    "alreadyPresent": 2,
    "syncedAt": "2026-09-23T10:00:00.000Z",
    "cached": false
  }
}
```

- **`created`** = new cards added to the feed.
- **`alreadyPresent`** = already in the DB (not re-created).
- **`cached: true`** = still inside the Redis cooldown window, so nothing was
  re-fetched from YouTube.

Behavior guarantees:
- Only **new** uploads are inserted. Existing cards are never overwritten, so
  admin edits and unpublishing (soft-delete) survive syncs.
- Each synced card gets `teaserUrl = https://www.youtube.com/embed/<videoId>`
  and `thumbnailUrl = https://i.ytimg.com/vi/<videoId>/hqdefault.jpg`.

**Wrong callbacks you may see:**

| Status | Meaning | Fix |
|--------|---------|-----|
| 503 `YOUTUBE_NOT_CONFIGURED` | `YOUTUBE_API_KEY` missing | Add the key to env, restart |
| 502 `YOUTUBE_API_ERROR` | API rejected the call | Check key/quota, channel validity |
| 400 | Body failed zod validation | Check `maxResults` is 1–20 |
| 401 / 403 | Not authenticated / not admin | Use an admin Bearer token |

---

## 7. What the mobile app must implement

The backend stores cards and unlock state; the app renders them. Per the
designed funnel:

1. **Community Video Card** (`GET /community/videos`):
   - 16:9 media area: autoplay a muted loop, or show the thumbnail with a play
     overlay. Card includes `title`, `description`, `teaserUrl`,
     `thumbnailUrl`, `youtubeVideoId`, `isUnlocked`.
   - Bottom action bar: prominent red **"Subscribe to Unlock"** + secondary
     **"Preview Clip"** when `isUnlocked === false`; a green
     **"Watch Full Video on YouTube"** when `isUnlocked === true`.

2. **Preview modal — the 45-second teaser:**
   - Tapping the thumbnail opens a bottom-sheet that plays `teaserUrl`.
   - Play only the **first 45 seconds**, then freeze with a persistent overlay
     prompting to subscribe for the full version.
   - Log `PREVIEW_CLIP` when it opens, `SUBSCRIBE_INTENT` when "Subscribe to
     Unlock" is tapped.

3. **Deep link to the channel:**
   - "Subscribe to Unlock" → open the channel in the native YouTube app:
     `vnd.youtube://channel/<channelId>` (fallback `https://www.youtube.com/@diasporaaffairsgh`).
   - "Watch Full Video on YouTube" → `vnd.youtube://<youtubeVideoId>`
     (fallback `https://www.youtube.com/watch?v=<youtubeVideoId>`).

4. **Unlock + rehydrate:**
   - When the user returns to the app, call
     `POST /community/videos/:videoId/unlock` (idempotent) and log `UNLOCK`.
   - If **server-side verification** is enabled (section 8), "Subscribe to
     Unlock" opens the OAuth flow instead — the callback unlocks the video only
     after the API confirms the subscription.
   - On app launch, call `GET /community/my-unlocks` (or
     `GET /community/youtube/status/:videoId` for a single card) to rehydrate
     all unlocked IDs and render buttons green without re-fetching every card.

5. **Analytics:** log every meaningful tap via
   `POST /community/videos/:videoId/interact` with
   `SUBSCRIBE_INTENT | PREVIEW_CLIP | WATCH_FULL_VIDEO | UNLOCK`. Admins read
   the funnel (interaction counts + conversion rate) at
   `GET /community/videos/:videoId/analytics`.

### API payload contract (what the feed returns)

Every card in `GET /community/videos` is:

```json
{
  "id": "uuid",
  "videoId": "uuid",
  "title": "string",
  "description": "string",
  "teaserUrl": "string",
  "thumbnailUrl": "string",
  "youtubeVideoId": "string",
  "isUnlocked": "boolean",
  "unlockedAt": "ISO-8601 | null",
  "publishedAt": "ISO-8601"
}
```

- `videoId` is an **alias of `id`** (the internal card id). Use either as the
  `:videoId` path param on the detail / interact / unlock / analytics routes.
- The `:videoId` param also **accepts the YouTube id** (`youtubeVideoId`)
  directly, so deep links from YouTube never 404.
- `title`, `description`, `thumbnailUrl`, `teaserUrl` are **never null** (DB
  defaults / derived YouTube URLs). `unlockedAt` is the only nullable field.

### CORS / network headers

- Native app requests (no `Origin` header) are always allowed.
- Web views & browsers must be in `ALLOWED_ORIGINS` (comma-separated, no
  wildcard). Unknown origins get `403 Origin not allowed by CORS`. See
  `server.ts` — the API's own public origin is always included.
- Thumbnails/embeds load directly from `i.ytimg.com` / `youtube.com`
  client-side; the API does not proxy media, so those are not subject to API
  CORS.

### Persisted user state (unlock tracking)

- `video_unlocks` — `(userId, videoId, unlockedAt)` with `@@unique([userId, videoId])`,
  written idempotently by `POST /community/videos/:videoId/unlock`.
- `video_interactions` — append-only analytics rows per user action.
- Rehydrate on app launch with `GET /community/my-unlocks` — no client-side
  state migration needed.

### Server-side logging

Each feed/unlock/interact call logs one structured JSON line
(`event: community.*`, with `status`, `userId`, `videoId`, `durationMs`).
500s log at `error`, expected 404/400s at `warn` — e.g.
`grep 'community.feed.list.error'` catches feed fetch failures immediately.

---

## 8. Optional — server-side subscription verification

The default flow trusts the client when it says the user returned from YouTube.
If you want an actual **server-side check**, enable the OAuth verification
route. It uses Google OAuth (not just the API key) to ask the YouTube Data API
whether the authorized account is subscribed to the configured channel.

Flow:

```
App                    Server                           Google / YouTube
 │ GET /youtube/start/:videoId ─▶ │ build signed state (user+video)   │
 │ ◀────────────{"authUrl"}────── │                                   │
 │ open authUrl in browser ──────────────────────────────▶ consent    │
 │                                          ◀──────────── redirect    │
 │                           callback: code + state ─▶ │               │
 │                                                     │ token exchange│
 │                                                     │ subscriptions │
 │                                                     │ mine+channel  │
 │ ◀──────────── 302 → daghapp://youtube/verify?subscribed=true...     │
```

### Requirements

| Env var | Description |
|---------|-------------|
| `YOUTUBE_OAUTH_CLIENT_ID` | Google Cloud **OAuth 2.0 Client ID** (Web application) |
| `YOUTUBE_OAUTH_CLIENT_SECRET` | Matching client secret |
| `YOUTUBE_OAUTH_REDIRECT_URI` | HTTPS callback; **must** be added to the client's Authorized redirect URIs in the Google console. Defaults to `<API_URL>/community/youtube/callback` when using `API_URL`. |
| `YOUTUBE_VERIFY_RETURN_URL` | App deep link the browser returns to (default `daghapp://youtube/verify`) |
| `YOUTUBE_VERIFY_CACHE_MS` | How long a verdict is cached before a re-check (default `3600000` = 1h). Reads are served from cache so feed loads / status polls never hit the API. |

The same Google Cloud project needs **YouTube Data API v3** enabled. Create the
OAuth client under **APIs & Services → Credentials → Create credentials →
OAuth client ID → Web application**, then add the redirect URI.

### Endpoints

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/community/youtube/start/:videoId` | Bearer | Returns `{ authUrl, expiresIn }` — the state token inside encodes the user + video for 15 min |
| GET | `/community/youtube/callback` | Public | Google redirect target. Exchanges the code, checks `subscriptions?mine=true&forChannelId=<channel>`, unlocks + logs `SUBSCRIBE_INTENT`/`UNLOCK` when subscribed, caches the verdict, redirects to the return URL |
| GET | `/community/youtube/status/:videoId` | Bearer | `{ isUnlocked, verifiedSubscribed, verifiedAt, cached }` — durable unlock + last cached verdict |

Behavior notes:

- **Cost:** the `subscriptions` check costs **1 quota unit** per call. Negative
  verdicts are cached too, so a user re-running the flow repeatedly does not
  burn quota.
- **Cache:** Redis-first, with a bounded in-memory fallback for single-instance
  deployments (no `REDIS_URL`).
- **CSRF-safe:** the `state` is a signed JWT (`JWT_ACCESS_SECRET`), so an
  attacker cannot forge whose account is being verified or which video unlocks.
- **Optional by design:** none of the existing client-triggered unlock flows
  change when these env vars are not set — they simply never unlock server-side.

### App wording for the consent screen scope

The scope requested is read-only (`youtube.readonly`). Google displays a
permission prompt only the first time per account; afterwards re-verification is
an instant redirect.

---

## 9. End-to-end acceptance checklist

- [ ] `YOUTUBE_API_KEY` in env, YouTube Data API v3 enabled
- [ ] Channel ID **or** handle set (`@diasporaaffairsgh` pre-filled)
- [ ] Admin runs `POST /community/admin/sync-youtube` → `created > 0`
- [ ] `GET /community/videos` returns cards with `videoId`, `thumbnailUrl`, `title`, `description`, `isUnlocked: false`
- [ ] `POST /community/videos/:videoId/unlock` works with the `videoId` from a card **and** with `youtubeVideoId` directly
- [ ] Web-view origin is in `ALLOWED_ORIGINS` (native requests need no origin)
- [ ] Server logs show a `community.feed.list` line per request and `community.feed.*.not_found` / `*.error` lines on failures
- [ ] App plays 45s teaser, then shows subscribe overlay — logs `PREVIEW_CLIP`
- [ ] "Subscribe to Unlock" opens YouTube app — logs `SUBSCRIBE_INTENT`
- [ ] Returning to app calls `/unlock` → button turns green — logs `UNLOCK`
- [ ] "Watch Full Video on YouTube" opens the video — logs `WATCH_FULL_VIDEO`
- [ ] Relaunching the app preserves green state via `GET /community/my-unlocks`
- [ ] *(Optional)* `YOUTUBE_OAUTH_*` configured; `/community/youtube/start/:videoId` returns an `authUrl`
- [ ] *(Optional)* Completing consent unlocks only when actually subscribed; `/community/youtube/status/:videoId` reflects it
- [ ] Admin analytics endpoint shows the funnel numbers