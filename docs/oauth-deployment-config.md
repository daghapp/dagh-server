# OAuth Deployment & Provider Configuration Runbook

How to configure Google, Facebook, and Apple Sign-In so the mobile OAuth flow
works against the production backend (`https://dagh-server-fo64.onrender.com`).
This is the **deployment/config** companion to `docs/frontend-oauth-integration.md`;
the backend code itself already implements the required flow.

> TL;DR — two things break production OAuth and both are configuration:
> 1. A provider callback URL pointing at an old domain (e.g. `dagh-server-3.onrender.com`).
> 2. Apple Sign In env vars never set → `/auth/apple` returns **503** (by design).

---

## 1. Production values (single source of truth)

| Provider | Initiation | Callback (must be registered) |
| -------- | ---------- | ----------------------------- |
| Google   | `GET /auth/google` | `https://dagh-server-fo64.onrender.com/auth/google/callback` |
| Facebook | `GET /auth/facebook` | `https://dagh-server-fo64.onrender.com/auth/facebook/callback` |
| Apple    | `GET /auth/apple` | `https://dagh-server-fo64.onrender.com/auth/apple/callback` (POST) |

The app never calls the callback; the provider's browser does. After the
backend exchanges the code it redirects to `diasporansync:///oauth?accessToken=…&refreshToken=…&provider=…&email=…`, or `…?error=…` on failure.

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
   - Set `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CALLBACK_URL`.
3. Apple posts the callback as `application/x-www-form-urlencoded` POST. The
   server's session cookie uses `sameSite: none` in production so it survives
   Apple's cross-site POST (commit `0032648`).

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

# 2. Allowed deep link from the state (base64url): must decode diasporansync:///oauth.
#    Non-matching redirect is silently dropped — no open redirect.

# 3. Callback without a real code cannot be tested; it fails state/auth on purpose.
#    Test the full flow on a physical device via WebBrowser.openAuthSessionAsync.
```

What to check:

- Google **302 Location** contains `state=`.
- Facebook **302 Location** contains `state=` and a callback on the current domain.
- Success (device test) lands on
  `diasporansync:///oauth?accessToken=…&refreshToken=…&provider=google&email=…`.
- Failure lands on `diasporansync:///oauth?error=…`.
- `/auth/google/success` without the mobile redirect shows the fallback page
  with the **Open Diaspora Sync** handoff button; it must not print tokens.

---

## 7. Common failures → fixes

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| Facebook init redirects to old domain callback | `FACEBOOK_CALLBACK_URL` stale on server | Set to current domain, redeploy |
| Facebook login error "redirect_uri is not an authorized URI" | Missing in Facebook console | Add to **Valid OAuth Redirect URIs** |
| `/auth/apple` → 503 | Apple env vars or private key missing | Set all vars and supply `APPLE_PRIVATE_KEY` (inline) or a valid `APPLE_PRIVATE_KEY_PATH` |
| Apple consent error "redirect URL not validated" | Redirect URL not re-entered on first save | Edit Services ID → re-enter URL → Save |
| App never reopens after success page | Browser (not app) hit `/auth/google/success` | Use `WebBrowser.openAuthSessionAsync` with the `redirect` param |

---

## 8. Code-level guarantees already in place (no change needed)

- Random 32-byte, single-use `state` bound to the server session; validated and
  consumed on callback — `src/modules/authentication/oauth-state.ts`.
- Apple accounts are keyed by Apple's stable `sub` (`users.appleId`), never by a
  missing-email fallback; a legacy email-matched account is linked on first
  Apple login — `src/modules/authentication/apple-identity.ts`.
- Apple refresh tokens are stored encrypted and revoked on account deletion —
  `src/services/apple-token.service.ts`.
- Only `diasporansync:///oauth` is an approved return destination.
- Provider codes are exchanged server-side by Passport; the app only ever
  receives backend-issued JWTs.
- Deep links built with `new URL(...)` so token values are encoded —
  `src/modules/authentication/oauth-handler.ts`.
- Session persists in Postgres (survives restarts, shared across instances) —
  `src/config/session.ts`.
- Success page auto-redirects only when the embedded link carries `accessToken=`,
  and always shows a manual **Open Diaspora Sync** button —
  `src/views/auth-success.html`.

---

*Backend code references: `src/routes/{google,facebook,apple}-auth.routes.ts`,
`src/config/passport.ts`, `src/modules/authentication/oauth-state.ts`,
`src/modules/authentication/oauth-handler.ts`.*