# LiveKit Cloud — What the Backend Needs From the Project Manager

Everything the PM/owner must provide or decide so the call feature (LiveKit) can go live. The backend code is done (`POST /calls/token` issues a real LiveKit AccessToken and returns `serviceUrl`); it only activates when the `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` env vars are present.

---

## 1. Create the LiveKit Cloud project

| # | Action | Who |
|---|--------|-----|
| 1.1 | Sign up / sign in at [cloud.livekit.io](https://cloud.livekit.io) and create a project | PM (or the person who owns the company account) |
| 1.2 | Confirm who owns the account for billing access | PM |
| 1.3 | Create **two projects** — one `dagh-staging`, one `dagh-prod` — so dev/test usage never shares keys or hits prod quotas | PM/ops |

## 2. Pick a plan (PM decision)

Plans (current, livekit.com/pricing). Build is a **hard cap** — no surprise overage; calls simply fail once the monthly allowance is used up.

| Plan | Cost | WebRTC minutes/mo | Concurrent connections | When it fits |
|------|------|--------------------|------------------------|--------------|
| **Build** | $0 | 5,000 | 100 | Development + soft launch. ~250 ten-minute 1:1 calls/mo (a 10-min call = 20 participant-minutes) |
| **Ship** | $50/mo | 150,000 | 1,000 | ~7,500 ten-minute 1:1 calls/mo |
| **Scale** | $500/mo | 1,500,000 | 5,000 | Production scale / group calls / recording |
| **Enterprise** | custom | custom | custom | Custom SLA, SSO |

- [ ] **Decision needed:** which plan for staging and which for prod?
- [ ] Confirm the product is **1:1 calls only** for v1 (each call consumes 2 participant-minutes per minute). No group calls planned?
- [ ] Note: for 1:1 calling, `canPublish`/`canSubscribe` grants are already set on every token — no per-room action needed.

## 3. Copy the credentials to the backend (blocker)

From the dashboard: **project → Settings → Keys**. Hand over these three values for **each** environment:

| Env var | Example | Purpose |
|---------|---------|---------|
| `LIVEKIT_URL` | `wss://dagh-prod-xxxx.livekit.cloud` | The WebSocket URL returned to clients as `serviceUrl` |
| `LIVEKIT_API_KEY` | `APIxxxxx` | Used to sign AccessTokens |
| `LIVEKIT_API_SECRET` | `...` | Used to sign AccessTokens (secret — never commit it) |

- [ ] Provide the three values for **staging**
- [ ] Provide the three values for **prod**

Backend adds them to `.env` locally and to the Render environment (`render.yaml` envVars) once received.

## 4. Confirm env-var wiring on Render

- [ ] Add `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` to the Render service env vars (or commit them in `render.yaml`).
- [ ] Confirm `API_URL` stays set (used as fallback `serviceUrl` when LiveKit is unconfigured).
- [ ] Decide whether `CALL_SERVICE_URL` is still needed — it is **not**, once LiveKit is live (LiveKit takes precedence).

## 5. Region & compliance decisions

- [ ] Pick a **region** for each project (closest to users, e.g., EU/Frankfurt for Ghana → `eu-west`). Affects latency and data residency.
- [ ] If the app is Ghana-facing, confirm whether **data residency / DP Act** rules require a specific region.

## 6. Cost guardrails

- [ ] Confirm whether **Build (hard cap)** is acceptable for prod launch or a paid plan is approved.
- [ ] Approve the projected spend estimate before launch.
- [ ] Assign who receives LiveKit billing alerts/emails.

---

## Open decisions checklist (for the PM)

- [ ] LiveKit account owner identified
- [ ] Plan chosen for staging and prod
- [ ] `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` handed over for staging and prod
- [ ] Render env vars updated
- [ ] Region selected
- [ ] 1:1-only calls confirmed for v1
