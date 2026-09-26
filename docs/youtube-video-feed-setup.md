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
| Video cards are stored (preview clip only) | Backend DB | `CommunityVideo` table |
| App shows gated cards with a 45s preview | Mobile app | `GET /community/videos` |
| User subscribes on YouTube, returns → unlock | Mobile app | `GET /community/youtube/start/:id` |
| Server confirms the subscription, grants access | OAuth callback | `GET /community/youtube/callback` |
| Every tap is logged for funnel analytics | Mobile app | `POST /community/videos/:id/interact` |

---

## 2. What you need (checklist)

### Required
- **`YOUTUBE_API_KEY`** — needed for the sync endpoint. Without it that endpoint
  returns `503` (`YOUTUBE_NOT_CONFIGURED`).
- **`YOUTUBE_OAUTH_CLIENT_ID`** + **`YOUTUBE_OAUTH_CLIENT_SECRET`** — needed to
  verify a subscription. Without them the unlock endpoint **fails open** and
  trusts the client, so the gate is effectively off. Set these before launch
  (see [section 8](#8-server-side-subscription-verification--the-unlock-gate)).

### Optional (but recommended)
- **`YOUTUBE_CHANNEL_ID`** (e.g. `UC...`) **or** **`YOUTUBE_CHANNEL_HANDLE`**
  (e.g. `@diasporaaffairsgh`). Only one is needed — if only the handle is set,
  the sync endpoint resolves the channel ID automatically via the API.
  `YOUTUBE_CHANNEL_HANDLE=@diasporaaffairsgh` is already pre-filled in
  `.env.example`.
- **`YOUTUBE_VERIFY_RETURN_URL`** — the app deep link the OAuth browser returns
  to (default `daghapp://youtube/verify`).
- **`YOUTUBE_VERIFY_CACHE_MS`** — how long a verdict is trusted before the next
  check (default `3600000` = 1h).

### Not required
- No per-user YouTube tokens are stored. The OAuth access token is exchanged and
  used for a single subscription check, then discarded; only the boolean verdict
  is cached (Redis, or in-memory without `REDIS_URL`).

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
- Each synced card gets a **clipped** teaser
  `https://www.youtube.com/embed/<videoId>?start=0&end=45&rel=0` and
  `thumbnailUrl = https://i.ytimg.com/vi/<videoId>/hqdefault.jpg`. The
  full-length URL is never stored on a card.

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
     overlay. Card includes `title`, `description`, `teaserUrl`, `thumbnailUrl`,
     `previewStartSeconds`, `previewDurationSeconds`, `isUnlocked`,
     `requiresSubscription`, and `channel` (the subscribe links — see step 3).
     `youtubeVideoId` and `watchUrl` are only present once unlocked — do not
     assume they exist.
   - Bottom action bar: prominent red **"Subscribe to Unlock"** + secondary
     **"Preview Clip"** when `isUnlocked === false`; a green
     **"Watch Full Video on YouTube"** when `isUnlocked === true`.

2. **Preview modal — the 45-second teaser:**
   - Tapping the thumbnail opens a bottom-sheet that plays `teaserUrl`.
   - The clip is already bounded server-side, but also stop at
     `previewStartSeconds + previewDurationSeconds` and then freeze with a
     persistent overlay prompting to subscribe for the full version.
   - Log `PREVIEW_CLIP` when it opens, `SUBSCRIBE_INTENT` when "Subscribe to
     Unlock" is tapped.

3. **Deep link to the channel — take it from the API, do not hardcode it:**
   - Every card carries a `channel` object, and `GET /community/youtube/start/:videoId`
     returns the same one alongside `authUrl`:

     ```json
     {
       "channelId": "UC...",
       "handle": "@diasporaaffairsgh",
       "subscribeUrl": "https://www.youtube.com/@diasporaaffairsgh",
       "appUrl": "vnd.youtube://channel/UC..."
     }
     ```

   - "Subscribe to Unlock" → open `channel.appUrl` if non-null, else
     `channel.subscribeUrl` as the browser fallback. `appUrl` is `null` for a
     handle-only configuration, because the `vnd.youtube://channel/` scheme has
     no handle form.
   - "Watch Full Video on YouTube" → `vnd.youtube://<youtubeVideoId>`
     (fallback `https://www.youtube.com/watch?v=<youtubeVideoId>`). This action
     only exists for unlocked cards, so the id is guaranteed present.
   - All four fields are `null` when neither `YOUTUBE_CHANNEL_ID` nor
     `YOUTUBE_CHANNEL_HANDLE` is set — handle that state rather than assuming a
     link exists.

   **Why this matters:** these used to be hardcoded in the app as
   `@diasporaaffairsgh`. That duplicates server config into the client, so
   changing the env var silently points the subscribe button at one channel while
   the server verifies against another — the user subscribes, is told they are
   not subscribed, and nothing in the response tells them where to go. Use the
   server's links.

   Note that neither link *completes* the subscription — they open the channel
   page and the user still taps Subscribe. YouTube exposes no link that subscribes
   on the user's behalf.

4. **Unlock + rehydrate:**
   - "Subscribe to Unlock" should run the OAuth flow
     (`GET /community/youtube/start/:videoId` → `authUrl`, section 8). The
     callback confirms the subscription and unlocks server-side; the browser
     lands back on your deep link with
     `?subscribed=…&unlocked=…&channelGranted=…&hasChannelAccess=…`.
   - **`hasChannelAccess=true` means the entire feed is unlocked.** Hide every
     subscribe call to action at once rather than card by card — otherwise a
     subscriber scrolling a feed the server has already opened gets nagged to
     subscribe again on the next card.
   - `POST /community/videos/:videoId/unlock` is **not** a client-trusted grant.
     With the gate closed it returns `403 SUBSCRIPTION_REQUIRED` unless the
     callback already cached a positive verdict, so call it only to *re-check*
     after the round-trip (it is idempotent) — do not treat a 200 as the only
     way to unlock.
   - On app launch, call `GET /community/my-unlocks` (or
     `GET /community/youtube/status/:videoId` for a single card) to rehydrate
     access without re-fetching every card.

### Frontend local state — button rehydration (recommended)

Keep a persisted flag plus a map so buttons render instantly and stay green
across launches:

- **First: store the channel flag.** `hasChannelAccess` is the single value that
  matters for a subscriber — when it is `true`, render the feed as fully
  unlocked and stop consulting the per-video map. Persist it alongside the map
  (AsyncStorage/encrypted storage).
- **Then: keep `videoId → unlockedAt` as a fallback** for users with no channel
  grant (and for the rare legacy per-video unlock). Keep `youtubeVideoId`
  separately once unlocked — it is only used for deep links, and it is only sent
  to you after unlocking.
- **On launch:** call `GET /community/my-unlocks`, persist `hasChannelAccess`,
  and merge `{ unlocks: [{ videoId, unlockedAt }] }` into the map. Merge, don't
  replace, so unlocks made offline/other devices aren't lost. When
  `hasChannelAccess` is true, skip the merge — the map is not consulted.
- **On unlock:** `POST /community/videos/:videoId/unlock` → on success set
  `map[videoId] = unlockedAt` from the response, and set the channel flag when
  the response says `channelGranted: true`. On `403 SUBSCRIPTION_REQUIRED` re-run
  the OAuth flow rather than retrying the unlock.
- **Render:** green state when the channel flag is set, OR `map[videoId]` is
  truthy, OR the feed card says `isUnlocked: true`; otherwise the red "Subscribe
  to Unlock" state.
- A stale `videoId` (e.g. a card later unpublished) simply never renders — the
  server returns 404 for it, which the app can treat as "lock again".

5. **Analytics:** log every meaningful tap via
   `POST /community/videos/:videoId/interact` with
   `SUBSCRIBE_INTENT | PREVIEW_CLIP | WATCH_FULL_VIDEO | UNLOCK`. Pass the
   optional `durationMs` (integer ms ≥ 0) to record watch time — e.g. send
   `durationMs` on `PREVIEW_CLIP` when the user leaves the teaser, so you can
   measure drop-off within the 45s clip. Admins read the funnel (interaction
   counts + conversion rate + watch-time totals) at
   `GET /community/videos/:videoId/analytics`.

### API payload contract (what the feed returns)

A **locked** card in `GET /community/videos` is:

```json
{
  "id": "uuid",
  "videoId": "uuid",
  "title": "string",
  "description": "string",
  "teaserUrl": "https://www.youtube.com/embed/VIDEO?start=0&end=45&rel=0",
  "previewStartSeconds": 0,
  "previewDurationSeconds": 45,
  "thumbnailUrl": "string",
  "isUnlocked": false,
  "requiresSubscription": true,
  "unlockedAt": null,
  "channel": {
    "channelId": "UC...",
    "handle": "@diasporaaffairsgh",
    "subscribeUrl": "https://www.youtube.com/@diasporaaffairsgh",
    "appUrl": "vnd.youtube://channel/UC..."
  },
  "publishedAt": "ISO-8601"
}
```

An **unlocked** card is the same shape plus:

```json
{
  "isUnlocked": true,
  "requiresSubscription": false,
  "unlockedAt": "ISO-8601",
  "youtubeVideoId": "string",
  "watchUrl": "https://www.youtube.com/embed/VIDEO"
}
```

- `videoId` is an **alias of `id`** (the internal card id). Use either as the
  `:videoId` path param on the detail / interact / unlock / analytics routes.
- The `:videoId` param also **accepts the YouTube id** (`youtubeVideoId`)
  directly, so deep links from YouTube never 404.
- `title`, `description`, `thumbnailUrl`, `teaserUrl` are **never null** (DB
  defaults / derived YouTube URLs). `unlockedAt` is the only nullable field.

#### Why `youtubeVideoId` and `watchUrl` are omitted while locked

Gating only the *playback* is theatre: the full-length link is just a string, so
any client that can read the feed can read the video. The server therefore
withholds the two fields that reconstruct it and derives the full watch URL on
demand, only for callers who already hold a `VideoUnlock`. Locked viewers get
`teaserUrl` (bounded to the preview window by YouTube's own `start`/`end` embed
params) and `thumbnailUrl` — enough to sample the content, not enough to watch
it in full. `teaserUrl` is stored clipped, so even a client that ignores
`isUnlocked` cannot pull the whole upload out of that field.

### CORS / network headers

- Native app requests (no `Origin` header) are always allowed.
- Web views & browsers must be in `ALLOWED_ORIGINS` (comma-separated, no
  wildcard). Unknown origins get `403 Origin not allowed by CORS`. See
  `server.ts` — the API's own public origin is always included.
- Thumbnails/embeds load directly from `i.ytimg.com` / `youtube.com`
  client-side; the API does not proxy media, so those are not subject to API
  CORS.

### Persisted user state (unlock tracking)

A YouTube subscription is to the **channel**, not to an individual video, so
access is recorded at both levels:

- `channel_unlocks` — `(userId, channelId, unlockedAt, verifiedAt)` with
  `@@unique([userId, channelId])`. This is the row that actually opens the feed:
  once it exists, **every** card is unlocked, including videos published after
  the grant. Written by the OAuth callback on a positive subscription check.
  Durable and never re-checked, so a subscriber who later unsubscribes keeps
  access — see [how access is granted](#how-access-is-granted).
- `video_unlocks` — `(userId, videoId, unlockedAt)` with
  `@@unique([userId, videoId])`. Still written for the video the user actually
  unlocked, because it is what the per-video analytics count
  (`WATCH_FULL_VIDEO`, conversion rate) reports on. **Not** the access
  authority — a subscriber who never opened a given card has no row for it, and
  is still served that card.
- `video_interactions` — append-only analytics rows per user action.
- Rehydrate on app launch with `GET /community/my-unlocks` — no client-side
  state migration needed. Branch on `hasChannelAccess` first: when it is `true`
  the whole feed is open, and `unlocks` only lists the cards they opened.

The `20261007_add_channel_unlocks` migration backfilled one channel row per user
from their existing `video_unlocks`, so pre-existing subscribers were not
re-gated by the move to channel-level access.

### Server-side logging

Each feed/unlock/interact call logs one structured JSON line
(`event: community.*`, with `status`, `userId`, `videoId`, `durationMs`).
500s log at `error`, expected 404/400s at `warn` — e.g.
`grep 'community.feed.list.error'` catches feed fetch failures immediately.

---

## 8. Server-side subscription verification — the unlock gate

A full-length video is the reward for subscribing to the channel, so the unlock
must rest on something the client cannot assert. Google OAuth (not just the API
key) is used to ask the YouTube Data API whether the authorized account is
actually subscribed.

### What this can and cannot prove

Worth being explicit, because the API's limits shape the design:

- It proves an **explicit subscription** exists on the authorized Google account.
  That is the only thing YouTube exposes.
- It **cannot** prove a user watched anything. There is no per-user watch API —
  YouTube Analytics is channel-owner-side and aggregate only. Anything in the
  app claiming a verified "watch" is client-reported and should be treated as a
  hint, not evidence.
- It cannot see a subscription made on a **different account** than the one
  authorized, and a user can revoke it at any time (our verdict cache just
  expires and the next unlock re-opens the gate).
- Verifying a subscription is **not** the same as being able to watch without
  one. A locked card stays locked; this is a funnel, not an access-control
  boundary. The full video is public on YouTube by design, so treat this as
  *gating a link inside our app*, not as protecting content.

### Flow

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
 │                          cache verdict ──▶ gate ──▶ unlock + UNLOCK  │
 │ ◀──────────── 302 → daghapp://youtube/verify?subscribed=true...     │
```

### How access is granted

A YouTube subscription is to the channel, not to a video, so the callback grants
the **channel**, not just the card the user happened to be looking at:

1. `checkChannelSubscription` confirms the account is subscribed.
2. The verdict is cached (the gate reads it).
3. `unlockVideo` writes the per-video row — the analytics record for the card
   the user unlocked.
4. `grantChannelAccess` writes the channel row, keyed on the channel that was
   just verified.

From then on the whole feed is open, including videos published later, and
neither the feed nor the status endpoint needs another OAuth round-trip. A
`channel_unlocks` row is the authority: the feed query checks it first and
unlocks every card on the page, so a subscriber who scrolled past twenty cards
without opening them is served all twenty.

Two consequences worth designing around:

- **The grant is permanent and never re-verified.** The cached verdict expires
  (Redis TTL, default 24h), but the grant does not — it is a durable
  entitlement, not a cache entry. Someone who unsubscribes keeps access until an
  admin revokes the row. This is deliberate: revocation would need a reliable
  "unsubscribed" signal that the API does not offer (the verdict only goes
  stale, it does not flip), so silently re-locking paying supporters on a cache
  miss would be worse than the alternative. Delete the `channel_unlocks` row to
  revoke access manually.
- **The channel id comes from the callback, never from the client.** The unlock
  endpoint returns `channelGranted: false` on its own, because only the callback
  knows which channel it just verified. A client cannot ask for a grant on an
  arbitrary channel, and the row is `@@unique([userId, channelId])` so a repeat
  verification is a no-op.

The app reads this as three flags, all in the API response:
`meta.hasChannelAccess` on the feed, `hasChannelAccess` on
`GET /community/my-unlocks`, and `via: "CHANNEL"` (vs `"VIDEO"` for a legacy
per-video unlock) on `GET /community/youtube/status/:videoId`.

The callback caches the verdict **before** calling the unlock, because the
unlock reads that cache as its gate.

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
| GET | `/community/youtube/start/:videoId` | Bearer | Returns `{ authUrl, expiresIn, channel }` — the state token inside encodes the user + video for 15 min, and `channel` carries the subscribe links so the app needs no second call |
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
- **The gate:** `POST /community/videos/:videoId/unlock` requires a positive,
  unexpired verdict and otherwise returns `403 SUBSCRIPTION_REQUIRED`. An absent
  verdict (never verified, or the TTL lapsed) counts as not subscribed, so it
  fails closed. An **existing** unlock is returned untouched and never
  re-checked, so a granted unlock does not expire with the cache.
- **Fail-open when unconfigured:** with no `YOUTUBE_OAUTH_CLIENT_ID` /
  `YOUTUBE_OAUTH_CLIENT_SECRET` the server has no way to verify anything, and
  failing closed would leave every video permanently ununlockable (including on
  local/dev). In that configuration the unlock endpoint falls back to trusting
  the client. **Configuring the OAuth env vars closes the gate** — do this
  before launch.
- **Analytics:** the callback logs only `UNLOCK`. `SUBSCRIBE_INTENT` is the
  client logging the tap that started the flow; logging it again on success
  would double-count the funnel denominator and understate `conversionRate`.

### App wording for the consent screen scope

The scope requested is read-only (`youtube.readonly`). Google displays a
permission prompt only the first time per account; afterwards re-verification is
an instant redirect.

---

## 9. End-to-end acceptance checklist

- [ ] `YOUTUBE_API_KEY` in env, YouTube Data API v3 enabled
- [ ] Channel ID **or** handle set (`@diasporaaffairsgh` pre-filled)
- [ ] `YOUTUBE_OAUTH_CLIENT_ID` / `YOUTUBE_OAUTH_CLIENT_SECRET` set — **required
      in production**, otherwise the unlock gate fails open
- [ ] Admin runs `POST /community/admin/sync-youtube` → `created > 0`
- [ ] `GET /community/videos` returns cards with `videoId`, `thumbnailUrl`, `title`, `description`, `isUnlocked: false`, `requiresSubscription: true`
- [ ] A **locked** card has no `youtubeVideoId` and no `watchUrl` anywhere in the
      payload, and its `teaserUrl` carries `start`/`end` bounds
- [ ] `POST /community/videos/:videoId/unlock` with no prior verification returns
      `403 SUBSCRIPTION_REQUIRED` (gate closed)
- [ ] `POST /community/videos/:videoId/unlock` works with the `videoId` from a card **and** with the `youtubeVideoId` of an unlocked card
- [ ] Web-view origin is in `ALLOWED_ORIGINS` (native requests need no origin)
- [ ] Server logs show a `community.feed.list` line per request and `community.feed.*.not_found` / `*.error` lines on failures
- [ ] App plays the clipped preview, then shows subscribe overlay — logs `PREVIEW_CLIP`
- [ ] "Subscribe to Unlock" opens `channel.appUrl` (falling back to `channel.subscribeUrl`) — **no hardcoded handle in the app**
- [ ] Changing `YOUTUBE_CHANNEL_ID` / `YOUTUBE_CHANNEL_HANDLE` changes the link the app shows, with no app release
- [ ] "Subscribe to Unlock" starts the OAuth flow — logs `SUBSCRIBE_INTENT` **once**
- [ ] Consent → callback confirms the subscription, unlocks, logs `UNLOCK` once
- [ ] The unlocked card now carries `youtubeVideoId` + `watchUrl`
- [ ] "Watch Full Video on YouTube" opens the video — logs `WATCH_FULL_VIDEO`
- [ ] Relaunching the app preserves green state via `GET /community/my-unlocks`
- [ ] An existing unlock survives verdict-cache expiry (call `/unlock` again after
      `YOUTUBE_VERIFY_CACHE_MS` — still 200)
- [ ] Admin analytics endpoint shows the funnel numbers, and
      `SUBSCRIBE_INTENT` is not double-counted