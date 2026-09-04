# Forgot Password Workflow — Frontend Integration Guide

## Overview

The forgot password flow allows users who have **already verified their email** to securely reset their password using a 6-digit OTP sent to their registered email address. It is a 3-step process:

1. **Request OTP** — user submits their email; a reset OTP is sent.
2. **Verify OTP** — user submits the 6-digit code to confirm identity.
3. **Reset Password** — user submits a new password; the account is updated.

### Base URL

All endpoints are mounted under `/auth`.

> **No authentication required.** These endpoints are public — the user may not have an active session.

---

## Endpoint Reference

### Step 1 — `POST /auth/request-reset-password`

Sends a 6-digit OTP to the user's registered email address.

**Request body:**
```json
{
  "email": "user@example.com"
}
```

| Field   | Type   | Required | Description          |
|---------|--------|----------|----------------------|
| `email` | string | ✅       | User's registered email address |

**Response (`200`):**
```json
{
  "success": true,
  "message": "Password reset OTP sent successfully"
}
```

**Error responses:**

| Status | Cause |
|--------|-------|
| `400`  | Invalid email format |
| `404`  | No account found with this email |
| `500`  | Failed to send the OTP email |

> **Note:** The OTP is stored in the database with `purpose: "PASSWORD_RESET"` and expires after a fixed TTL. If the user requests another OTP before the previous one expires, a new one is generated and the old one is overwritten.

---

### Step 2 — `POST /auth/verify-otp`

Verifies the OTP the user received. Use `purpose: "PASSWORD_RESET"` — this is distinct from `EMAIL_VERIFICATION` and does **not** alter the user's account status.

**Request body:**
```json
{
  "email": "user@example.com",
  "code": "123456",
  "purpose": "PASSWORD_RESET"
}
```

| Field     | Type   | Required | Description                                         |
|-----------|--------|----------|-----------------------------------------------------|
| `email`   | string | ✅       | The email the OTP was sent to                       |
| `code`    | string | ✅       | The 6-digit numeric OTP received via email          |
| `purpose` | string | ✅       | Must be exactly `"PASSWORD_RESET"` for this flow    |

**Response (`200`):**
```json
{
  "success": true,
  "message": "OTP verified successfully"
}
```

**Error responses:**

| Status | Cause |
|--------|-------|
| `400`  | Invalid OTP code, OTP already used, or OTP expired |
| `404`  | No account found with this email |

> ⚠️ **Important — `purpose` is required and must match.**
>
> The `/auth/verify-otp` endpoint is shared between two flows:
>
> | `purpose` value       | Used for                              |
> |-----------------------|---------------------------------------|
> | `EMAIL_VERIFICATION`  | Verifying a new account after sign-up |
> | `PASSWORD_RESET`      | Confirming identity before a password reset |
>
> Sending the wrong purpose will cause OTP lookup to fail. For this flow, always send `"PASSWORD_RESET"`.
>
> Additionally, `PASSWORD_RESET` **skips the `accountStatus` check** that blocks already-active users from using this endpoint. An active user calling this endpoint with `EMAIL_VERIFICATION` will receive `400 "Email already verified"` — that is correct behaviour. With `PASSWORD_RESET`, the call proceeds normally.

---

### Step 3 — `POST /auth/reset-password`

Resets the user's password. The OTP is re-verified server-side as part of this step (the OTP is consumed here and deleted from the database).

**Request body:**
```json
{
  "email": "user@example.com",
  "otp": "123456",
  "newPassword": "NewPassword123!"
}
```

| Field         | Type   | Required | Constraints |
|---------------|--------|----------|-------------|
| `email`       | string | ✅       | Must match the email used in steps 1 & 2 |
| `otp`         | string | ✅       | The same 6-digit code from step 2 |
| `newPassword` | string | ✅       | Min 8 chars, must contain uppercase, lowercase, number, and special character |

**Password rules:**
- Minimum 8 characters
- At least 1 uppercase letter (`A–Z`)
- At least 1 lowercase letter (`a–z`)
- At least 1 number (`0–9`)
- At least 1 special character (e.g. `!`, `@`, `#`, `$`)

**Response (`200`):**
```json
{
  "success": true,
  "message": "Password reset successfully"
}
```

**Error responses:**

| Status | Cause |
|--------|-------|
| `400`  | Invalid OTP, OTP expired, or `newPassword` fails validation |
| `404`  | No account found with this email |
| `500`  | Internal error during password update |

> After a successful reset, the OTP record is deleted. The user should be redirected to the login screen to sign in with their new password.

---

## Complete Flow Diagram

```
User clicks "Forgot Password"
          │
          ▼
POST /auth/request-reset-password
{ email }
          │
     ┌────┴────┐
     │         │
   404       200
 (no user) (OTP sent to email)
     │         │
  Show error   ▼
          User enters 6-digit code
          from their inbox
          │
          ▼
POST /auth/verify-otp
{ email, code, purpose: "PASSWORD_RESET" }
          │
     ┌────┴────┐
     │         │
   400       200
 (bad/expired (OTP valid)
   OTP)        │
     │         ▼
  Show error  Show "set new password" screen
             │
             ▼
POST /auth/reset-password
{ email, otp, newPassword }
             │
        ┌────┴────┐
        │         │
      400       200
  (bad OTP /  (password updated)
  weak pass)    │
        │        ▼
    Show error  Redirect to Login
```

---

## Important Notes

### OTP lifetime
OTPs expire after a fixed server-side TTL. If the user waits too long between steps, they must restart the flow from step 1. The frontend should communicate this clearly (e.g. show a countdown timer if the OTP TTL is known).

### OTP is consumed on reset
The OTP is deleted when `POST /auth/reset-password` completes successfully. If the user navigates back and tries to use the same code again, it will fail with `400 "Invalid or expired OTP"`. They must start from step 1 again.

### This flow does not affect account status
`PURPOSE_RESET` OTP verification does **not** change `accountStatus` to `ACTIVE`. Only `EMAIL_VERIFICATION` does that. A user who has not yet verified their email cannot use this flow to bypass email verification.

### No session is created
After a successful password reset, no access or refresh token is returned. The user must log in normally via `POST /auth/login` with their new password.

---

## Related Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /auth/login` | Sign in after password reset |
| `POST /auth/verify-otp` (with `EMAIL_VERIFICATION`) | Verify email for a new account |
| `POST /auth/resend-otp` | Resend email verification OTP for new accounts |
| `POST /auth/refresh-token` | Refresh an expired access token |
