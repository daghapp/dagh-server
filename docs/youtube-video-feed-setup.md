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
| App shows gated cards with a 30s preview | Mobile app | `GET /community/videos` |
| "Subscribe to Unlock Preview" is tapped — intent logged, links returned | Mobile app | `POST /community/videos/:id/subscribe-intent` |
| User subscribes on YouTube, returns → verify | Mobile app | opens the returned `authUrl` |
| Server confirms the subscription, grants access | OAuth callback | `GET /community/youtube/callback` |
| Every tap is logged for funnel analytics | Mobile app | `POST /community/videos/:id/interact` (and `POST /community/videos/:id/subscribe-intent` for the subscribe tap, which logs itself) |

---

## 2. What you need (checklist)

### Required
- **`YOUTUBE_API_KEY`** — needed for the sync endpoint. Without it that endpoint
  returns `503` (`YOUTUBE_NOT_CONFIGURED`).
- **`YOUTUBE_OAUTH_CLIENT_ID`** + **`YOUTUBE_OAUTH_CLIENT_SECRET`** — needed to
  verify a subscription. Without them every check resolves to **no access** and
  the feed stays locked; the server fails closed and never grants on a client
  claim. Set these before launch or the community section is unusable
  (see [section 8](#8-server-side-subscription-verification--the-unlock-gate)).
  Whether gating on a subscribe action is permitted by YouTube's policies at all
  is a separate question this repo does not answer —
  [section 10](#10-before-you-launch-channel-incentive-policy-review) is the
  pre-launch review.

### Optional (but recommended)
- **`YOUTUBE_CHANNEL_ID`** (e.g. `UC...`) **or** **`YOUTUBE_CHANNEL_HANDLE`**
  (e.g. `@diasporaaffairsgh`). Only one is needed — if only the handle is set,
  the sync endpoint resolves the channel ID automatically via the API.
  `YOUTUBE_CHANNEL_HANDLE=@diasporaaffairsgh` is already pre-filled in
  `.env.example`.
- **`YOUTUBE_VERIFY_RETURN_URL`** — the app deep link the OAuth browser returns
  to (default `daghapp://youtube/verify`).
- **`COMMUNITY_ACCESS_LEASE_SECONDS`** — how long a confirmed verdict is trusted
  before the next read re-checks Google (default `60`). This is the entire
  staleness policy: YouTube publishes no unsubscribe event, so a longer lease is
  a longer window in which someone who cancelled keeps watching. Each re-check
  costs one `subscriptions.list` unit and only happens for users who actually
  read the community.
- **`COMMUNITY_REVERIFY_BUDGET_MS`** / **`COMMUNITY_ACTIVE_RECHECK_BATCH`** — the
  nightly sweep that re-checks users who never reopen the app (defaults
  `600000` = 10 min, `200`).

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

> **Quota note:** the sync uses the `channels` (1 point), `playlistItems`
> (1 point/item) and `videos?part=statistics` (1 point per batch of 50) endpoints.
> A max-results sync of 20 costs ~23 points out of the default 10,000/day — the
> Redis cooldown (default 1h) is checked after the channel is resolved and before
> the uploads are fetched, so a sync inside the window costs no quota at all. It is
> Redis-backed only: with no `REDIS_URL` there is no cooldown and every call
> reaches YouTube.

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
    "updated": 2,
    "alreadyPresent": 2,
    "syncedAt": "2026-09-23T10:00:00.000Z",
    "cached": false
  }
}
```

- **`created`** = new cards added to the feed.
- **`updated`** = existing cards whose YouTube view/like counters were refreshed.
  This is what lets a video that has since gone viral climb the
  `sort=most_watched` / `most_liked` feeds.
- **`alreadyPresent`** = deprecated alias of `updated`, kept for older clients.
- **`cached: true`** = still inside the Redis cooldown window, so nothing was
  re-fetched from YouTube and no quota was spent.

Behavior guarantees:
- Only **new** uploads are inserted. On a card that already exists the sync writes
  **only** `viewCount`, `likeCount` and `statsSyncedAt`, so admin edits and
  unpublishing (soft-delete) survive syncs.
- Each synced card gets a **clipped** teaser
  `https://www.youtube.com/embed/<videoId>?start=0&end=30&rel=0` and
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
     `previewStartSeconds`, `previewDurationSeconds`, `viewCount`, `likeCount`,
     `isUnlocked`, `requiresSubscription`, and `channel` (the subscribe links —
     see step 3). `youtubeVideoId`, `watchUrl`, `watchAppUrl` and `watchWebUrl`
     are only present once unlocked — do not assume they exist.
   - Bottom action bar: prominent red **"Subscribe to Unlock Preview"** + secondary
     **"Preview Clip"** when `isUnlocked === false`; a green
     **"Watch Full Video on YouTube"** when `isUnlocked === true` (open
     `watchAppUrl`, falling back to `watchWebUrl`).
   - **The red button is a single call**: `POST
     /community/videos/:videoId/subscribe-intent` (section 4). It records the
     funnel event and returns the authorization URL and the subscribe links
     together, so the tap cannot half-succeed.
   - Optional sort tabs: pass `?sort=most_watched` or `?sort=most_liked` to rank
     the feed by YouTube engagement instead of recency (default `newest`). The
     ordering applied is echoed in `meta.sort`. The counts are already on every
     card, so the tabs need no extra request — see
     [Ranking the feed by engagement](api-reference.md#sort--ranking-the-feed-by-engagement).

2. **Preview modal — the teaser, then the end-of-preview CTA overlay:**

   This one modal covers three of the four steps in the user journey, and it is
   entirely client-side: the server has no endpoint that fires when a preview
   ends, and does not need one. Everything it needs is already on the card.

   **a. Play the teaser.** Tapping the thumbnail opens a bottom-sheet that plays
   `teaserUrl`. The clip is already bounded server-side by YouTube's own `start`
   /`end` embed params. Stop it locally at
   `previewStartSeconds + previewDurationSeconds` anyway — `end` is honoured by
   the embed player but is not a hard guarantee across every embed context, and a
   preview that runs into the full video defeats the whole gate.

   **b. Show the CTA overlay at the end of the preview.** The overlay is a single
   view pinned over the video area — not a separate screen, and not a dialog that
   dismisses itself.

   - **Trigger it on the player's own `ended` event, not a timer.** A
     `setTimeout(previewDurationSeconds * 1000)` drifts, and fires while the
     player is paused, buffering, or backgrounded — so the user gets the overlay
     for a video they have not finished. Use the media element's `ended` /
     `onStateChange === YT.PlayerState.ENDED`, and treat the local stop in (a) as
     the backstop that *causes* the same event.
   - **Keep the last frame and pause the audio.** Do not let the clip loop under
     the overlay, and stop any looping autoplay of the card's thumbnail media
     behind the sheet — otherwise the overlay reads as broken over a video that
     is still audibly playing.
   - **It is persistent.** Do not auto-dismiss it and do not add a short
     countdown. The user has to choose an action; a disappearing overlay is the
     one outcome that loses the click.
   - **Guard re-entry.** If the user dismisses the overlay and replays the clip,
     do not bring it straight back — set a `hasSeenCta` flag per modal session
     and let it re-arm only when the clip completes again. Otherwise every
     replay re-triggers it and the second tap does nothing visible.
   - **Copy and button depend on the card's unlock state**, which the app already
     holds on the card object — do not re-fetch to decide:

     | `isUnlocked` | Overlay message | Button | Action |
     |---|---|---|---|
     | `true` | "Enjoyed the preview? Watch the full discussion." | **Watch Full Video on YouTube** | Open `watchAppUrl`, falling back to `watchWebUrl` (section 3) |
     | `false` | "Enjoyed the preview? Subscribe to unlock the full discussion." | **Subscribe to Unlock Preview** | Run the subscribe flow (section 4) |

     Reading `isUnlocked` at the moment the preview ends — rather than at modal
     open — matters: a grant can be revoked by the re-verify sweep while the user
     is mid-clip, and a locked card has no `watchAppUrl` to open. Treat a missing
     `watchAppUrl` as "not unlocked" and fall back to the subscribe branch rather
     than opening a broken link.

   - **Prefer the app, fall back to the web.** `watchAppUrl` is a
     `vnd.youtube://` deep link. On a device with no YouTube app it silently does
     nothing on some platforms, so check whether the URL can be opened and fall
     back to `watchWebUrl` on failure. Both are supplied by the server for exactly
     this reason — see section 3.

   - **Analytics.** Log `PREVIEW_CLIP` once when the modal opens, via
     `POST /community/videos/:videoId/interact`. Sending `durationMs` when the
     modal is dismissed measures drop-off within the clip, which is the number
     that tells you whether the teaser is too long.

     On the overlay button, the two branches differ:

     - **Unlocked** → log `WATCH_FULL_VIDEO` via `/interact`, then open
       `watchAppUrl`.
     - **Locked** → call `POST /community/videos/:videoId/subscribe-intent`
       (section 4). It records `SUBSCRIBE_INTENT` for you and returns the
       authorization URL and channel links. Do **not** also call `/interact` with
       `SUBSCRIBE_INTENT` — that double-counts the funnel denominator, since
       `conversionRate` divides real unlocks by that count, so the rate is
       understated and your team chases a funnel problem that does not exist.

     Log at the tap, not at the end of the video, and do not log
     `SUBSCRIBE_INTENT` again when the OAuth flow completes — the server logs
     `UNLOCK` for that.

   **Preview length:** cards default to a 30-second clip
   (`previewDurationSeconds`), which is what this doc assumes. The field is
   per-video and admin-editable via `PUT /community/admin/videos/:videoId`, so a
   card can be tuned to a tighter or longer teaser with no deploy. Note the
   channel sync only ever writes preview bounds when it first creates a card — it
   refreshes counters on cards it already knows and leaves curated fields alone —
   so changing the server default does not shorten existing cards. Set them
   explicitly per card to move a published feed. The overlay contract above is
   unchanged by the length.

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

   - "Subscribe to Unlock Preview" → open `channel.appUrl` if non-null, else
     `channel.subscribeUrl` as the browser fallback. `appUrl` is `null` for a
     handle-only configuration, because the `vnd.youtube://channel/` scheme has
     no handle form.
   - **"Watch Full Video on YouTube"** (the end-of-preview overlay button, or the
     card's green action) → open **`watchAppUrl`**, falling back to
     **`watchWebUrl`** when the deep link cannot be opened:

     ```json
     {
       "watchAppUrl": "vnd.youtube://watch?v=dQw4w9WgXcQ",
       "watchWebUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
     }
     ```

     Both fields are present only once `isUnlocked` is `true`, so the id they are
     built from is guaranteed to be one the server has cleared this user to watch.

     **Do not assemble these from `youtubeVideoId`.** The app used to be told to
     concatenate `vnd.youtube://<youtubeVideoId>` itself, which is the same
     hand-rolled-scheme problem the `channel` object exists to solve: the scheme
     knowledge is duplicated into the client, and the bare-id form is not part of
     YouTube's documented scheme. The server now builds both forms and ships them
     next to the id. `watchUrl` is also still returned — it is the
     *embed* address for the full video, useful for an in-app web player — but it
     is the wrong URL for a "watch on YouTube" button, since it opens an embed
     page rather than the app or the mobile site.
   - All four `channel` fields are `null` when neither `YOUTUBE_CHANNEL_ID` nor
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
   - **"Subscribe to Unlock Preview" is one call:
     `POST /community/videos/:videoId/subscribe-intent`.** It records the
     `SUBSCRIBE_INTENT` funnel event and returns `{ videoId, authUrl, channel }`
     in a single round-trip. Do not also call
     `POST /community/videos/:videoId/interact` with `SUBSCRIBE_INTENT` — that
     double-counts the denominator behind `conversionRate`, which *understates*
     the rate — the unlock count does not move, only the tap count does.
   - Then, from that one response:
     - **`authUrl` non-null** → open it (section 8) to run the OAuth flow. The
       callback confirms the subscription and unlocks server-side; the browser
       lands back on your deep link with
       `?subscribed=…&unlocked=…&channelGranted=…&hasChannelAccess=…`.
     - **`authUrl` is `null`** → YouTube verification is not configured on this
       server. Send the user to `channel.appUrl` to subscribe, then call
       `POST /community/videos/:videoId/unlock`, which is client-trusted on that
       path. `null` is not an error — the endpoint deliberately does not 503,
       because the tap is still worth recording and the subscribe link is still
       worth sending.
   - `GET /community/youtube/start/:videoId` still works and returns the same
     links, but use it only to **re-run** the flow without recording a new intent
     (a retry after a cancelled consent screen, say). Calling it for the initial
     tap means going back to two calls and a separately-optional analytics call.
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
  grant (and for the rare legacy per-video unlock). Keep `watchAppUrl` /
  `watchWebUrl` alongside it once unlocked — they are only sent to you after
  unlocking, and caching them means the end-of-preview overlay can deep-link on a
  tap without waiting on a network round-trip.
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
   `PREVIEW_CLIP | WATCH_FULL_VIDEO | UNLOCK`. Pass the optional `durationMs`
   (integer ms ≥ 0) to record watch time — e.g. send `durationMs` on
   `PREVIEW_CLIP` when the user leaves the teaser, so you can measure drop-off
   within the 30s clip. Admins read the funnel (interaction counts + conversion
   rate + watch-time totals) at `GET /community/videos/:videoId/analytics`.

   **`SUBSCRIBE_INTENT` is not in that list on purpose** — it is written by
   `POST /community/videos/:videoId/subscribe-intent` (section 4), which the app
   calls anyway. Logging it a second time through `/interact` double-counts the
   denominator behind `conversionRate`, so the funnel reports a conversion rate
   roughly half of what it earned — silently, and in the self-punishing
   direction, which is the harder mistake to spot because a number that looks
   merely unimpressive invites optimising the product rather than the
   instrumentation.

### API payload contract (what the feed returns)

A **locked** card in `GET /community/videos` is:

```json
{
  "id": "uuid",
  "videoId": "uuid",
  "title": "string",
  "description": "string",
  "teaserUrl": "https://www.youtube.com/embed/VIDEO?start=0&end=30&rel=0",
  "previewStartSeconds": 0,
  "previewDurationSeconds": 30,
  "thumbnailUrl": "string",
  "viewCount": 12480,
  "likeCount": 932,
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
  "watchUrl": "https://www.youtube.com/embed/VIDEO",
  "watchAppUrl": "vnd.youtube://watch?v=VIDEO",
  "watchWebUrl": "https://www.youtube.com/watch?v=VIDEO"
}
```

- `videoId` is an **alias of `id`** (the internal card id). Use either as the
  `:videoId` path param on the detail / interact / unlock / analytics routes.
- The `:videoId` param also **accepts the YouTube id** (`youtubeVideoId`)
  directly, so deep links from YouTube never 404.
- `title`, `description`, `thumbnailUrl`, `teaserUrl` are **never null** (DB
  defaults / derived YouTube URLs). `unlockedAt` is the only nullable field.
- `viewCount` / `likeCount` are YouTube's public counters, refreshed by the admin
  channel sync. They are present on locked cards too — they describe the video
  rather than unlocking it. A `0` means either genuinely unwatched or never
  synced, so render it as "no signal yet" rather than asserting nobody watched.
- Pass `?sort=most_watched` / `?sort=most_liked` to order the feed by those
  counts; an unrecognised value falls back to `newest` and `meta.sort` reports
  what was actually applied.

#### Why the full-video fields are omitted while locked

Gating only the *playback* is theatre: the full-length link is just a string, so
any client that can read the feed can read the video. The server therefore
withholds every field that reconstructs it — `youtubeVideoId`, `watchUrl`,
`watchAppUrl` and `watchWebUrl` — and derives them on demand, only for callers
who already hold a `VideoUnlock`. The two `watch*Url` forms are the same link in
different shapes, so withholding one while sending the other would gate nothing.
Locked viewers get `teaserUrl` (bounded to the preview window by YouTube's own
`start`/`end` embed params) and `thumbnailUrl` — enough to sample the content,
not enough to watch it in full. `teaserUrl` is stored clipped, so even a client
that ignores `isUnlocked` cannot pull the whole upload out of that field.

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

- `channel_unlocks` — `(userId, channelId, unlockedAt, verifiedAt, refreshToken,
  lastVerifiedAt, revokedAt, revokedReason)` with `@@unique([userId, channelId])`.
  This is the row that actually opens the feed: once it exists and is not
  revoked, **every** card is unlocked, including videos published after the
  grant. Written by the OAuth callback on a positive subscription check, and
  re-confirmed by a daily sweep that revokes it if the subscription was
  cancelled — see [how access is granted](#how-access-is-granted). `refreshToken`
  is what makes that re-check possible; `revokedAt` non-null means the grant is
  inert and every read path filters it out.
- `video_unlocks` — `(userId, videoId, unlockedAt)` with
  `@@unique([userId, videoId])`. Still written for the video the user actually
  unlocked, because it is what the per-video analytics count
  (`WATCH_FULL_VIDEO`, conversion rate) reports on. **Not** the access
  authority — a subscriber who never opened a given card has no row for it, and
  is still served that card. It is also not an *independent* grant: it is the
  same subscription restated per card, so revoking a channel grant deletes
  these rows too. `video_interactions` is append-only and is left intact, so
  funnel analytics survive a revocation.

The `20261007_add_channel_unlocks` migration backfilled one channel row per user
from their existing `video_unlocks`, so pre-existing subscribers were not
re-gated by the move to channel-level access. Those backfilled rows have no
`refreshToken` (the round-trip that could have captured one predates the
column), so they are never re-verified and keep working — see the sweep's
fail-open rules below.
- `video_interactions` — append-only analytics rows per user action.
- Rehydrate on app launch with `GET /community/my-unlocks` — no client-side
  state migration needed. Branch on `hasChannelAccess` first: when it is `true`
  the whole feed is open, and `unlocks` only lists the cards they opened.

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
  authorized, and a user can revoke it at any time — the re-verification sweep
  picks that up and closes the grant.
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

- **The grant is re-verified, and unsubscribing costs access.** A YouTube
  subscription is mutable from outside our system, so a grant written once
  cannot stay authoritative forever. The OAuth round-trip stores Google's
  refresh token alongside the grant, and a daily sweep
  (`channel-grant-reverify`) re-runs the subscriptions check for every grant
  that has gone unconfirmed for longer than its lease. A cancelled subscription
  revokes the grant, which also deletes
  the per-video unlock rows it implies — otherwise a cancelled subscriber would
  keep the individual videos they had already opened.

  Two deliberate asymmetries in the sweep:

  - Only a **definite negative** revokes (the API returning an empty `items`
    list). A thrown error means "could not check", so a Google outage, a quota
    exhaustion, or a spent refresh token leaves the grant intact and retries on
    the next pass. Silently re-locking paying supporters on a transient error
    would be far worse than briefly over-granting. The same holds for a token
    that cannot be decrypted: it counts as `undecryptable` and is left intact.
    (Worth naming precisely, because this doc used to say the *unlock endpoint*
    "fails open" to mean the opposite — granting on a client claim. It does not,
    and must not: that is the whole point of the rewrite.)
  - Grants with **no stored refresh token** are skipped, never revoked. Rows
    created before token persistence cannot be re-checked, and revoking them
    would close access to a still-valid subscription purely because we failed to
    save a credential. They become re-verifiable the next time the user re-runs
    the flow.

  A pass is **budget-bounded, not count-bounded**. It drains the due queue in
  batches (`COMMUNITY_ACTIVE_RECHECK_BATCH`, default 200) until the queue is
  empty or `COMMUNITY_REVERIFY_BUDGET_MS`
  (default 10 min) runs out, so throughput tracks the subscriber base — the
  earlier flat 200-per-day cap silently pushed the real revocation window past
  the configured interval once the base grew past that. The job logs "Ran out of
  budget" when it stops with grants still due; that warning is the signal to
  raise the budget, not to retry.

#### Locking on read — why the sweep is not the whole answer

YouTube publishes **no event when a user unsubscribes**. There is no webhook and
no Pub/Sub topic for it; the only mechanism is polling, at 1 quota unit per
check. So revocation latency is set entirely by how often we are willing to ask.

The daily sweep alone means a cancelled subscriber keeps access until that pass
runs. That is fine for a dormant account and wrong for an active one, so the
grant is **also re-checked on the read path**: once the lease lapses
(`COMMUNITY_ACCESS_LEASE_SECONDS`, default 60s) the next request spends one unit
and the response the user is looking at is already correct. The feed, the single card,
`my-unlocks`, the unlock endpoint and the status poll all go through the same
gate, so a user who cancelled is locked on their next app open — not on the next
nightly run.

Two properties make this affordable rather than ruinous:

- **The floor is a dedup window, not a polling interval.** Cost is one unit per
  window *per user who opens the app*. An inactive subscriber costs nothing, so
  spend tracks active users rather than the total base. A 5-minute *global*
  interval would need 288 units/user/day against the 10,000/day budget — about 34
  users total. At the default, a user who opens the app a handful of times a day
  spends a handful of units.
- **A grant with no usable credential is never re-checked**, because the answer
  cannot change. No stored token, or one that cannot be decrypted after a key
  rotation, is skipped without a call — on the read path and in the sweep alike.

The sweep stays as the backstop for the accounts the read path never sees.

The upshot for the app: `hasChannelAccess` is current for anyone using the app,
and up to one interval stale for anyone who has not opened it recently. It is
for hiding subscribe CTAs, not for gating anything the user pays for.
- **The channel id comes from the callback, never from the client.** The unlock
  endpoint returns `channelGranted: false` on its own, because only the callback
  knows which channel it just verified. A client cannot ask for a grant on an
  arbitrary channel, and the row is `@@unique([userId, channelId])` so a repeat
  verification is a no-op. A grant revoked by the sweep is revived in place by
  that same upsert, so a user who resubscribes regains the feed without a second
  grant row.

The app reads this as **one** object, `access`, returned verbatim by the feed's
`meta`, by `GET /community/videos/:videoId`, by `/unlock`, and by
`GET /community/my-unlocks`. There is no per-video flag to branch on and no
`via: "CHANNEL"` — `hasChannelAccess` is derived from the snapshot's status and
lease, so it cannot disagree with them.

The callback stores the verdict with its lease **before** returning, so the
`/unlock` that follows the round-trip reads a committed decision rather than
racing one.

### Requirements

| Env var | Description |
|---------|-------------|
| `YOUTUBE_OAUTH_CLIENT_ID` | Google Cloud **OAuth 2.0 Client ID** (Web application) |
| `YOUTUBE_OAUTH_CLIENT_SECRET` | Matching client secret |
| `YOUTUBE_OAUTH_REDIRECT_URI` | HTTPS callback; **must** be added to the client's Authorized redirect URIs in the Google console. Defaults to `<API_URL>/community/youtube/callback` when using `API_URL`. |
| `YOUTUBE_VERIFY_RETURN_URL` | App deep link the browser returns to (default `daghapp://youtube/verify`). Must be parseable by `new URL()`; if it is not, the browser gets a plain HTML page stating the real outcome instead. |
| `COMMUNITY_ACCESS_LEASE_SECONDS` | How long a confirmed verdict is trusted before the next read re-checks Google (default `60`). This is the entire staleness policy — the window in which someone who cancelled keeps watching. |
| `COMMUNITY_ACTIVE_RECHECK_SECONDS` | How long a *failed* check is remembered before trying again (default `60`). Caches the inability to check, never a grant. |
| `COMMUNITY_ACTIVE_RECHECK_BATCH` | How many due grants one sweep batch claims (default `200`, clamped to [1, 2000]). |
| `COMMUNITY_REVERIFY_BUDGET_MS` | Wall-clock budget for one sweep pass (default `600000` = 10 min, clamped to [1 min, 13 min]). The pass drains the due queue until it is empty or this runs out. |
| `PAYMENT_GATEWAY_ENCRYPTION_KEY` | Seals the refresh token stored on each grant, under its own AAD context. Shared with the payment-gateway credentials — see [the note in `.env.example`](../.env.example) before rotating it. |

The same Google Cloud project needs **YouTube Data API v3** enabled. Create the
OAuth client under **APIs & Services → Credentials → Create credentials →
OAuth client ID → Web application**, then add the redirect URI.

### Endpoints

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| POST | `/community/videos/:videoId/subscribe-intent` | Bearer | **The subscribe button.** Records `SUBSCRIBE_INTENT` and returns `{ videoId, authUrl, channel }` in one call. `authUrl` is `null` (not 503) when OAuth is unconfigured — subscribe via `channel.appUrl`, then call `/unlock` |
| GET | `/community/youtube/start/:videoId` | Bearer | Returns `{ authUrl, expiresIn, channel }` without recording a new intent — use only to re-run the flow (e.g. after a cancelled consent screen). The state token inside encodes the user + video for 15 min |
| GET | `/community/youtube/callback` | Public | Google redirect target. Exchanges the code, checks `subscriptions?mine=true&forChannelId=<channel>`, stores the verdict with its lease + logs `UNLOCK` when subscribed, redirects to the return URL carrying `accessVersion` |
| GET | `/community/youtube/status/:videoId` | Bearer | The `access` snapshot (re-checked if the lease lapsed) plus `isUnlocked`, which is analytics rather than the gate |

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
- [ ] `GET /community/videos?sort=most_watched` and `?sort=most_liked` return
      cards ordered by `viewCount` / `likeCount` descending, and `meta.sort`
      reports the applied order
- [ ] Cards carry non-zero `viewCount` / `likeCount` after a sync (a fresh channel
      whose first sync reported 0 means the statistics call is failing)
- [ ] Published cards report `previewDurationSeconds: 30` (the sync only writes preview
      bounds when it first creates a card, so existing cards need the migration
      `20261012_shorten_preview_window` or a per-card `PUT`)
- [ ] A **locked** card has no `youtubeVideoId`, `watchUrl`, `watchAppUrl` or
      `watchWebUrl` anywhere in the payload, and its `teaserUrl` carries
      `start`/`end` bounds
- [ ] `POST /community/videos/:videoId/unlock` with no prior verification returns
      `403 SUBSCRIPTION_REQUIRED` (gate closed)
- [ ] `POST /community/videos/:videoId/unlock` works with the `videoId` from a card **and** with the `youtubeVideoId` of an unlocked card
- [ ] Web-view origin is in `ALLOWED_ORIGINS` (native requests need no origin)
- [ ] Server logs show a `community.feed.list` line per request and `community.feed.*.not_found` / `*.error` lines on failures
- [ ] App plays the clipped preview, then shows the CTA overlay — logs `PREVIEW_CLIP`
- [ ] The overlay appears on the player's `ended` event, not a timer: pausing or
      backgrounding mid-clip does not raise it, and it does not reappear on a
      replay until the clip finishes again
- [ ] The overlay stays put — it does not auto-dismiss or loop the clip underneath
- [ ] "Subscribe to Unlock Preview" opens `channel.appUrl` (falling back to `channel.subscribeUrl`) — **no hardcoded handle in the app**
- [ ] Changing `YOUTUBE_CHANNEL_ID` / `YOUTUBE_CHANNEL_HANDLE` changes the link the app shows, with no app release
- [ ] "Subscribe to Unlock Preview" is **one** call to `POST /community/videos/:videoId/subscribe-intent`, which logs `SUBSCRIBE_INTENT` and returns `authUrl` + `channel`
- [ ] The app does **not** also call `/interact` with `SUBSCRIBE_INTENT` — admin analytics shows it logged **once** per tap
- [ ] Consent → callback confirms the subscription, unlocks, logs `UNLOCK` once
- [ ] The unlocked card now carries `youtubeVideoId` + `watchUrl` + `watchAppUrl` + `watchWebUrl`
- [ ] The overlay's "Watch Full Video on YouTube" opens `watchAppUrl`, and falls
      back to `watchWebUrl` on a device with no YouTube app — **no scheme string
      is assembled in the app**
- [ ] "Watch Full Video on YouTube" opens the video — logs `WATCH_FULL_VIDEO`
- [ ] An overlay shown on a still-locked card offers "Subscribe to Unlock Preview" rather
      than a link, and does not attempt to open `watchAppUrl`
- [ ] Relaunching the app preserves green state via `GET /community/my-unlocks`
- [ ] A lapsed lease re-checks and closes: call `/unlock` again after
      `COMMUNITY_ACCESS_LEASE_SECONDS` on a non-subscriber and confirm `403` with a
      `reason` — never `200`
- [ ] `accessVersion` increases on a change, and a client ignores a response whose
      version is older than one it has already applied
- [ ] Subscribing on a second device pushes `community.access.changed` to the first
      device's other sessions, and an unsubscribing sweep pushes it the other way
- [ ] Admin analytics endpoint shows the funnel numbers, and
      `SUBSCRIBE_INTENT` is not double-counted
---

## 10. Before you launch: channel-incentive policy review

**This is not a code task and nothing in this repo satisfies it for you. Get it
reviewed before the flow ships.**

The feature as built gates your own content behind a subscribe action on *your*
channel, and sends users off-platform via a deep link. That is squarely the shape
YouTube's policies govern, and two are worth reading against the real text
rather than trusting a summary:

- **API Terms of Service / developer policies** — the YouTube Data API is granted
  for integrating YouTube functionality, and the terms restrict using API results
  to promote off-YouTube activity and require the API not be used to incentivize
  engagement in ways YouTube has not sanctioned. "Unlock the full video by
  subscribing" is a channel-growth incentive built on API-verified subscription
  data, so read the current terms against that specific mechanism.
- **Spam and deceptive practices / engagement-bait policy** — requiring an action
  in order to access content can be treated as engagement-bait even when the
  content and the channel are the same property.

**What is explicitly in scope for review:** the fact that the subscription check
uses the Data API's `subscriptions.list`, and that the unlock is conditioned on
its result, makes this API-verified incentivization rather than a client-asserted
claim. If the check were purely client-side the framing would be different; it is
not.

**What the implementation deliberately does not do**, so the exposure is bounded
rather than hidden:

- No reward, prize, discount, or reciprocal benefit is offered. The unlocked
  content is the *same* creator's, which is the strongest argument available that
  this is a channel-follow funnel rather than an incentive scheme.
- The teaser is a real 30-second excerpt of the same video, not a withheld
  original, and the overlay is shown on the user's own action after it plays.
- Nothing auto-subscribes, auto-likes, or auto-comments. YouTube exposes no such
  capability, and the flow asks the user to do it themselves.

**Practical mitigations if review comes back negative**, roughly in order of
cost:

1. Make the teaser the default experience and the subscribe CTA a secondary
   action. Nothing in the code prevents this — it is presentation.
2. Keep the overlay copy informational ("enjoyed the preview? the full
   discussion is on the channel") rather than making the unlock a condition of
   finishing the clip.
3. Ship the 30s teaser for all users and drop the gate entirely, keeping
   `hasChannelAccess` only for the deeper archive.

**Decide this before launch, not after.** The unlock endpoint fails open when
`YOUTUBE_OAUTH_*` is unconfigured, which is what local dev relies on and what
makes a staged rollout easy — but it also means a production deploy that quietly
misses the env vars is not a broken demo, it is a public feed. Confirm
`YOUTUBE_OAUTH_CLIENT_ID` is set in the target environment and check the boot log
line that says so, as part of the same pre-launch pass.

### Pre-launch policy sign-off

- [ ] The channel-incentive question in [section 10](#10-before-you-launch-channel-incentive-policy-review)
      has been reviewed against the current YouTube API Terms and engagement-bait
      policy by someone qualified to make that call, and the outcome recorded
      here:
      <!-- Reviewer / date / outcome -->
- [ ] `YOUTUBE_OAUTH_CLIENT_ID` is confirmed present in the **target production
      environment** (not just locally), and the boot log does not contain the
      "client is unconfigured" warning
