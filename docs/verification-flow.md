# DAGH Identity Verification — API Guide (Frontend)

Everything a frontend needs to implement the **Identity Verification** flow
(phone → face/liveness → documents → admin review) against the DAGH backend.

Base URL (dev): `http://localhost:5000`
Base URL (prod): `https://dagh-server-fo64.onrender.com`

---

## 1. Conventions

### Authentication

Every verification endpoint requires a Bearer token:

```
Authorization: Bearer <accessToken>
```

If the token is missing/expired you get:

```json
{ "success": false, "error": "Unauthorized" }
```

(401). Refresh the token with `POST /auth/refresh-token` and retry.

### Response envelope

All endpoints use a single envelope.

**Success:**

```json
{
  "success": true,
  "data": { /* payload — varies per endpoint */ },
  "message": "Optional human-readable message"
}
```

**Error (standard):**

```json
{
  "success": false,
  "error": "Human-readable error message",
  "details": "Optional extra context (dev only)"
}
```

**Error (validation) — returned when a Zod schema rejects the body:**

```json
{
  "success": false,
  "errors": [
    { "path": "bio_document_urls.0", "message": "Each bio document URL must be a valid URL" },
    { "path": "code", "message": "OTP must be 6 digits" }
  ]
}
```

Two error shapes exist on purpose — the `errors` array one only comes from the
request-body validators (`/verification/phone/*` and `/verification/bio_document_urls`).

### End-to-end flow at a glance

```
 1. POST /verification/init                 ← "Begin Verification" button
 2. POST /verification/phone/send-otp       ← phone number
 3. POST /verification/phone/verify-otp     ← 6-digit code  (OTP arrives by email)
 4. POST /upload                            ← face image  (multipart)
 5. POST /verification/bio_profile_url      ← face image URL
 6. POST /upload                            ← document front  (multipart)
 7. POST /upload                            ← document back   (multipart)
 8. POST /verification/bio_document_urls    ← both document URLs + type + card number
 9. GET  /verification/validation-step/status   ← poll until VERIFIED / REJECTED
```

> **One ID card per account.** The `bio_document_number` (Ghana Card / passport
> number) submitted at step 8 is **globally unique** across the platform. The
> backend rejects (HTTP 409) any account that tries to verify with a document
> number already used to verify **another** account. So one physical ID card can
> be used to verify only **one** account.

Steps 2–3 happen only if the user's phone is not already verified.

---

## 2. Endpoints

### 2.1 Initialize verification

`POST /verification/init` — Bearer

Creates the user's `UserProfile` + a `ProfileVerification` row if they don't
exist yet. Idempotent — safe to call every time the user enters the flow.

**Request body:** none.

**Response 200:**

```json
{
  "success": true,
  "data": {
    "id": "…",
    "userId": "…",
    "profileUrl": null,
    "phoneNumber": null,
    "profileVerification": {
      "id": "…",
      "phone_number_verified": false,
      "validationStep": "PHONE_NUMBER_VERIFICATION"
    }
  },
  "message": "Profile initialized successfully."
}
```

**Errors:** 401.

> Frontend: call once when the user taps **Begin Verification** (the initial
> "Body" screen) before any other call in this guide.

---

### 2.2 Send phone OTP

`POST /verification/phone/send-otp` — Bearer

Triggers delivery of a 6-digit OTP for phone verification.

**Request body** (JSON):

```json
{
  "phoneNumber": "+233240000000"
}
```

`phoneNumber` is optional. If omitted, the number already saved on the profile
is used.

**Behavior / notes:**

- The number is normalized before saving: whitespace and a leading `+` are
  stripped (so `+233240000000` → `233240000000`). It must match
  `/^\d{10,15}$/` after normalization.
- **Important:** the OTP is delivered to the user's **email address on their
  account** (via Resend), not as an SMS. The subject line is
  "Phone Verification OTP" and it expires after **10 minutes**.

**Response 200:**

```json
{
  "success": true,
  "data": { "phoneNumber": "233240000000" },
  "message": "OTP sent successfully."
}
```

**Errors:**

| Status | Error |
|--------|-------|
| 400 | `Phone number is required` / `Phone number must be a valid phone number` |
| 404 | `Profile not found` (call `/verification/init` first) |
| 401 | `Unauthorized` |
| 500 | `Failed to send OTP` |

> Frontend: after a 200, navigate to the code-entry screen. Keep the returned
> `phoneNumber` to display back to the user if you want.

---

### 2.3 Verify phone OTP

`POST /verification/phone/verify-otp` — Bearer

Confirms the 6-digit code and marks the phone step verified.

**Request body** (JSON):

```json
{
  "phoneNumber": "+233240000000",
  "code": "123456"
}
```

`phoneNumber` is optional (it is already saved from step 2.2). `code` is
required and must be exactly 6 digits.

**Response 200:**

```json
{
  "success": true,
  "data": {
    "id": "…",
    "phone_number_verified": true,
    "isVerified": true,
    "validationStep": "PROFILE_IMAGE_VERIFICATION"
  },
  "message": "Phone number verified successfully."
}
```

**Errors:**

| Status | Error |
|--------|-------|
| 400 | `Invalid OTP code` / `OTP expired. Please request a new one.` / `OTP expired or not found. Please request a new one.` / `Phone number is required` |
| 400 (validation) | `OTP must be 6 digits` |
| 404 | `Profile not found` |
| 401 | `Unauthorized` |

> Frontend: on 200 show the **"Phone Verified"** success screen. "Proceed"
> moves to the camera step. If `Invalid OTP code`, show an inline error under
> the input and let the user retry; a `Resend code` button calls 2.2 again.
> Once the OTP is used it is deleted server-side, so a repeated submit of the
> same code returns `OTP expired or not found`.

---

### 2.4 Upload an image

`POST /upload` — Bearer, `multipart/form-data`

Uploads a file to Cloudinary and returns its URL. Used for the face image and
for document front/back images (three separate calls).

**Request** — multipart/form-data, single file under the field name **`image`**.

**Upload constraints** (enforced by the server):

| Constraint | Value |
|------------|-------|
| Max size | **5 MB** |
| Allowed types | JPEG, JPG, PNG, PDF |

**Response 201:**

```json
{
  "success": true,
  "data": {
    "url": "https://res.cloudinary.com/demo/image/upload/v123/dagh/uploads/…",
    "publicId": "dagh/uploads/…"
  },
  "message": "Upload successful."
}
```

**Errors:**

| Status | Error |
|--------|-------|
| 400 | `No file uploaded` |
| 400 | `Only JPG, PNG images and PDFs are allowed` (wrong type) |
| 413 | `File too large. Maximum size is 5MB.` |
| 400 | `Upload failed. Please provide a valid image or PDF.` (Cloudinary error) |

> Frontend: compress images client-side before sending to avoid the 5 MB limit.
> Send the returned `url` (not the `publicId`) to 2.5 / 2.7.

---

### 2.5 Submit face (bio profile) image URL

`POST /verification/bio_profile_url` — Bearer

Saves the face-scan image URL and advances the flow to the document step.

**Request body** (JSON):

```json
{
  "bio_profile_url": "https://res.cloudinary.com/…/face.jpg"
}
```

**Response 200:**

```json
{
  "success": true,
  "data": {
    "bio_profile_image_url": "https://res.cloudinary.com/…/face.jpg",
    "bio_profile_image_uploaded_at": "2026-08-08T12:00:00.000Z"
  },
  "message": "Bio profile URL updated successfully."
}
```

**Errors:**

| Status | Error |
|--------|-------|
| 400 | `bio_profile_url is required` |
| 404 | `Profile not found. Please initialize your profile first.` |
| 401 | `Unauthorized` |
| 500 | `Failed to update bio profile URL.` |

> Frontend: fire this immediately after the face upload succeeds. Show the
> "Processing…" state. A 200 means the biometric data is captured — show
> **"Biometrics Confirmed"** and enable the document step. A non-200 shows
> **"Biometrics Confirmation Failed"** with the error message.

---

### 2.6 Submit document images (passport / Ghana card)

`POST /verification/bio_document_urls` — Bearer

Saves the document images and type, and moves the profile to the pending-review
state.

**Request body** (JSON):

```json
{
  "bio_document_urls": [
    "https://res.cloudinary.com/…/passport-front.jpg",
    "https://res.cloudinary.com/…/passport-back.jpg"
  ],
  "bio_document_type": "PASSPORT",
  "bio_document_number": "G12345678"
}
```

`bio_document_urls` — array of at least 1 valid URL (send front + back).
`bio_document_type` — optional, `PASSPORT` or `GHANA_CARD`.
`bio_document_number` — **required**. The unique ID number printed on the card
(Ghana Card number or passport number). Must be 1–50 characters. This value is
**globally unique** — no other verified account may use the same number.

**Response 200:**

```json
{
  "success": true,
  "data": {
    "bio_document_urls": ["https://res.cloudinary.com/…/passport-front.jpg", "https://res.cloudinary.com/…/passport-back.jpg"],
    "bio_document_type": "PASSPORT",
    "bio_document_number": "G12345678",
    "bio_document_uploaded_at": "2026-08-08T12:00:00.000Z"
  },
  "message": "Bio documents updated successfully."
}
```

**Errors:**

| Status | Error |
|--------|-------|
| 400 (validation) | `bio_document_urls must contain at least 1 url` / `Each bio document URL must be a valid URL` / `bio_document_number is required` |
| **409** | `This document number has already been used to verify another account.` |
| 404 | `Profile not found. Please initialize your profile first.` |
| 401 | `Unauthorized` |
| 500 | `Failed to update bio documents.` |

> **409 — duplicate ID:** When this is returned, the submitted
> `bio_document_number` is already linked to a **different** user account. The
> upload is rejected and the same ID card cannot be used to verify a second
> account. Tell the user their ID has already been used.

> Frontend: on 200 navigate to the **"Verifying Your Profile"** screen and start
> polling 2.7.

---

### 2.7 Get verification status

`GET /verification/validation-step/status` — Bearer

Returns the current verification step and its review state.

**Query params (optional):** `?step=PHONE_NUMBER_VERIFICATION`
| `?step=PROFILE_IMAGE_VERIFICATION` | `?step=DOCUMENT_VERIFICATION`.
If omitted, the current step is inferred from stored progress.

**Response 200:**

```json
{
  "success": true,
  "data": {
    "current_step": "DOCUMENT_VERIFICATION",
    "status": "PENDING",
    "verification_message": null
  },
  "message": "Current validation step retrieved successfully."
}
```

**`status` values and screen mapping:**

| `status` | Meaning | UI |
|----------|---------|-----|
| `PENDING` | Submitted, awaiting admin review | **"Verifying Your Profile"** (spinner) |
| `VERIFIED` | Step completed / admin-approved | `current_step == "DOCUMENT_VERIFICATION"` → **"You are done"** |
| `REJECTED` | Admin rejected the step | **"Profile Verification failed"** (show `verification_message`) |

`verification_message` is only present (non-null) when `status` is `REJECTED`
and contains the admin's rejection reason (e.g. *"Expired document"*).

**Errors:**

| Status | Error |
|--------|-------|
| 404 | `Profile not found` |
| 401 | `Unauthorized` |
| 500 | `Failed to retrieve current validation step.` |

> Frontend: after 2.6 succeeds, poll every 5–10 seconds. Stop polling when
> `status` is `VERIFIED` or `REJECTED`.
>
> `current_step` values: `PHONE_NUMBER_VERIFICATION`,
> `PROFILE_IMAGE_VERIFICATION`, `DOCUMENT_VERIFICATION`.
> "You are done" is shown when `status == "VERIFIED"` and
> `current_step == "DOCUMENT_VERIFICATION"` (the last step).

---

### 2.8 Get full verification status

`GET /verification/status` — Bearer

Returns the state of every verification step in one call (phone, profile image,
documents), the current/inferred step, and whether the user's profile exists.
Use it on app load to decide whether to start the verification flow or skip it
for returning users.

**Response 200:**

```json
{
  "success": true,
  "data": {
    "profileExists": true,
    "isVerified": false,
    "currentStep": "DOCUMENT_VERIFICATION",
    "verificationMessage": null,
    "steps": {
      "PHONE_NUMBER_VERIFICATION": { "status": "VERIFIED", "verificationMessage": null },
      "PROFILE_IMAGE_VERIFICATION": { "status": "PENDING", "verificationMessage": null },
      "DOCUMENT_VERIFICATION": { "status": "PENDING", "verificationMessage": null }
    },
    "completedSteps": ["PHONE_NUMBER_VERIFICATION"]
  }
}
```

`profileExists` is `false` (HTTP 200, not 404) when the user has no profile yet.
The per-step `status` values and their screen mapping are the same as in 2.7.

---

## 3. Status semantics (how a record moves through the flow)

| Step (`current_step`) | Verified when | Rejected when |
|-----------------------|---------------|---------------|
| `PHONE_NUMBER_VERIFICATION` | `phone_number_verified` (set by 2.3) | — (no admin review) |
| `PROFILE_IMAGE_VERIFICATION` | face image submitted AND admin approves face | admin rejects face |
| `DOCUMENT_VERIFICATION` | documents submitted AND admin approves documents/bio data | admin rejects documents or bio data |

Admin endpoints (for reference — used by the admin app, not the user app):
`GET /admin/profile-verifications`, `PATCH .../bio-data`,
`PATCH .../face`, `PATCH .../documents`, `POST .../verify`.

---

## 4. Suggested request helper (TypeScript sketch)

```ts
const api = async <T>(path: string, options: RequestInit = {}) => {
  const token = getAccessToken(); // from your auth store
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  return res.json() as Promise<T>;
};
```

Multipart uploads must NOT set `Content-Type` — the browser sets the boundary:

```ts
const form = new FormData();
form.append("image", file);
const { data } = await api<{ url: string }>("/upload", { method: "POST", body: form });
```
