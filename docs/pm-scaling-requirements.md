# Scaling Changes — What the Backend Needs From the Project Manager

Everything the PM/owner must provide or decide so the scaling work lands. The backend code is **done and verified** (Redis-backed Socket.IO adapter, shared rate limiting, persistent sessions, distributed-lock cron jobs, fixed discovery ranking). It activates only when `REDIS_URL` is set; without it the app runs in single-instance mode exactly as before.

---

## 1. Provision Redis (blocker)

| # | Action | Who |
|---|--------|-----|
| 1.1 | Create a **Redis instance** for staging | PM (or the person who owns the infra account) |
| 1.2 | Create a **Redis instance** for prod (separate — never share staging/prod data) | PM/ops |
| 1.3 | Confirm who owns the account for billing access | PM |
| 1.4 | Choose the **region** for each instance (closest to the app, e.g. Frankfurt for Ghana → `eu-west`; affects latency + data residency) | PM |

- [ ] **Decision needed:** Redis provider — Render's built-in Redis, Redis Cloud, Upstash, or self-hosted?
- [ ] **Decision needed:** which plan for staging and which for prod (see costs below).

## 2. Hand over the connection string (blocker)

| Env var | Example | Purpose |
|---------|---------|---------|
| `REDIS_URL` | `redis://:password@host:port` | Shared Socket.IO adapter (realtime fan-out across instances), cross-instance presence, shared rate-limit store, distributed locks for cron jobs |

- [ ] Provide `REDIS_URL` for **staging**
- [ ] Provide `REDIS_URL` for **prod**

The backend adds them to `.env` locally and to the Render environment once received. **Never commit a real `REDIS_URL`** — the value in `render.yaml` must reference a Render env var, not the literal credentials.

## 3. Deployment shape decision (PM decision)

| Option | What it means | Redis needed? |
|--------|---------------|---------------|
| **A. Stay single instance** | No infra change. Everything works today; cron jobs, rate limits, realtime all run on one process | No |
| **B. Multiple instances (scaled)** | 2+ replicas behind the load balancer. Requires Redis (everything in this doc) | Yes |
| **C. Multiple instances + separate worker** | Same as B, but cron jobs move to a dedicated service later | Yes |

- [ ] **Decision needed:** which option for **staging** and which for **prod**?
- [ ] If B/C: **how many replicas** to start with? (recommendation: 2 for staging, 2–3 for prod)
- [ ] If B/C: confirm Socket.IO transport — we recommend **WebSocket-only** on the client (`transports: ["websocket"]`) to avoid needing sticky sessions. If HTTP long-polling must be supported, the load balancer needs **sticky sessions** enabled.

## 4. Env-var wiring on Render

- [ ] Add `REDIS_URL` to the Render service env vars for staging and prod.
- [ ] Confirm `DATABASE_URL` remains set (sessions now live in the `session` table, which Postgres auto-creates on first boot — no migration run needed).
- [ ] Optional tuning vars (defaults are fine to start): `DATABASE_POOL_MAX` (default 10), `DATABASE_*_TIMEOUT_MS`, `DATABASE_*_STATEMENT_TIMEOUT_MS`.
- [ ] Confirm which instance(s) run the cron jobs. With Redis, the lock ensures only **one** replica runs them, so it's safe to leave them on all replicas.

## 5. Cost guardrails

| Item | Notes |
|------|-------|
| Redis (staging) | Tiny instance (128 MB, ~$0–15/mo depending on provider). Dev traffic only |
| Redis (prod) | Sizing depends on connected users + realtime load. Start small, monitor `maxmemory` / evictions |
| Replicas | Render charges per running web service instance |

- [ ] Approve the projected spend before launch.
- [ ] Assign who receives Redis + Render billing alerts.

## 6. Verification plan (what to test after go-live)

- [ ] Two replicas: send a message from account A → account B connected to a **different** replica; confirm it arrives in real time (proves the Socket.IO adapter).
- [ ] Login/logout from both replicas; confirm presence online/offline is correct across them.
- [ ] Rapid-fire 20+ login attempts from one IP against the load balancer; confirm the rate limit still triggers (shared store).
- [ ] Confirm OAuth (Google/Facebook/Apple) login still works after a server restart (session persistence).
- [ ] Confirm the payment reconciliation cron runs once per 5-min window (check the logs on all replicas — only one should log activity).
- [ ] Confirm a visa payment that succeeds at Hubtel credits the ledger **exactly once**, even if the job is redeployed mid-run.

---

## Open decisions checklist (for the PM)

- [ ] Redis provider + plan chosen for staging and prod
- [ ] Redis region selected
- [ ] `REDIS_URL` handed over for staging and prod
- [ ] Deployment shape chosen (single vs multi-instance) for staging and prod
- [ ] Replica count confirmed
- [ ] Socket.IO transport / sticky-sessions decision confirmed
- [ ] Render env vars updated (`REDIS_URL` + optional pool tuning)
- [ ] Spend approved and billing alerts assigned
- [ ] Verification checklist run after go-live
