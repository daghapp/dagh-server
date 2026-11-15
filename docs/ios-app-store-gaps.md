# iOS App Store — Recent Backend Changes and Remaining Work

## Changes made

### 1. Closed iOS digital-purchase bypasses (Guideline 3.1.1)

`POST /payment/initialize` was already gated, but two other doors could still
initiate a paid membership checkout on iOS:

- `POST /payment/apple-pay` — now returns `403 DIGITAL_PURCHASE_REQUIRES_IAP`
  when `targetType === MEMBERSHIP_SUBSCRIPTION` on an iOS client without the
  external-purchase entitlement.
- `POST /payment/subscription` — now returns the same `403` for every iOS
  request, since the endpoint exists only to create a paid membership invoice.

Both use the same `client-platform.ts` policy as `/membership/subscribe`, so
free plans, fee-waived accounts, Android, and web are unaffected.

### 2. Sign in with Apple token revocation on linked accounts (Guideline 5.1.1(v))

`DELETE /profile/account` previously revoked the Apple grant only when
`authProvider === "ICLOUD"`. An account created through Google/Facebook and
later linked to Apple still stores an `appleRefreshToken`, so revocation was
skipped for those users. The condition is now `if (user.appleRefreshToken)`,
so any account holding an Apple refresh token is revoked (best-effort, never
blocking deletion).

## Verification

```bash
npx vitest run tests/ios-purchase-gate.test.ts tests/apple-token.test.ts tests/apple-identity.test.ts tests/delete-account-validator.test.ts
npx eslint src/modules/payment-management/payment.controller.ts src/modules/profile-management/account-profile.controller.ts
```

## Still outstanding

Blocking (config / app side):

- Apple Sign In env vars unset on Render → `GET /auth/apple` returns `503`.
  Set `APPLE_CLIENT_ID` (Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID`,
  `APPLE_CALLBACK_URL`, and `APPLE_PRIVATE_KEY` (or `APPLE_PRIVATE_KEY_PATH`),
  plus APNs vars for VoIP pushes. See `docs/apple-setup-requirements.md`.
- Render free-tier cold starts during review — warm the instance or use an
  always-on host.
- 1024×1024 marketing icon exported with transparency — re-export opaque PNG
  in the app project.
- iOS client must hide/redirect paid membership purchase (or implement
  StoreKit 2 / External Purchase Link). Do not open a Hubtel checkout on iOS.

Non-blocking follow-ups:

- App must expose in-app account deletion and must not prompt OAuth users for a
  password (backend already supports this).
- Content reporting is user-scoped via `/messages/report`; review whether
  profile/community surfaces need their own report entry points for
  Guideline 1.2.
- `PAYMENT_GATEWAY_ENCRYPTION_KEY` must be set in every environment where Apple
  token revocation should work.
" filePath=/home/hollali/Projects/dagh-server/docs/ios-app-store-gaps.md