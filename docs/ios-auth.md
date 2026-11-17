# iOS Authentication

Guide for integrating iOS app authentication with dagh-server.

## Overview

iOS clients authenticate through the same OAuth/password flows as web, but the
server issues JWT access/refresh tokens that the app stores in the Keychain. Apple
Sign In is the primary native provider; Google/Facebook are also supported via
the web OAuth redirect flow. Password login uses `POST /auth/login`.

## Apple Sign In flow

1. App opens `GET /auth/apple?redirect=diasporansync:///oauth`.
2. Server validates the redirect against the allow-list, issues a single-use
   OAuth state token bound to the session, and redirects to Apple.
3. Apple authenticates the user and POSTs `code` + `id_token` to
   `/auth/apple/callback` (`response_mode=form_post`).
4. Server verifies the `id_token` (issuer `https://appleid.apple.com`,
   audience = `APPLE_CLIENT_ID`), extracts the stable `sub` as `appleId`.
5. `resolveAppleUser` resolves the local account:
   - by `appleId` (normal case);
   - by verified email, linking `appleId` (no conflict);
   - creates a new account only if Apple supplied an email.
   Email conflicts across two Apple identities are rejected
   (`AppleIdentityConflictError`).
6. Server stores the Apple refresh token (encrypted) for later revocation and
   issues app session JWTs, redirecting to the app return URL.

### App return URL

Allowed destination (exact match only):

```
diasporansync:///oauth
```

The server appends query params to this deep link:

- `accessToken`
- `refreshToken`
- `provider` (`apple`)
- `email`
- `accessVersion`
- `hasChannelAccess`

On failure:

- `error=OAuth authorization failed`

## Token handling

- Access token: short-lived JWT used as `Authorization: Bearer <token>`.
- Refresh token: longer-lived JWT used to obtain new access tokens.
- Web sessions also set `accessToken`/`refreshToken` httpOnly cookies.

## Configuration (env)

Required for Apple Sign In:

- `APPLE_CLIENT_ID` (Services ID)
- `APPLE_TEAM_ID`
- `APPLE_KEY_ID`
- `APPLE_PRIVATE_KEY` or `APPLE_PRIVATE_KEY_PATH`
- `APPLE_CALLBACK_URL` = `https://<host>/auth/apple/callback`
- `APPLE_BUNDLE_ID` (bundle id; PushKit topic is `<bundle-id>.voip`)

Optional/related:

- `PAYMENT_GATEWAY_ENCRYPTION_KEY` — encrypts stored Apple refresh tokens.
- `JWT_ACCESS_SECRET` — signs session JWTs.

If Apple Sign In is incomplete, `/auth/apple` returns `503`.

## Apple refresh-token revocation

On account deletion, `revokeAppleRefreshToken` decrypts the stored token and calls
Apple's revoke endpoint. Best-effort: never blocks deletion. Requires the
configured encryption key.

## iOS platform rules

- Digital memberships on iOS must use Apple In-App Purchase unless the deployment
  holds Apple's external-purchase entitlement (`client-platform.ts`).
- Paid digital membership purchase on iOS without the entitlement is blocked
  (`403` `DIGITAL_PURCHASE_REQUIRES_IAP`) on:
  - `/membership/subscribe`
  - `/payment/initialize` (`targetType=MEMBERSHIP_SUBSCRIPTION`)
  - `/payment/apple-pay` (`targetType=MEMBERSHIP_SUBSCRIPTION`)
  - `/payment/subscription`

## Key endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/auth/apple` | Public | Initiate Apple Sign In. |
| POST | `/auth/apple/callback` | Public | Apple callback (`form_post`). |
| GET | `/auth/apple/success` | Public | Success landing. |
| GET | `/auth/apple/failed` | Public | Failure landing. |
| POST | `/auth/login` | Public | Password login. |
| POST | `/auth/refresh-token` | Public | Refresh access token. |

## Error handling

- `503` — Apple Sign In not configured.
- `401` — invalid/expired token or failed OAuth.
- `403` — iOS digital purchase requires IAP.
- `AppleIdentityConflictError` — email conflict across Apple identities.
