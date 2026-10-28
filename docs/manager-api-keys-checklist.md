# Project Manager: API Keys & Services Checklist for Calling + Push

**Audience:** project/product manager and whoever owns third-party accounts
**Goal:** a single checklist of every credential the calling + push notification system needs, what it unlocks, where to get it, and who owns it.

Server team needs these in `.env`. Please obtain the items marked 🔴 before the relevant milestone; items ✅ are already handled.

---

## 🔴 1. Apple Developer Program (required — iOS calling)

Needed for **iOS VoIP calls** (the only way a terminated iPhone still rings). These are brand-new requirements added for the VoIP delivery channel.

| What | Env var(s) | Unlocks | Where to get it |
|------|------------|---------|-----------------|
| **APNs Auth Key** (`.p8` file) | `APPLE_APNS_P8_KEY` (contents) or `APPLE_APNS_KEY_PATH` (file path) | The server signs JWTs to push VoIP calls directly to iPhones | Apple Developer → Certificates, Identifiers & Profiles → **Keys** → "+" → enable *Apple Push Notifications* → download the **one-time** `.p8`; note the **Key ID** |
| **Key ID** (10 chars) | `APPLE_APNS_KEY_ID` | Pairs with the `.p8` key | Shown on the same Key page |
| **Team ID** (10 chars) | `APPLE_APNS_TEAM_ID` | Part of the JWT | Apple Developer account → *Membership details*, "Team ID" |
| **App Bundle ID** (e.g. `com.company.dagh`) | `APPLE_BUNDLE_ID` | Server derives the PushKit topic `<bundle-id>.voip` | Your app config / Apple Developer → *Identifiers* |

**Important:**
- Requires an **Apple Developer Program membership** (paid, ~$99/yr). This is an account/billing decision for you, not engineering.
- The `.p8` download link disappears after download once — keep it secure (project shared vault, not in git).
- One `.p8` key works for BOTH sandbox and production — no separate keys needed.
- Environment switch is a server config: `APPLE_APNS_PRODUCTION=true` (production) vs `false` (sandbox testing).

---

## 🔴 2. Firebase (required — Android calling)

Needed for **Android call pushes** (FCM visible incoming-call alerts, TTL-bounded, plus data-only state changes) and as a fallback channel.

| What | Env var(s) | Unlocks | Where to get it |
|------|------------|---------|-----------------|
| **Firebase project** + **service account key** | `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL` | Server sends FCM pushes to Android devices | Firebase Console → Project Settings → **Service Accounts** → *Generate new private key* (JSON; server reads the three fields from it) |
| **Android config file** `google-services.json` | not server-side | Lets the Android app obtain an `fcmToken` | Firebase Console → Project Settings → *Your apps* → Android |
| **iOS config file** `GoogleService-Info.plist` | not server-side | Lets the iOS app talk to FCM if used | Firebase Console → Project Settings → *Your apps* → iOS |

Note: `FIREBASE_PRIVATE_KEY` is a PEM with `\n` — keep the whole value in quotes in `.env`.

---

## 🔴 3. LiveKit (required — actual call audio/video)

Not involved in *notifications*, but the call only "works" end-to-end when media flows.

| What | Env var(s) | Unlocks | Where to get it |
|------|------------|---------|-----------------|
| **LiveKit Cloud project** (or self-hosted server) | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Server mints short-lived room tokens; clients join rooms for audio/video | LiveKit Cloud console → **Keys**, or self-host; note the URL is `wss://…` |

---

## ✅ 4. Already configured — no action

These are in place for the rest of the product; listed only so you know they're seen as handled.

| Service | Env vars | Used for | Owner |
|---------|----------|----------|-------|
| PostgreSQL (Neon) | `DATABASE_URL`, `DIRECT_URL` | All data, incl. push outbox rows | Backend/ops |
| Redis | `REDIS_URL` | Distributed cron locks, socket adapter, rate limits | Backend/ops |
| Hubtel | `HUBTEL_*` | SMS | Existing |
| Resend | `RESEND_API_KEY`, `EMAIL_FROM` | Email (sender: `noreply@diasporaadvocacygh.org`) | Existing |
| Cloudinary | `CLOUDINARY_*` | Media uploads | Existing |
| Sentry | `SENTRY_*` | Error/performance monitoring | Backend |

---

## Quick actions for you

1. ✅ Access to an **Apple Developer Program** account (or budget the ~$99/yr).
2. 🔴 Generate the **APNs Auth Key (.p8)** + save Key ID / Team ID / Bundle ID → hand to backend.
3. 🔴 Generate the **Firebase service-account key** → hand to backend (confirm Android/iOS app files exist too).
4. 🔴 Confirm **LiveKit** keys are in `.env`.
5. 🧪 Ask backend to flip `APPLE_APNS_PRODUCTION=true` only after sandbox testing passes, then re-test on iOS TestFlight/development builds.

## If any of these are missing

| Missing | What happens |
|---------|--------------|
| APNs key vars | iOS devices get Expo **banners only**; no lock-screen call when app is closed |
| Firebase vars | Android falls back to Expo banners; no reliable background ring |
| LiveKit | Calls can't start (dev placeholder only) |

The server starts and tells you: `[push] APNs not configured — iOS VoIP call pushes disabled`.
No outage — degraded experience only.