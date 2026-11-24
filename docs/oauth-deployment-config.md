# OAuth Deployment & Provider Configuration Runbook

How to configure Google, Facebook, and Apple Sign-In so the mobile OAuth flow
works against the production backend (`https://dagh-server-fo64.onrender.com`).
This is the **deployment/config** companion to `docs/frontend-oauth-integration.md`;
the backend code itself already implements the required flow.

> TL;DR — two things break production OAuth and both are configuration:
>
> 1. A provider callback URL pointing at an old domain (e.g. `dagh-server-3.onrender.com`).
> 2. Apple Sign In env vars never set → `/auth/apple` returns **503** (by design).

---

## 1. Production values (single source of truth)

| Provider | Initiation           | Callback (must be registered)                                      |
| -------- | -------------------- | ------------------------------------------------------------------ |
| Google   | `GET /auth/google`   | `https://dagh-server-fo64.onrender.com/auth/google/callback`       |
| Facebook | `GET /auth/facebook` | `https://dagh-server-fo64.onrender.com/auth/facebook/callback`     |
| Apple    | `GET /auth/apple`    | `https://dagh-server-fo64.onrender.com/auth/apple/callback` (POST) |

The app never calls the callback; the provider's browser does. After the
backend exchanges the code, Google/Facebook redirect to
`diasporansync:///oauth?accessToken=…&refreshToken=…&provider=…&email=…` while
Apple redirects to `diasporansync:///oauth#accessToken=…&refreshToken=…&provider=apple&email=…`.
Failures use the query string: `diasporansync:///oauth?error=…`.

---

## 2. Required env vars (Render / host)

```
REDIRECTURI=https://dagh-server-fo64.onrender.com/auth/google/callback
FACEBOOK_CALLBACK_URL=https://dagh-server-fo64.onrender.com/auth/facebook/callback
APPLE_CLIENT_ID=<Services ID bundle id>
APPLE_TEAM_ID=<10-char Team ID>
APPLE_KEY_ID=<10-char Key ID>
# Supply the .p8 EITHER inline (Render-friendly) ...
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
# ... OR as a file mounted on the host. Inline wins; a missing path counts as unconfigured.
# APPLE_PRIVATE_KEY_PATH=/etc/secrets/AuthKey_<keyid>.p8
APPLE_CALLBACK_URL=https://dagh-server-fo64.onrender.com/auth/apple/callback
APP_OAUTH_REDIRECTS=diasporansync:///oauth
APPLE_OAUTH_STATE_SECRET=<optional; falls back to JWT_ACCESS_SECRET>
```

`CLIENTID` / `CLIENTSECRETE` (Google) and `FACEBOOK_APP_ID` /
`FACEBOOK_APP_SECRET` are the provider secrets from the developer consoles.

---

## 3. Google

1. Google Cloud Console → **APIs & Services → Credentials** → OAuth 2.0 Client IDs.
2. Authorized redirect URI must be exactly `…/auth/google/callback`.
3. On the server: `CLIENTID`, `CLIENTSECRETE`, `REDIRECTURI`.

If `REDIRECTURI` is unset the server still registers Google with a
localhost fallback (see `src/config/passport.ts`); set it for production.

---

## 4. Facebook

Observed bug: the deployed app pointed its callback at the **old** domain
(`https://dagh-server-3.onrender.com/auth/facebook/callback`). Fix both places:

1. **Backend env:** `FACEBOOK_CALLBACK_URL` → current domain (see section 1).
2. **Facebook Developer Console → App → Facebook Login → Settings:**
   add `https://dagh-server-fo64.onrender.com/auth/facebook/callback` to
   **Valid OAuth Redirect URIs**.
3. The app needs the `email` permission; if users deny it the backend redirects
   back with `error`.

> The 2026-09-09 verification also saw **no `state` parameter** in Facebook's
> initiation redirect. That run predated commit `8147ae6`; the current routes
> forward an unpredictable, single-use state to all three providers
> (`createOAuthState` in `src/modules/authentication/oauth-state.ts`). Redeploy,
> then re-check with the verification commands below.

---

## 5. Apple Sign In

`/auth/apple` returns **503 until the credentials and a usable private key are
set** — that is the intended guard, not a bug. Both `APPLE_PRIVATE_KEY` (inline)
and `APPLE_PRIVATE_KEY_PATH` (existing file) satisfy the key requirement; see
`src/config/apple.ts`.

Steps:

1. **Apple Developer** → Certificates, Identifiers & Profiles:
   - **Register a Services ID** (this is `APPLE_CLIENT_ID`, e.g. `com.example.service.signin`).
   - In the Services ID, enable **Sign in with Apple**, configured as a **web app**,
     and for the first save **re-enter** the Redirect URL
     `https://dagh-server-fo64.onrender.com/auth/apple/callback` (Apple requires it
     to be typed twice) and click **Save**.
   - Under **Keys → Create a key**, enable **Sign in with Apple**, associate the
     Services ID, and download the `.p8` file (`APPLE_KEY_ID` is on the file:
     `AuthKey_<keyid>.p8`).
2. **On the server host:**
   - Add the `.p8` contents as `APPLE_PRIVATE_KEY` (keep the newlines as `\n`
     escapes), or mount it as a secret file and set `APPLE_PRIVATE_KEY_PATH` to
     that path (e.g. `/etc/secrets/AuthKey_<keyid>.p8`). Inline wins when both
     are present. Never commit the key.
   - Set `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CALLBACK_URL` (HTTPS only),
     `APP_OAUTH_REDIRECTS`, and optionally `APPLE_OAUTH_STATE_SECRET`.
3. Apple posts the callback as `application/x-www-form-urlencoded` POST. The
   Apple callback is stateless: the signed `state` carries the allowlisted app
   return destination and nonce hash, so no session cookie is required.
4. `GET /auth/apple` now sends Apple `redirect_uri` equal to the HTTPS backend
   callback and `response_mode=form_post`; the app deep link is never sent to
   Apple.

---

## 6. Verification commands (curl)

Run from any machine; these are read-only and do not complete a login.

```bash
BASE=https://dagh-server-fo64.onrender.com
REDIRECT='diasporansync:///oauth'

# 1. Initiation must 302 to the provider and carry a state param.
curl -si "$BASE/auth/google?redirect=$REDIRECT"   # -> accounts.google.com ... state=...
curl -si "$BASE/auth/facebook?redirect=$REDIRECT" # -> www.facebook.com ... state=...
curl -si "$BASE/auth/apple?redirect=$REDIRECT"    # 302 (or 503 if Apple unconfigured)

# 2. Apple 302 Location must include redirect_uri=https://dagh-server-fo64.onrender.com/auth/apple/callback
#    and response_mode=form_post. A custom redirect must be allowlisted via APP_OAUTH_REDIRECTS.

# 3. Callback without a real code cannot be tested; it fails state/auth on purpose.
#    Test the full flow on a physical device via WebBrowser.openAuthSessionAsync.
```

What to check:

- Google **302 Location** contains `state=`.
- Facebook **302 Location** contains `state=` and a callback on the current domain.
- Success (device test) lands on
  `diasporansync:///oauth?accessToken=…&refreshToken=…&provider=google&email=…`
  for Google/Facebook, or
  `diasporansync:///oauth#accessToken=…&refreshToken=…&provider=apple&email=…`
  for Apple.
- Failure lands on `diasporansync:///oauth?error=…`.
- `/auth/google/success` without the mobile redirect shows the fallback page
  with the **Open Diaspora Sync** handoff button; it must not print tokens.

---

## 7. Common failures → fixes

| Symptom                                                      | Cause                                        | Fix                                                                                      |
| ------------------------------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Facebook init redirects to old domain callback               | `FACEBOOK_CALLBACK_URL` stale on server      | Set to current domain, redeploy                                                          |
| Facebook login error "redirect_uri is not an authorized URI" | Missing in Facebook console                  | Add to **Valid OAuth Redirect URIs**                                                     |
| `/auth/apple` → 503                                          | Apple env vars or private key missing        | Set all vars and supply `APPLE_PRIVATE_KEY` (inline) or a valid `APPLE_PRIVATE_KEY_PATH` |
| Apple consent error "redirect URL not validated"             | Redirect URL not re-entered on first save    | Edit Services ID → re-enter URL → Save                                                   |
| App never reopens after success page                         | Browser (not app) hit `/auth/google/success` | Use `WebBrowser.openAuthSessionAsync` with the `redirect` param                          |

---

## 8. Code-level guarantees

- Google/Facebook use random session-bound `state`; Apple uses signed stateless
  state containing the app redirect and nonce hash —
  `src/modules/authentication/oauth-state.ts`,
  `src/modules/authentication/apple-oauth-state.ts`.
- Apple accounts are keyed by Apple's stable `sub` (`users.appleId`), never by a
  missing-email fallback; a legacy email-matched account is linked on first
  Apple login — `src/modules/authentication/apple-identity.ts`.
- Apple `id_token` is verified against Apple's JWKS (RS256, issuer, audience,
  expiration, nonce) before creating a session —
  `src/services/apple-oauth.service.ts`.
- Apple refresh tokens are stored encrypted and revoked on account deletion —
  `src/services/apple-token.service.ts`.
- Only `diasporansync:///oauth` and values from `APP_OAUTH_REDIRECTS` are
  approved return destinations.
- Provider codes are exchanged server-side; the app only ever receives
  backend-issued JWTs.
- Deep links are built with `new URL(...)` so token values are encoded —
  `src/modules/authentication/oauth-handler.ts`,
  `src/modules/authentication/apple-auth.controller.ts`.
- Session persists in Postgres (survives restarts, shared across instances) —
  `src/config/session.ts`.
- Success page auto-redirects only when the embedded link carries `accessToken=`,
  and always shows a manual **Open Diaspora Sync** button —
  `src/views/auth-success.html`.

---

_Backend code references: `src/routes/{google,facebook,apple}-auth.routes.ts`,
`src/config/passport.ts`, `src/modules/authentication/oauth-state.ts`,
`src/modules/authentication/oauth-handler.ts`._
