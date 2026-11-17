# Payments and Apple Sign In

Consolidated overview of how payments (Hubtel) and Apple Sign In work in
dagh-server. Deeper references: `payment-gateway-settings.md`,
`payment-control-system.md`, `payment-gateway-frontend-guide.md`,
`oauth-deployment-config.md`, `docs/admin-gateway-registration.md`,
`ios-auth.md`.

## Payments (Hubtel)

### Architecture

- Provider: **Hubtel** (Mobile Money + card + Apple Pay). Credentials are stored encrypted
  in `PaymentGatewayConfig` (AES-256-GCM, AAD-bound per field) and resolved at
  runtime with a 10s cache, falling back to env vars (`HUBTEL_CLIENT_ID`,
  `HUBTEL_CLIENT_SECRET`).
- A master switch `paymentProcessingEnabled` (on `PaymentGatewayConfig`) gates
  all payment initialization. Admins toggle it via `/admin/settings/payment-gateway`
  or the legacy `/admin/payments/status`. When disabled, init endpoints return
  `503`. Verification/status/callback endpoints are never gated.
- Hubtel calls back to `callbackUrl` (server) and redirects the browser to
  `returnUrl`/`cancellationUrl` (client).
- Apple Pay payments are initialized via `POST /payment/apple-pay` and labeled
  with `provider: "APPLE_PAY"` in the database. The payment flow is identical to
  Hubtel checkout, with the provider source tracked for analytics/reporting.

### Flow

1. Client calls `POST /payment/initialize` (or MOMO/subscription variants) with
   amount, description, and return/callback/cancellation URLs.
2. Server checks `isPaymentsEnabled()`; if disabled → `503`.
3. Server creates a Hubtel checkout and persists a `Payment` row
   (`status = PENDING`).
4. Server returns `paymentReference` + checkout URL; client redirects to Hubtel.
5. Hubtel redirects browser to `returnUrl` on success/cancel.
6. Hubtel POSTs to `callbackUrl`; server verifies and updates `Payment.status`
   to `SUCCESS`/`FAILED`.
7. Client polls `GET /payment/status/:reference` (or relies on socket) to confirm.

### Key endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/payment/initialize` | Bearer | Start a checkout (Hubtel). |
| POST | `/payment/initialize-momo` | Bearer | Mobile Money specific init. |
| POST | `/payment/subscription` | Bearer | Paid membership upgrade. |
| POST | `/payment/apple-pay` | Bearer | Apple Pay init (labeled as APPLE_PAY provider). |
| GET | `/payment/status/:reference` | Bearer | Check payment status. |
| POST | `/payment/callback` | Public | Hubtel server-to-server callback. |
| GET | `/payment/status` | Public | Global payment-enabled flag. |
| PATCH | `/admin/payments/status` | Admin | Legacy toggle. |
| (admin settings) | `/admin/settings/payment-gateway/*` | Admin (scoped) | Credentials, env, verify, master switch. |

### Config (env)

- `HUBTEL_CLIENT_ID`, `HUBTEL_CLIENT_SECRET` — fallback credentials.
- `PAYMENT_GATEWAY_ENCRYPTION_KEY` — AES key for stored secrets.
- `PAYMENTS_ENABLED` — legacy fallback when no DB row exists.
- Apple Pay uses the same Hubtel credentials above; no additional env vars are
  required.

## Apple Sign In

### Configuration

Apple Sign In is configured via `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`,
`APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY` (or `APPLE_PRIVATE_KEY_PATH`).
`getAppleSignInConfig()` returns `null` when incomplete, and `/auth/apple`
responds `503`. See `docs/oauth-deployment-config.md`.

- `APPLE_CLIENT_ID` = Services ID (e.g. `com.example.service.signin`).
- `APPLE_BUNDLE_ID` = app bundle id; PushKit topic is `<bundle-id>.voip`.
- `APPLE_CALLBACK_URL` = `https://<host>/auth/apple/callback`.

### Flow

1. Client opens `/auth/apple?redirect=<app-return-url>` (optional exact app
   destination).
2. Server validates the redirect against the allow-list, issues a single-use
   OAuth state token bound to the session, and redirects to Apple.
3. Apple authenticates the user and POSTs `code` + `id_token` to
   `/auth/apple/callback`.
4. Server verifies the `id_token` (issuer `https://appleid.apple.com`, audience
   = client id), extracts the stable `sub` claim as `appleId`.
5. `resolveAppleUser` resolves the local account:
   - by `appleId` (normal case);
   - by verified email, linking `appleId` (if no conflict);
   - create new account (only if Apple supplied an email).
   Email conflicts across two Apple identities are rejected
   (`AppleIdentityConflictError`).
6. Server stores the Apple refresh token (encrypted) for later revocation and
   issues the app session/JWT, redirecting to the app return URL.

### Apple refresh-token revocation

On account deletion, `revokeAppleRefreshToken` decrypts the stored token and
calls Apple's revoke endpoint (best-effort; never blocks deletion). Requires
`PAYMENT_GATEWAY_ENCRYPTION_KEY`/the configured encryption key.

### Apple-specific platform rules

- iOS digital memberships must use Apple In-App Purchase unless the deployment
  holds Apple's external-purchase entitlement (`client-platform.ts`).
- Paid digital membership purchase on iOS without the entitlement is blocked
  (`403` with `DIGITAL_PURCHASE_REQUIRES_IAP`) on `/membership/subscribe`,
  `/payment/initialize` (targetType `MEMBERSHIP_SUBSCRIPTION`),
  `/payment/apple-pay` (targetType `MEMBERSHIP_SUBSCRIPTION`), and
  `/payment/subscription`.

### Key endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/auth/apple` | Public | Initiate Apple Sign In. |
| GET/POST | `/auth/apple/callback` | Public | Apple callback. |
| GET | `/auth/apple/success` | Public | Success landing. |
| GET | `/auth/apple/failed` | Public | Failure landing. |
