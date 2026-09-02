# Verification Workflow — Frontend Integration Guide

## Overview

The verification system is a **3-step flow** that every new user must complete before accessing the discovery/matching features. Each step must be completed in order. The frontend should use these endpoints to determine which screen to show and when to advance.

### Base URLs

| Prefix | Mount |
|---|---|
| `/verification/*` | Verification endpoints |
| `/profile/*` | Profile init/update |
| `/dating/*` | Dating profile & discovery |

All endpoints require a `Bearer` token in the `Authorization` header.

---

## Endpoint Reference

### 1. `POST /verification/init`

Initializes the user's verification profile. Must be called before any other verification step. Idempotent — returns the existing profile if already created.

**Request:** No body required.

**Response (`200`):**
```json
{
  "success": true,
  "message": "Profile initialized successfully.",
  "data": {
    "id": "profile_id",
    "userId": "user_id",
    "phoneNumber": null,
    "bio_profile_image_url": null,
    "bio_document_urls": [],
    "profileVerification": {
      "phone_number_verified": false,
      "isVerified": false,
      "document_verification": false,
      "bio_profile_verification": false,
      "validationStep": "PHONE_NUMBER_VERIFICATION"
    }
  }
}
```

**When to call:** Immediately after login for new users, before showing the verification flow.

---

### 2. `GET /verification/status`

Returns the full verification state. This is the **primary endpoint** the frontend should poll to decide routing.

**Response (`200`):**
```json
{
  "success": true,
  "data": {
    "profileExists": true,
    "isVerified": false,
    "currentStep": "PHONE_NUMBER_VERIFICATION",
    "verificationMessage": null,
    "steps": {
      "PHONE_NUMBER_VERIFICATION": {
        "status": "VERIFIED",
        "verificationMessage": null
      },
      "PROFILE_IMAGE_VERIFICATION": {
        "status": "PENDING",
        "verificationMessage": null
      },
      "DOCUMENT_VERIFICATION": {
        "status": "PENDING",
        "verificationMessage": null
      }
    },
    "completedSteps": ["PHONE_NUMBER_VERIFICATION"]
  }
}
```

#### Key fields

| Field | Type | Description |
|---|---|---|
| `profileExists` | `boolean` | `false` if user hasn't called `/verification/init` yet. Call init first. |
| `isVerified` | `boolean` | `true` **only when all 3 steps are VERIFIED**. Use this to decide whether to show verification or skip to discovery. |
| `currentStep` | `string` | The next step the user needs to complete. One of `PHONE_NUMBER_VERIFICATION`, `PROFILE_IMAGE_VERIFICATION`, `DOCUMENT_VERIFICATION`. |
| `steps` | `object` | Status of each individual step: `PENDING`, `VERIFIED`, or `REJECTED`. |
| `completedSteps` | `string[]` | Array of step names that are `VERIFIED`. |
| `verificationMessage` | `string \| null` | Populated with the admin's reason when a step is `REJECTED`. |

#### Routing logic

```
if !profileExists        → call POST /verification/init, then start verification flow
if isVerified === true   → skip to discovery (GET /dating/profile/status)
if isVerified === false  → show verification screen for currentStep
```

---

### 3. `POST /verification/phone/send-otp`

Sends a 6-digit OTP to the user's email (used for phone verification).

**Request body:**
```json
{
  "phoneNumber": "+233501234567"
}
```

**Response (`200`):**
```json
{
  "success": true,
  "data": {
    "phoneNumber": "233501234567"
  },
  "message": "OTP sent successfully"
}
```

---

### 4. `POST /verification/phone/verify-otp`

Verifies the OTP code. On success, marks the phone step as complete and advances the flow.

**Request body:**
```json
{
  "code": "123456"
}
```

**Response (`200`):**
```json
{
  "success": true,
  "data": {
    "phone_number_verified": true,
    "isVerified": true,
    "validationStep": "PROFILE_IMAGE_VERIFICATION",
    "document_verification": false,
    "bio_profile_verification": false
  },
  "message": "Phone number verified successfully"
}
```

> **Note:** `isVerified: true` in this response confirms the **phone step** succeeded. To check if the user is **fully verified** (all 3 steps), always use `GET /verification/status`. The `isVerified` field in the status endpoint is derived from actual step completion, not the stored value.

**After this call:** The frontend should advance to the profile image verification screen.

---

### 5. `POST /verification/bio_profile_url`

Uploads the user's profile/bio image URL. This step is waiting for admin review — the step won't show as `VERIFIED` until an admin approves it.

**Request body:**
```json
{
  "bio_profile_url": "https://cloudinary.com/..."
}
```

**Response (`200`):**
```json
{
  "success": true,
  "data": {
    "bio_profile_image_url": "https://cloudinary.com/...",
    "bio_profile_image_uploaded_at": "2026-08-17T10:00:00.000Z"
  },
  "message": "Bio profile URL updated successfully."
}
```

**After this call:** Advance to the document upload screen. Poll `GET /verification/status` to check when the admin approves (step status changes from `PENDING` to `VERIFIED` or `REJECTED`).

---

### 6. `POST /verification/bio_document_urls`

Uploads the user's verification documents (passport or Ghana card). Also waits for admin review.

**Request body:**
```json
{
  "bio_document_urls": ["https://cloudinary.com/doc1.pdf"],
  "bio_document_type": "PASSPORT",
  "bio_document_number": "G12345678"
}
```

`bio_document_urls` — array of at least 1 valid URL.
`bio_document_type` — optional, accepts `"PASSPORT"` or `"GHANA_CARD"`.
`bio_document_number` — **required**. The unique ID number printed on the card
(Ghana Card number or passport number). It is **globally unique**: the backend
rejects the upload with `409` if the number already belongs to a *different*
account, so one ID card can verify only one account.

**Response (`200`):**
```json
{
  "success": true,
  "data": {
    "bio_document_urls": ["https://cloudinary.com/doc1.pdf"],
    "bio_document_type": "PASSPORT",
    "bio_document_number": "G12345678",
    "bio_document_uploaded_at": "2026-08-17T10:05:00.000Z"
  },
  "message": "Bio documents updated successfully."
}
```

**Error (duplicate ID):**
```json
{
  "success": false,
  "error": "This document number has already been used to verify another account."
}
```
(HTTP `409` — the document number is already linked to a different user.)

**After this call:** Poll `GET /verification/status` until `isVerified === true`.

---

### 7. `GET /verification/validation-step/status`

Returns the status of a single validation step. Useful for checking the current step without fetching the full status.

**Query params:**

| Param | Required | Description |
|---|---|---|
| `step` | No | One of `PHONE_NUMBER_VERIFICATION`, `PROFILE_IMAGE_VERIFICATION`, `DOCUMENT_VERIFICATION`. If omitted, returns the inferred current step. |

**Response (`200`):**
```json
{
  "success": true,
  "data": {
    "current_step": "PROFILE_IMAGE_VERIFICATION",
    "status": "PENDING"
  }
}
```

`status` is one of: `PENDING`, `VERIFIED`, `REJECTED`.

If `REJECTED`, the response includes:
```json
{
  "current_step": "PROFILE_IMAGE_VERIFICATION",
  "status": "REJECTED",
  "verification_message": "Face not clearly visible"
}
```

---

### 8. `GET /dating/profile/status`

Checks if the user has a dating profile and whether it's complete. Use this **after** verification is fully complete (`isVerified === true`).

**Response (`200`):**
```json
{
  "success": true,
  "data": {
    "hasProfile": true,
    "profileStatus": "COMPLETE",
    "profile": { ... }
  }
}
```

| `profileStatus` | Meaning |
|---|---|
| `COMPLETE` | Profile has at least one photo + at least one of: about, headline, or interests. User can access discovery. |
| `INCOMPLETE` | Profile is missing photos or descriptive content. Show the profile creation/edit screen. |

---

## Complete User Flow

```
┌─────────────────────────────────────────────────────┐
│                   NEW USER LOGIN                     │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
              GET /verification/status
                       │
              ┌────────┴────────┐
              │                 │
         profileExists     profileExists
           === false         === true
              │                 │
              ▼                 ▼
    POST /verification/init    Check isVerified
              │                 │
              ▼            ┌────┴────┐
    Start verification      │         │
    flow (Step 1)      isVerified  isVerified
                       === true   === false
                          │         │
                          ▼         ▼
                      Go to     currentStep
                    discovery      │
                          ▲   ┌────┴──────────────────┐
                          │   │                        │
                          │   ▼                        ▼
                          │  PHONE_                  PROFILE_IMAGE_      DOCUMENT_
                          │  VERIFICATION            VERIFICATION        VERIFICATION
                          │   │                        │                   │
                          │   │  send-otp → verify-otp │  bio_profile_url  │  bio_document_urls
                          │   │         │              │        │          │        │
                          │   │         ▼              │        ▼          │        ▼
                          │   │  Poll /status until     │  Poll /status    │  Poll /status
                          │   │  step = VERIFIED        │  until VERIFIED  │  until VERIFIED
                          │   │         │              │        │          │        │
                          │   │         ▼              │        ▼          │        ▼
                          │   └────►Step 2◄────────────┘       └──►Step 3──┘
                          │                                     │
                          │                                     ▼
                          │                            Poll /verification/status
                          │                            until isVerified === true
                          │                                     │
                          │                                     ▼
                          └──────────────────────────── GET /dating/profile/status
                                                         │
                                                   ┌─────┴──────┐
                                                   │            │
                                              hasProfile    hasProfile
                                                === true     === false
                                                   │            │
                                                   ▼            ▼
                                            profileStatus   Create dating
                                            === COMPLETE?   profile (init)
                                              │       │
                                           YES│    NO│
                                              ▼       ▼
                                          Discovery  Edit profile
                                                     screen
```

---

## Step Status Lifecycle

Each step transitions through these states:

```
PENDING → VERIFIED  (admin approves / step auto-verified)
PENDING → REJECTED  (admin rejects with a reason)
REJECTED → PENDING  (user re-submits after fixing issue)
```

When a step is `REJECTED`, the `verificationMessage` field contains the admin's rejection reason. The user should fix the issue and re-submit.

---

## Polling Strategy

After the user submits data for step 2 or 3 (profile image / documents), the backend needs admin review. The frontend should:

1. Show a "Verification in progress" screen
2. Poll `GET /verification/status` every 10-15 seconds
3. Check `steps[currentStep].status`:
   - `VERIFIED` → advance to next step
   - `REJECTED` → show rejection reason, let user re-submit
   - `PENDING` → keep polling

---

## Important Notes

### `isVerified` means two different things in two contexts

| Endpoint | `isVerified` meaning |
|---|---|
| `POST /verification/phone/verify-otp` response | **Step-level**: confirms the phone step succeeded. Always `true` on success. Use this to advance the UI from the OTP screen. |
| `GET /verification/status` response | **Global**: `true` only when all 3 steps are `VERIFIED`. Use this for routing decisions (verification flow vs discovery). |

### The status endpoint is the source of truth

Always use `GET /verification/status` for routing decisions. The individual step responses (verify-otp, bio_profile_url, bio_document_urls) confirm the immediate action succeeded but don't reflect the full verification state.

### Admin review is required

Steps 2 and 3 are not auto-approved. After the user uploads their profile image or documents, the step status will be `PENDING` until an admin reviews and approves/rejects it. The frontend must handle this waiting period.
