# Apple Sign In & APNs — Setup Requirements

## Summary
Apple login on the server is **not yet active**. The server already has
identifiers (Team ID, Key ID, bundle ID) but is missing the secret key
material and a web-compatible Apple client ID. Until those are provided,
`GET /auth/apple` returns `503 "Apple Sign In is not configured"`.

Two separate Apple features use the same `.p8` key, but need different
identifiers:

| Feature | Uses | Client ID type |
|---|---|---|
| Sign in with Apple (web OAuth via this server) | `.p8` key | **Services ID** (not bundle ID) |
| APNs VoIP pushes (iOS incoming calls) | `.p8` key | Bundle ID (app) |

## What we already have
- Team ID: `8RV3T6S895`
- Key ID: `48ZFS4U4JV`
- App bundle ID: `com.simplymark.diasporansync`
- App callback scheme: `diasporansync:///oauth`

## What is needed

### 1. The `.p8` private key file (secret)
The actual PEM contents of the key created in Apple Developer → Keys.
Fingerprints alone are not usable. We need the full file text:

```
-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----
```

This single key must have **both** services enabled in the Apple console:
- Apple Push Notifications service (APNs) — already enabled
- Sign in with Apple — **must be enabled** (edit the key, or create a new one)

### 2. A Services ID (for Sign in with Apple)
Create one in Apple Developer → Identifiers → Services IDs, e.g.
`com.simplymark.diasporansync.service`, enable "Sign in with Apple", and
register the server callback URL as an authorized redirect URI:

```
https://dagh-server-fo64.onrender.com/auth/apple/callback
```

The bundle ID (`com.simplymark.diasporansync`) cannot be used as the
`APPLE_CLIENT_ID` for this server's web OAuth flow — Apple requires a
Services ID for web-based Sign in with Apple.

### 3. Environment variables on Render
Set these in the Render dashboard (they are `sync: false`):

Sign in with Apple:
- `APPLE_CLIENT_ID` = the Services ID (step 2)
- `APPLE_TEAM_ID` = `8RV3T6S895`
- `APPLE_KEY_ID` = `48ZFS4U4JV`
- `APPLE_CALLBACK_URL` = `https://dagh-server-fo64.onrender.com/auth/apple/callback`
- `APPLE_PRIVATE_KEY` = the `.p8` PEM (with `\n` escapes for newlines)

APNs (iOS VoIP call pushes):
- `APPLE_APNS_KEY_ID` = `48ZFS4U4JV`
- `APPLE_APNS_TEAM_ID` = `8RV3T6S895`
- `APPLE_BUNDLE_ID` = `com.simplymark.diasporansync`
- `APPLE_APNS_P8_KEY` = the same `.p8` PEM
- `APPLE_APNS_PRODUCTION` = `true` for production (omit for sandbox)

### 4. Redeploy
After the env vars are set, redeploy the service so passport registers the
Apple strategy. `/auth/apple` will stop returning 503.

## Out of scope / already handled
- Callback route, id_token verification, user resolution, and encrypted
  refresh-token storage are implemented in the codebase.
- No code changes are needed — this is purely configuration.
