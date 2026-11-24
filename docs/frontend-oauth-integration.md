# Frontend OAuth Integration Guide

This document covers how the Diaspora Sync mobile app integrates with the
backend's OAuth endpoints for Google, Facebook, and Apple Sign-In. It is
intended for the frontend team implementing the Expo / React Native client.

---

## Table of Contents

1. [Overview](#overview)
2. [Deep Link Scheme](#deep-link-scheme)
3. [Providers At A Glance](#providers-at-a-glance)
4. [Google Sign-In](#google-sign-in)
5. [Facebook Login](#facebook-login)
6. [Apple Sign In](#apple-sign-in)
7. [Callback Screen](#callback-screen)
8. [Token Delivery Format](#token-delivery-format)
9. [Error Handling](#error-handling)
10. [Expo WebBrowser Setup](#expo-webbrowser-setup)
11. [Android Custom Tabs](#android-custom-tabs)
12. [Session and State](#session-and-state)
13. [Backend Endpoints Reference](#backend-endpoints-reference)

---

## Overview

The OAuth flow follows the standard Authorization Code grant:

1. The app opens a browser to the backend's **initiation** URL.
2. The backend stores a CSRF `state` token in the session and redirects the
   browser to the provider's consent screen.
3. After the user approves, the provider redirects the browser to the backend's
   **callback** URL with an authorization `code` and `state`.
4. The backend exchanges the code with the provider, creates or finds the user,
   issues a JWT `accessToken` + `refreshToken`, and redirects the browser to
   the app via a **deep link** containing the tokens.
5. The app's callback screen receives the deep link, persists the session, and
   navigates to the main screen.

All initiation URLs accept an optional `redirect` query parameter. When set to
the app's registered scheme (`diasporansync:///oauth`), the backend stores it in
the session and redirects back to it with tokens on success, or with `error` on
failure. Without `redirect`, the backend returns an HTML success page instead.

The password login endpoint (`POST /auth/login`) also accepts an optional
`redirect` field; when it is an allowlisted app destination, the response
includes `redirectUrl` so the client can perform the same deep-link handoff.

**Never use `fetch` or a JSON API helper to call the initiation URL.** The
provider's consent screen must open in a real browser so cookies and session
handoff work. Use `WebBrowser.openAuthSessionAsync`.

---

## Deep Link Scheme

The app registers the custom URL scheme **`diasporansync`**. The OAuth callback
path is always `/oauth` under that scheme:

```
diasporansync:///oauth
```

The scheme is set in:

- **Expo**: `app.json` → `scheme: "diasporansync"`
- **iOS**: `Info.plist` → `CFBundleURLTypes` → `CFBundleURLSchemes`
- **Android**: `AndroidManifest.xml` → intent filter with `android:scheme="diasporansync"`

The backend only redirects to this exact destination. Other schemes
(`daghguard:///oauth`, etc.) are rejected at initiation time.

---

## Providers At A Glance

| Provider | Initiation           | Callback                      | State Param | Scope           |
| -------- | -------------------- | ----------------------------- | ----------- | --------------- |
| Google   | `GET /auth/google`   | `GET /auth/google/callback`   | Yes         | `profile email` |
| Facebook | `GET /auth/facebook` | `GET /auth/facebook/callback` | Yes         | `email`         |
| Apple    | `GET /auth/apple`    | `POST /auth/apple/callback`   | Yes         | `name email`    |

All initiation routes accept `?redirect=diasporansync%3A%2F%2F%2Foauth`.

Apple's callback is a **POST** with `Content-Type: application/x-www-form-urlencoded`
(response_mode=form_post). The frontend does not call the callback directly — the
provider's browser does.

---

## Google Sign-In

### Initiation

```
GET {BASE_URL}/auth/google?redirect=diasporansync%3A%2F%2F%2Foauth
```

Opens the Google consent screen. On approval, Google redirects to
`{BASE_URL}/auth/google/callback?code=...&state=...`.

### Frontend flow

```typescript
import * as WebBrowser from "expo-web-browser";

const BASE_URL = "https://dagh-server-fo64.onrender.com";
const REDIRECT = "diasporansync:///oauth";

async function signInWithGoogle() {
  const url = `${BASE_URL}/auth/google?redirect=${encodeURIComponent(REDIRECT)}`;
  const result = await WebBrowser.openAuthSessionAsync(url, REDIRECT);

  if (result.type === "success" && result.url) {
    const params = new URL(result.url).searchParams;
    const accessToken = params.get("accessToken");
    const refreshToken = params.get("refreshToken");
    const email = params.get("email");
    const provider = params.get("provider"); // "google"

    if (accessToken && refreshToken) {
      // Persist tokens and navigate to the main screen
      await saveSession({ accessToken, refreshToken, email, provider });
    }
  }
}
```

### Callback parameters on success

| Parameter      | Description                   |
| -------------- | ----------------------------- |
| `accessToken`  | JWT access token (24h expiry) |
| `refreshToken` | JWT refresh token (7d expiry) |
| `provider`     | `"google"`                    |
| `email`        | User's email address          |

### Callback parameters on failure

| Parameter | Description                                                     |
| --------- | --------------------------------------------------------------- |
| `error`   | URL-encoded error message (e.g. `"OAuth authorization failed"`) |

---

## Facebook Login

### Initiation

```
GET {BASE_URL}/auth/facebook?redirect=diasporansync%3A%2F%2F%2Foauth
```

Opens the Facebook consent screen. On approval, Facebook redirects to
`{BASE_URL}/auth/facebook/callback?code=...&state=...`.

### Frontend flow

```typescript
async function signInWithFacebook() {
  const url = `${BASE_URL}/auth/facebook?redirect=${encodeURIComponent(REDIRECT)}`;
  const result = await WebBrowser.openAuthSessionAsync(url, REDIRECT);

  if (result.type === "success" && result.url) {
    const params = new URL(result.url).searchParams;
    const accessToken = params.get("accessToken");
    const refreshToken = params.get("refreshToken");
    const email = params.get("email");
    const provider = params.get("provider"); // "facebook"

    if (accessToken && refreshToken) {
      await saveSession({ accessToken, refreshToken, email, provider });
    }
  }
}
```

### Callback parameters

Identical format to Google. `provider` is `"facebook"`.

### Notes

- Facebook requires the app's **OAuth redirect URI** to be set to
  `{BASE_URL}/auth/facebook/callback` in the Facebook Developer Console.
- The `email` permission is requested automatically. If the user denies it, the
  backend returns an error redirect.
- If the user's Facebook account has no verified email, the backend returns an
  error redirect.

---

## Apple Sign In

### Initiation

```
GET {BASE_URL}/auth/apple?redirect=diasporansync%3A%2F%2F%2Foauth
```

Opens the Apple Sign In consent screen. Apple uses `response_mode=form_post`,
so the callback is a **POST** request — not a GET redirect. The browser
naturally handles this; the frontend does not need special handling for the
POST.

### Frontend flow

```typescript
async function signInWithApple() {
  const url = `${BASE_URL}/auth/apple?redirect=${encodeURIComponent(REDIRECT)}`;
  const result = await WebBrowser.openAuthSessionAsync(url, REDIRECT);

  if (result.type === "success" && result.url) {
    const callbackUrl = new URL(result.url);
    const params = new URLSearchParams(callbackUrl.hash.replace(/^#/, ""));
    const accessToken = params.get("accessToken");
    const refreshToken = params.get("refreshToken");
    const email = params.get("email");
    const provider = params.get("provider"); // "apple"

    if (accessToken && refreshToken) {
      await saveSession({ accessToken, refreshToken, email, provider });
    }
  }
}
```

### Callback parameters

Apple returns tokens in the URL **fragment** (after `#`) rather than the query string:
`diasporansync:///oauth#accessToken=...&refreshToken=...&provider=apple`.
`provider` is `"apple"`.

### Apple-specific notes

- **Email hiding**: Apple lets users hide their email. When the user chooses
  this, the backend receives a relay address (`xyz@privaterelay.appleid.com`).
  The app should treat this as a valid email.
- **Stable account identity**: The backend links Apple accounts by Apple's
  stable `sub` claim (`User.appleId`), not by email. This keeps the same local
  account even if Apple changes the relay address.
- **Missing email**: Apple only returns an email on the first authorization. A
  new account therefore needs that first email; an existing linked account can
  sign in again without one. If Apple returns no email for a brand-new account,
  the sign-in fails and the backend redirects with the generic
  `error=OAuth authorization failed` — show it and offer retry.
- **First-login name**: On the first sign-in, Apple sends a `user` JSON object
  in the POST body with `name.firstName` and `name.lastName`. The backend uses
  this to populate the user's `fullName`. On subsequent logins, the name is
  **not** sent.
- **Unconfigured backend**: `GET /auth/apple` returns `503` when the server is
  missing `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, or a readable
  `APPLE_PRIVATE_KEY`/`APPLE_PRIVATE_KEY_PATH`. This is a deployment error, not
  something the app can fix — show a "Sign in with Apple is unavailable" message
  and keep the other sign-in options visible.
- **Post-checkout redirect**: Apple may redirect to the app without tokens if
  the user cancels. The callback screen must check for the presence of
  `accessToken` before persisting a session.
- **Session cookie**: The backend session cookie uses `sameSite: "none"` in
  production so it survives Apple's cross-site POST callback. This is a server
  concern — no frontend action needed.

---

## Callback Screen

The callback screen is the destination of the deep link
`diasporansync:///oauth`. It must:

1. **Parse the URL** — extract query parameters (`accessToken`, `refreshToken`,
   `provider`, `email`, or `error`).
2. **Show a loading state** — the screen should display a spinner while
   processing. Do not navigate away on a timer.
3. **On success** (`accessToken` + `refreshToken` present):
   - Store both tokens securely (e.g. `expo-secure-store` or `AsyncStorage`).
   - Update the auth context / state manager.
   - Navigate to `/(drawer)/(tabs)`.
4. **On error** (`error` present):
   - Display the error message.
   - Show a "Try Again" button that navigates back to the login screen.
5. **On empty / unknown state** (neither tokens nor error):
   - Display a generic "Authentication failed" message.
   - Show a "Try Again" button.

### Example callback handler

```typescript
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { View, ActivityIndicator, Text } from "react-native";

export default function OAuthCallback() {
  const params = useLocalSearchParams<{
    accessToken?: string;
    refreshToken?: string;
    provider?: string;
    email?: string;
    error?: string;
  }>();
  const router = useRouter();

  useEffect(() => {
    if (params.error) {
      // Handle error — show message, offer retry
      return;
    }

    if (params.accessToken && params.refreshToken) {
      // Persist session
      saveSession({
        accessToken: params.accessToken,
        refreshToken: params.refreshToken,
        provider: params.provider,
        email: params.email,
      }).then(() => {
        router.replace("/(drawer)/(tabs)");
      });
    }
  }, [params]);

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <ActivityIndicator size="large" />
      <Text>Signing you in...</Text>
    </View>
  );
}
```

### Timing

The callback screen must **wait** for the session to persist before navigating.
Do not use a timeout-based redirect (e.g. `setTimeout(() => router.replace(...), 1200)`).
The auth context must be populated before the main screen mounts.

---

## Token Delivery Format

On a successful mobile OAuth callback, the backend redirects to:

```
diasporansync:///oauth?accessToken=<jwt>&refreshToken=<jwt>&provider=<google|facebook|apple>&email=<email>
```

On failure:

```
diasporansync:///oauth?error=<url-encoded-message>
```

### Token format

Both `accessToken` and `refreshToken` are JWTs. They are URL-encoded when
placed in the deep link query string.

| Field          | Description                                                                              |
| -------------- | ---------------------------------------------------------------------------------------- |
| `accessToken`  | Short-lived JWT (24 hours). Use in `Authorization: Bearer <token>` headers.              |
| `refreshToken` | Long-lived JWT (7 days). Exchange for a new access token via `POST /auth/refresh-token`. |
| `provider`     | One of `google`, `facebook`, `apple`.                                                    |
| `email`        | The user's email (may be a private relay address for Apple).                             |

### Token storage

Store tokens in a secure, persistent store. Do **not** store them in plain
`AsyncStorage`.

```typescript
import * as SecureStore from "expo-secure-store";

async function saveSession(tokens: {
  accessToken: string;
  refreshToken: string;
  provider?: string;
  email?: string;
}) {
  await SecureStore.setItemAsync("accessToken", tokens.accessToken);
  await SecureStore.setItemAsync("refreshToken", tokens.refreshToken);
  if (tokens.provider) {
    await SecureStore.setItemAsync("authProvider", tokens.provider);
  }
}
```

---

## Error Handling

### Provider errors

If the user denies permission or the provider returns an error, the backend
redirects to:

```
diasporansync:///oauth?error=<message>
```

The `error` value is URL-encoded. Common messages:

| Message                      | Meaning                                   |
| ---------------------------- | ----------------------------------------- |
| `OAuth authorization failed` | User denied or provider returned an error |

### Network errors

If `WebBrowser.openAuthSessionAsync` returns `{ type: "cancel" }`, the user
closed the browser without completing. Return to the login screen.

If the backend is unreachable, `openAuthSessionAsync` may return
`{ type: "cancel" }` or throw. Wrap the call in a try-catch and show a
"Connection failed" message.

### Token errors

If the backend callback does not include `accessToken` or `refreshToken`, the
authentication failed silently. Show an error and offer retry.

---

## Expo WebBrowser Setup

The app must call `WebBrowser.maybeCompleteAuthSession()` at the top level to
ensure the auth session is properly cleaned up:

```typescript
import * as WebBrowser from "expo-web-browser";

WebBrowser.maybeCompleteAuthSession();
```

Call this once in the root layout or the login screen module scope.

### Required dependency

```bash
npx expo install expo-web-browser
```

No additional native configuration is needed for `expo-web-browser`. The
`diasporansync` scheme must be registered in `app.json`:

```json
{
  "expo": {
    "scheme": "diasporansync"
  }
}
```

---

## Android Custom Tabs

On Android, `WebBrowser.openAuthSessionAsync` opens the provider's consent
screen in a Chrome Custom Tab (not an external browser or WebView). This
requires:

1. An installed browser that supports Custom Tabs (Chrome, Edge, Brave, etc.).
2. The `CustomTabsService` intent filter in the Expo WebBrowser native manifest.

The app explicitly selects a Custom Tabs-capable browser and **excludes Gmail**
(since Gmail does not support Custom Tabs). If no compatible browser is found,
the app shows an error instead of launching an arbitrary URL handler.

No additional setup is needed — Expo's `expo-web-browser` package includes the
correct Android manifest entries for Custom Tabs visibility.

---

## Session and State

### CSRF protection

Each OAuth initiation generates a cryptographic `state` token
(`crypto.randomBytes(32)`) stored in the server-side session. The token is
single-use — it is consumed on the callback and cannot be replayed.

The `state` is passed to the provider in the initiation redirect and verified
on the callback. If the `state` does not match or is missing, the backend
redirects to the failure page.

### Deep link allowlist

The backend only redirects to exact, pre-approved mobile return destinations:

```
diasporansync:///oauth
```

Any other redirect URL (even if it looks like a deep link) is rejected at
initiation time. This prevents open redirect attacks.

### Session persistence

The backend uses a Postgres-backed session store (`connect-pg-simple`). Sessions
survive server restarts and are shared across instances. The session cookie
expires after 24 hours.

On Apple's cross-site POST callback, the session cookie uses `sameSite: "none"`
so it is sent by the browser. For Google and Facebook (GET redirects), the
default `sameSite: "lax"` is sufficient.

---

## Backend Endpoints Reference

### Initiation

| Method | Path             | Parameters                   | Response                                     |
| ------ | ---------------- | ---------------------------- | -------------------------------------------- |
| `GET`  | `/auth/google`   | `?redirect=<app-scheme-url>` | 302 → Google consent                         |
| `GET`  | `/auth/facebook` | `?redirect=<app-scheme-url>` | 302 → Facebook consent                       |
| `GET`  | `/auth/apple`    | `?redirect=<app-scheme-url>` | 302 → Apple consent (or 503 if unconfigured) |

### Callbacks

| Method | Path                      | Description                                      |
| ------ | ------------------------- | ------------------------------------------------ |
| `GET`  | `/auth/google/callback`   | Exchanges code, redirects to app or success page |
| `GET`  | `/auth/facebook/callback` | Exchanges code, redirects to app or success page |
| `POST` | `/auth/apple/callback`    | Exchanges code, redirects to app or success page |

### Failure / Success pages (browser fallback)

| Method | Path                     | Description                                              |
| ------ | ------------------------ | -------------------------------------------------------- |
| `GET`  | `/auth/google/failed`    | Redirects to app with `error` param, or shows retry page |
| `GET`  | `/auth/google/success`   | Shows success page with auto-redirect to app             |
| `GET`  | `/auth/facebook/failed`  | Same as Google failure                                   |
| `GET`  | `/auth/facebook/success` | Same as Google success                                   |
| `GET`  | `/auth/apple/failed`     | Same as Google failure                                   |
| `GET`  | `/auth/apple/success`    | Same as Google success                                   |

### Base URLs

| Environment | URL                                     |
| ----------- | --------------------------------------- |
| Production  | `https://dagh-server-fo64.onrender.com` |
| Development | `http://localhost:5000`                 |

---

## Full Provider Comparison

| Feature               | Google                                                                              | Facebook                        | Apple                                                                              |
| --------------------- | ----------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------- |
| Initiation method     | GET                                                                                 | GET                             | GET                                                                                |
| Callback method       | GET                                                                                 | GET                             | POST                                                                               |
| Scope                 | `profile email`                                                                     | `email`                         | `name email`                                                                       |
| Email always provided | Yes                                                                                 | Yes (if permitted)              | Optional (relay possible)                                                          |
| Name always provided  | Yes (display name)                                                                  | Yes (display name)              | First login only                                                                   |
| Session cookie needed | Yes (Lax)                                                                           | Yes (Lax)                       | No (stateless signed state)                                                        |
| Provider callback URL | `{BASE}/auth/google/callback`                                                       | `{BASE}/auth/facebook/callback` | `https://dagh-server-fo64.onrender.com/auth/apple/callback`                        |
| Deep link on success  | `diasporansync:///oauth?accessToken=...&refreshToken=...&provider=google&email=...` | Same, `provider=facebook`       | `diasporansync:///oauth#accessToken=...&refreshToken=...&provider=apple&email=...` |
| Deep link on failure  | `diasporansync:///oauth?error=...`                                                  | Same                            | Same                                                                               |
