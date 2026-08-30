# Voice & Video Calling — Project Status & What's Needed

**Date:** August 29, 2026
**Author:** Backend Team
**Subject:** Backend complete (incl. hardened push pipeline) — frontend implementation required

---

## What's Done (Backend)

The server-side implementation for WhatsApp-style voice and video calling is **complete and deployed to production (Neon database)**.

### Deliverables

| Item | Status |
|------|--------|
| Database schema (calls, audit logs, call push delivery, device registration) | Deployed |
| Call lifecycle API (initiate, answer, decline, cancel, end) | Deployed |
| Atomic call creation (`POST /calls` locks both user rows, rejects duplicate active calls, commits `RINGING`) | Deployed |
| Secure LiveKit token generation | Deployed |
| Device registration API (upsert per installation, Expo/FCM/APNs/VoIP tokens, `lastSeenAt` refresh) | Deployed |
| Durable push outbox + delivery worker (every 10s) | Deployed |
| Push notification delivery (FCM high-priority data-only + Expo within-push-group) | Deployed |
| Expo receipt processing (`DELIVERED`/`FAILED`, bounded backoff, token invalidation) | Deployed |
| Terminal-state change pushes (`CALL_STATE_CHANGED` to both participants) | Deployed |
| Disable devices on logout and on provider rejection | Deployed |
| Missed call auto-expiry worker | Deployed |
| Rate limiting (5 calls/recipient/10min, 20 calls/caller/hour) | Deployed |
| Call history with pagination | Deployed |
| Audit trail for every state transition | Deployed |
| Frontend integration guide | Written |

### What the Backend Handles

- Validates that users are matched before allowing calls
- Prevents blocked users from calling each other
- Ensures only one active call per user at a time (checked inside the creation transaction)
- Atomically transitions call states (compare-and-set `RINGING`/`ANSWERED` only; no race conditions)
- Enqueues a durable `INCOMING_CALL` outbox row per receiver device **before** responding, and delivers it in the background (works even if the call is answered immediately)
- Sends high-priority FCM data-only pushes to all recipient devices on Android and same-group Expo pushes elsewhere; never pushes to the caller's devices
- Verifies delivery via Expo receipts; retries transient failures with bounded exponential backoff; disables and removes tokens the provider rejects (`DeviceNotRegistered`)
- Automatically marks unanswered calls as missed after 40 seconds
- Pushes `CALL_STATE_CHANGED` on DECLINED / CANCELLED / MISSED / ENDED / FAILED so the app always dismisses stale ringing screens
- Logs every state transition for debugging and analytics

---

## What's Needed (Frontend)

**The frontend developer needs to implement the client-side integration.** The backend provides everything — the frontend just needs to consume it.

### Priority 1 — Core Calling (Must Have)

| Task | Owner | Effort |
|------|-------|--------|
| Device registration on app launch | Frontend | 0.5 day |
| Call initiation (tap call button → REST API) | Frontend | 0.5 day |
| Incoming call screen (ringing UI with Answer/Decline) | Frontend | 1-2 days |
| Answer flow (REST API → join LiveKit room) | Frontend | 1 day |
| Decline / Cancel flow | Frontend | 0.5 day |
| Active call screen (video/audio controls, end button) | Frontend | 1-2 days |
| End call flow | Frontend | 0.5 day |
| Call history screen | Frontend | 1 day |

**Estimated effort: 5-7 days**

### Priority 2 — Push Notifications (Must Have for Launch)

| Task | Owner | Effort |
|------|-------|--------|
| Expo push token registration | Frontend | 0.5 day |
| Handle incoming call push in foreground | Frontend | 0.5 day |
| Handle incoming call push (app backgrounded/terminated) | Frontend | 1 day |
| Auto-dismiss expired incoming calls | Frontend | 0.5 day |

**Estimated effort: 2-3 days**

### Priority 3 — Native Calling (Required for Lock-Screen)

| Task | Owner | Effort |
|------|-------|--------|
| iOS: PushKit + CallKit integration (native module) | Frontend + Mobile Native | 3-5 days |
| Android: FCM high-priority + CallStyle notification + full-screen intent | Frontend + Mobile Native | 2-3 days |

**Estimated effort: 5-8 days**

### Priority 4 — Polish

| Task | Owner | Effort |
|------|-------|--------|
| Multi-device handling (answer on one device → dismiss on others) | Frontend | 1 day |
| Voice-to-video upgrade mid-call | Frontend | 1 day |
| Error handling for all edge cases (busy, blocked, expired) | Frontend | 1 day |
| Call history pagination | Frontend | 0.5 day |

**Estimated effort: 2-3 days**

---

## Total Estimated Timeline

| Phase | Duration | Dependency |
|-------|----------|------------|
| Core calling (Priority 1) | 5-7 days | None |
| Push notifications (Priority 2) | 2-3 days | Can overlap with P1 |
| Native calling (Priority 3) | 5-8 days | After P1+P2 |
| Polish (Priority 4) | 2-3 days | After P1+P2 |
| **Total** | **~3-4 weeks** | |

**Minimum viable calling (without lock-screen): ~1.5-2 weeks**
**Full native calling experience: ~3-4 weeks**

---

## What the Frontend Dev Needs

1. **API access** — the backend is deployed. They need the base URL and a valid access token.
2. **Integration guide** — written at `docs/call-integration-guide.md` in the server repo. Covers every endpoint, socket event, push notification payload, LiveKit usage, and error code with code examples.
3. **Firebase credentials** — need `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) from the Firebase console for push notification delivery.
4. **EAS build** — the call feature requires a native build (Expo Go cannot support LiveKit WebRTC or native calling integrations).

---

## Blockers / Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| No Firebase project configured yet | Push notifications won't deliver on Android | Set up Firebase project and download config files |
| No Apple Push Cert configured | iOS VoIP pushes won't work | Set up APNs key in Apple Developer Console |
| LiveKit not configured in env | Calls will use placeholder tokens (dev only) | Configure `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| Expo Go testing | Cannot test native calling features | Use EAS dev client or production build |

---

## API Reference (Quick Reference for Frontend)

All endpoints require `Authorization: Bearer <token>`.

```
POST   /calls                  → Initiate call
GET    /calls/:callId          → Get call state
POST   /calls/:callId/answer   → Answer
POST   /calls/:callId/decline  → Decline
POST   /calls/:callId/cancel   → Cancel
POST   /calls/:callId/end      → End
POST   /calls/:callId/token    → Get LiveKit token
GET    /calls/history          → Call history

POST   /devices/register       → Register device
DELETE /devices/:deviceId      → Unregister device
```

### Socket Events (Server → Client)

```
call.incoming     → New call received (show incoming UI)
call.ringing      → Your outgoing call is ringing
call.answered     → Recipient answered (join room)
call.declined     → Recipient declined
call.cancelled    → Caller cancelled
call.ended        → Call ended (by either side)
call.missed       → Call was not answered
```

---

## Recommendation

Assign the frontend developer to begin **Priority 1 (Core Calling)** and **Priority 2 (Push Notifications)** immediately. These can be worked on in parallel. The integration guide is ready — no backend work is blocking them.

**Priority 3 (Native Calling)** should be scoped for a follow-up sprint if the frontend dev doesn't have native module experience, as it requires writing platform-specific code (iOS Swift / Android Kotlin) beyond standard Expo.

---

*Full technical documentation: `docs/call-integration-guide.md` in the dagh-server repository.*
