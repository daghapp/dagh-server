# App Store Review Remediation

Status of the five rejection risks raised for the iOS build, mapped to this
backend repo. Each finding has an owner, the exact server-side change (if any),
what still has to happen in the app, and an acceptance check.

| #   | Finding                                           | Guideline                       | Backend                                                | App                                        | Blocking?          |
| --- | ------------------------------------------------- | ------------------------------- | ------------------------------------------------------ | ------------------------------------------ | ------------------ |
| 1   | Memberships sold through external Hubtel checkout | 3.1.1 (3.1.3(e) for tours/visa) | **Done** — iOS paid-tier gate                          | Hide/redirect iOS purchase or add StoreKit | Yes                |
| 2   | Apple Sign In returns 503                         | 4.8                             | **Done** — inline `.p8` support; config still required | Keep Apple button visible                  | Yes, until env set |
| 3   | OAuth-only users cannot delete account            | 5.1.1(v)                        | **Already compliant**                                  | Expose in-app delete                       | No                 |
| 4   | 1024×1024 marketing icon has transparency         | 2.3.1 / ASC validation          | N/A (no assets in repo)                                | Re-export opaque PNG                       | Yes                |
| 5   | Render free-tier cold starts during review        | Review reliability (F-025)      | **Mitigated** — health check + keep-alive              | None                                       | Yes, until warmed  |

---

## 1. Guideline 3.1.1 — external checkout for digital memberships

Memberships are digital goods consumed in the app. Selling them through Hubtel's
hosted checkout inside an iOS app is the violation. Physical/person-to-person
services (tours) and government fees (visa-on-arrival) are the 3.1.3(e)
exception; do not use that exception for membership tiers.

### Backend behavior (implemented)

`POST /membership/subscribe` now rejects a **paid** membership for clients that
declare `platform=ios`, unless the deployment has Apple's External Purchase Link
entitlement:

```http
403
{
  "success": false,
  "error": {
    "code": "DIGITAL_PURCHASE_REQUIRES_IAP",
    "message": "Digital memberships on iOS must be purchased through Apple In-App Purchase."
  }
}
```

The client declares its platform with either:

- `X-Client-Platform: ios` (preferred), or
- `"platform": "ios"` in the subscribe body.

A User-Agent fallback catches iOS clients that set neither. Free plans and
fee-waived/admin-comped accounts are unaffected, as are Android and web. The
same gate is applied to `POST /payment/initialize` when its raw `targetType` is
`MEMBERSHIP_SUBSCRIPTION`, and to `POST /payment/apple-pay` (when its
`targetType` is `MEMBERSHIP_SUBSCRIPTION`) and `POST /payment/subscription`
(which exists only to create a paid membership invoice), so none of the payment
endpoints can be used to bypass the membership route.

Relevant code:

- `src/helpers/client-platform.ts` — detection and policy.
- `src/services/membership.service.ts` — gate before any payment row or Hubtel call.
- `src/modules/membership/membership.controller.ts` — 403 mapping and logging.
- `src/modules/payment-management/payment.controller.ts` — same gate on the
  generic payment-initialize path.
- `src/validator/membership-validator.ts` — optional `platform` fallback.

Configuration:

```bash
# Default. Paid digital memberships are blocked on iOS.
IOS_EXTERNAL_DIGITAL_PURCHASES=false

# Only for builds shipping Apple's External Purchase Link entitlement.
IOS_EXTERNAL_DIGITAL_PURCHASES=true
```

### App work still required

Pick one:

1. **Recommended for review:** hide paid membership purchase on iOS while
   keeping the plans visible as informational, or route iOS users to a message
   that memberships are managed on the web. Free membership remains available.
2. Implement StoreKit 2 for the paid tiers and verify the transaction
   server-side before activating the subscription row. This is a new payment
   path, not a flag flip.
3. Use Apple's External Purchase Link entitlement where the storefront permits
   it, then set `IOS_EXTERNAL_DIGITAL_PURCHASES=true` and document the reviewer
   path.

Do **not** ship an iOS build that ignores the 403 and still opens a Hubtel
checkout — the gate is server-side, so a stale client will simply show an error.

### Acceptance

- On an iOS client, `POST /membership/subscribe` for any plan with `price > 0`
  returns 403 with `DIGITAL_PURCHASE_REQUIRES_IAP`.
- The same request with `X-Client-Platform: android` (or web) reaches checkout.
- `GET /membership/plans` and free-plan activation still work on iOS.
- Reviewer notes explain where memberships are purchased, if hidden on iOS.

---

## 2. Guideline 4.8 — Sign in with Apple

The backend implements the full Apple OAuth round-trip. `/auth/apple` returning
503 is the intended guard when credentials are missing, not a code defect.
Google/Facebook cannot remain without Apple under 4.8.

### Backend change (implemented)

`GET /auth/apple` now redirects to Apple with the backend HTTPS callback
(`redirect_uri=https://dagh-server-fo64.onrender.com/auth/apple/callback`) and
`response_mode=form_post`. The app deep link is never sent to Apple. The POST
callback validates signed stateless state, exchanges the code, verifies the
`id_token` against Apple's JWKS, and returns tokens in the app URL fragment.

The private key may be supplied either way:

```bash
# Render-friendly: paste the .p8, newlines as \n
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"

# Or a file mounted on the host
APPLE_PRIVATE_KEY_PATH=/etc/secrets/AuthKey_<keyid>.p8
```

Inline wins when both are set. A path that does not exist is treated as
unconfigured, so `/auth/apple` keeps returning an honest 503 instead of failing
later at the callback. See `src/config/apple.ts`.

### Deployment checklist

- [ ] `APPLE_CLIENT_ID` — Services ID (not the app bundle ID).
- [ ] `APPLE_TEAM_ID` — 10-character Team ID.
- [ ] `APPLE_KEY_ID` — 10-character Key ID from the `.p8` filename.
- [ ] `APPLE_PRIVATE_KEY` **or** a valid `APPLE_PRIVATE_KEY_PATH`.
- [ ] `APPLE_CALLBACK_URL=https://<host>/auth/apple/callback` (HTTPS only; non-HTTPS values fall back to the Render callback).
- [ ] `APP_OAUTH_REDIRECTS=diasporansync:///oauth`.
- [ ] Services ID has Sign in with Apple enabled and the callback URL saved
      (Apple requires re-entering the URL on first save).
- [ ] App's Apple button stays visible; removing it while Google/Facebook exist
      is a 4.8 violation.

### Acceptance

```bash
curl -si "$API_URL/auth/apple?redirect=diasporansync:///oauth" | head -20
# Expect 302 to appleid.apple.com with redirect_uri=https://dagh-server-fo64.onrender.com/auth/apple/callback
# and response_mode=form_post plus state= and nonce= parameters.
# 503 means configuration is still incomplete.
```

Then complete a real device login and confirm the app receives
`diasporansync:///oauth#accessToken=...&refreshToken=...&provider=apple`.

---

## 3. Guideline 5.1.1(v) — account deletion

Already compliant in the current backend. `DELETE /profile/account` deletes an
OAuth-only account on authentication alone; a password is required only when the
account actually has one (`src/modules/profile-management/account-profile.controller.ts`).

- [ ] The iOS app exposes account deletion in-app (not only a web link).
- [ ] The flow does not prompt Google/Facebook/Apple users for a password.
- [ ] Users are told what is deleted; the server hard-deletes owned rows.

### Sign in with Apple token revocation (implemented)

5.1.1(v) also expects apps using Sign in with Apple to revoke the user's Apple
tokens when the account is deleted. The backend now:

- stores Apple's stable `sub` in `users.appleId` and resolves accounts by it
  (`src/modules/authentication/apple-identity.ts`);
- stores the refresh token encrypted with `PAYMENT_GATEWAY_ENCRYPTION_KEY`;
- calls `https://appleid.apple.com/auth/revoke` during self-service deletion
  (`src/services/apple-token.service.ts`).

Revocation is triggered for any account that holds an Apple refresh token,
including accounts originally created through Google/Facebook and later linked
to Apple (previously only native `ICLOUD` accounts were revoked). Revocation is
best-effort: if Apple is unavailable or encryption is not configured, deletion
still completes and the failure is logged. Set
`PAYMENT_GATEWAY_ENCRYPTION_KEY` in every environment where revocation should be
available.

---

## 4. Marketing icon transparency

No app assets live in this backend repo. The fix is in the app project:

- Export the 1024×1024 marketing icon as PNG **without an alpha channel**.
  Flatten onto the intended background colour before export; do not simply
  remove the alpha checkbox after export.
- Verify:

```bash
file icon-1024.png          # should say "PNG image data, 1024 x 1024, 8-bit/color RGB"
identify -format '%[channels]\n' icon-1024.png
# Expect srgb (no "a" channel), e.g. "srgb" not "srgba".
```

- Upload again in App Store Connect and confirm the icon preview shows no
  checkerboard/black background.

---

## 5. F-025 — Render cold starts during review

### Implemented mitigation

- `render.yaml` now declares `healthCheckPath: /health`, so Render can use the
  DB-free endpoint for deploy health checks.
- `.github/workflows/keepalive.yml` pings `GET /health` every 5 minutes to keep
  a free-tier instance from spinning down. It uses the repository variable
  `PRODUCTION_API_URL` when set, otherwise the documented production host.
- Manual warm-up before review: `curl -fsS "$API_URL/health"`.

### Limits

GitHub scheduled workflows can be delayed, and a free Render instance can still
spin down if the ping is skipped. For the review window, the reliable fix is a
paid Render instance (or any always-on host). Do not rely solely on the ping for
a time-critical review.

### Acceptance

- `curl -w '%{time_total}\n' "$API_URL/health"` returns 200 in under ~2 seconds
  from cold after a warm-up.
- Render dashboard shows the service healthy and no recent spin-down.
- The app's first request during review does not hit a cold-start timeout.

---

## Test coverage added

```bash
npx vitest run tests/ios-purchase-gate.test.ts tests/apple-signin-config.test.ts tests/apple-oauth-state.test.ts tests/apple-oauth-service.test.ts
npm run lint
npx tsc --noEmit
```

- `tests/ios-purchase-gate.test.ts` — platform detection and the 3.1.1 policy.
- `tests/apple-signin-config.test.ts` — inline key, path key, missing-key, and
  HTTPS callback fallback behavior.
- `tests/apple-oauth-state.test.ts` — signed stateless state, allowlisted app
  redirects, and fragment callback URLs.
- `tests/apple-oauth-service.test.ts` — authorize URL sends the backend HTTPS
  callback and `form_post`.
- `tests/apple-identity.test.ts` — Apple `sub` lookup, email linking, conflict
  and missing-email refusal.
- `tests/apple-token.test.ts` — encrypted token storage and revocation call.
- Existing `tests/delete-account-validator.test.ts` and
  `tests/delete-account-restrict-fks.test.ts` cover OAuth-only deletion.
