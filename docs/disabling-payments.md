# Disabling the Payment System (Admin Guide)

Two questions, answered up front.

---

## Short answer

**1. How does an admin disable payments?**
One `PATCH` call — or one toggle in **Admin → Settings → Payment Gateway**. No
redeploy, no restart. Details in §2.

**2. When payments are disabled, do users get the paid features for free?**

**Yes.** Turning payments off puts the app into **free mode**: every user is
granted the highest-priced *active paid* plan, paid perks included, for as long
as payments stay off. No second switch to remember, and no way to end up with a
dead paywall in front of users who cannot pay. Details in §4.

The important thing to understand is that these are **two effects from one
switch**:

| Effect | What it changes |
| --- | --- |
| **Kill switch** | Nobody can *start* a payment — checkout returns `503` |
| **Free mode** | Everybody is *entitled* to the top paid tier, so gated features open |

Free mode is **not** a global "everyone is free" flag and it is **not** the same
as disabling the paywall. The tier is real, the perks are real, and it reverts
on its own the moment payments come back. Turn payments back on and the app is
exactly as it was — no data was rewritten. Details in §5.

---

## 1. Where the switch lives

State resolution happens in `src/config/payments.ts`. First match wins:

| # | Source | When it applies |
| --- | --- | --- |
| 1 | `payment_gateway_configs.paymentProcessingEnabled` (row `provider = "HUBTEL"`) | Once a gateway config row exists — **the normal case** |
| 2 | `system_settings` row `key = "PAYMENTS_ENABLED"` | Legacy path, only if no gateway row exists at all |
| 3 | `process.env.PAYMENTS_ENABLED === "true"` | Last-resort fallback if the DB is unreachable |

So a legacy `PAYMENTS_ENABLED=false` in `.env` **will not** disable payments once
someone has opened the gateway settings screen. If you think payments are
disabled, check `GET /admin/payments/status` (§7) rather than the env var.

Reads are cached in memory for **10 seconds** (`CACHE_TTL_MS`,
`src/config/payments.ts:42`); writes refresh the cache synchronously, so a
disable takes effect on every instance's next read without waiting on the TTL.

---

## 2. How to disable it

### Option A — the gateway settings screen (recommended)

**Admin → Settings → Payment Gateway → "Payment processing" switch → Off.**

API equivalent:

```bash
curl -X PATCH "$API_URL/admin/settings/payment-gateway/processing" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false, "reason": "Hubtel incident; ETA 16:00 GMT"}'
```

Requires an authenticated `ADMIN` account (`requireAdmin`).

| Field | Type | Rules |
| --- | --- | --- |
| `enabled` | `boolean` | **Required** |
| `reason` | `string` | Optional, max 500 chars. Surfaced to users on `GET /payment/status` |

Schema: `setPaymentProcessingSchema` (`src/validator/payment-gateway-validator.ts:60`).

Response: `{ success: true, data: { paymentProcessingEnabled: false, … } }`

### Option B — the legacy payments console endpoint

```bash
curl -X PATCH "$API_URL/admin/payments/status" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false, "reason": "Hubtel incident; ETA 16:00 GMT"}'
```

This is an **alias**, not a second switch. `setPaymentControlStatus()`
(`src/config/payments.ts:159`) writes through to the same gateway row when one
exists. It exists so older admin consoles keep working; there is only ever one
switch in the system, so the two endpoints can never disagree.

It writes a second audit entry (`ENABLE_PAYMENTS` / `DISABLE_PAYMENTS`, entity
type `PAYMENT`) on top of the one the gateway path writes, so the activity log
shows the disable under both entity types.

### Option C — env var (legacy deployments only)

```bash
PAYMENTS_ENABLED=false
```

Only read when **no** gateway config row exists. See §1. Changing this requires
a deploy and is not the recommended path.

### Turning it off automatically

Payment processing is **force-disabled** — with a `processingDisabledReason`
explaining why — whenever the gateway connection is invalidated
(`src/services/payment-gateway-config.service.ts:322`):

- **Credentials changed** (client ID, client secret, or secret cleared) →
  `"Automatically disabled because payment credentials changed."`
- **Environment switched** (e.g. `TEST` → `LIVE`) →
  `"Automatically disabled because the gateway environment changed."`

This is deliberate: never leave money movement enabled against unverified
credentials. **Note that these auto-disables also engage free mode** — rotating
your Hubtel credentials hands the whole app to the top tier until you re-enable
processing. See the risks in §6.

---

## 3. What the kill switch blocks

Blocked with `PAYMENTS_DISABLED_MESSAGE` — *"Payments are temporarily disabled.
Please try again later."* — on every path that **starts** a payment:

| Operation | Guard | What the caller sees |
| --- | --- | --- |
| `initializePayment` — card checkout (Visa on arrival, tour booking/request) | `src/services/payment.service.ts:66` | `POST /payment/initialize` → **503** + disabled message |
| `subscriptionPayment` — subscription invoice | `src/modules/payment-management/payment.controller.ts:85` | **503** + disabled message |
| `initializePaymentMOMO` — Mobile Money | `src/services/payment.service.ts:166` | `POST /tours/bookings` → **400** `"Payment initiation failed"` |
| Paid-plan checkout via `POST /membership/subscribe` | reaches the guards above | `success: false`, `code: CHECKOUT_INITIALIZATION_FAILED`, disabled message as `message` |

The service guards return **before any DB write and before any Hubtel call** —
no `payment` row is created, no checkout URL is generated, no
`PAYMENT_PENDING` subscription is written, and **no `tour_bookings` row is
created** (the booking is only persisted after payment init succeeds,
`src/modules/tour-management/user-tour.controller.ts:434`).

> **Note on error codes.** Not every blocked path returns 503. The MOMO guard
> is reached through tour booking, which collapses any payment-init failure into
> a generic **400** (`user-tour.controller.ts:470`) — so a tour booking that
> fails while payments are disabled looks the same on the surface as a booking
> that failed for any other payment reason. The disabled reason is only
> preserved on the 503 paths and in the server log. `initializePaymentMOMO` is
> not exposed as a route of its own.

### Deliberately **not** blocked

- `verifyPayment` (`GET /payment/verify/:reference`)
- `checkTransactionStatus` (`GET /payment/transaction-status/:posSalesId`)
- Hubtel callbacks and cancellations

Payments already in flight must always be resolvable. A user who paid one minute
before the switch went off still gets their subscription activated — and under
free mode they keep access regardless.

---

## 4. Free mode: what unpaid users get

**This is the answer to "will the app skip the payment so users can use it for
free?" — yes, for everything that was gated behind a membership tier.**

### The rule

> When payments are disabled, `resolveEffectiveAccess` is passed the
> **highest-priced active paid plan**, and every user resolves to at least that
> tier.

Implemented in `src/helpers/membership.ts`:

| Export | Role |
| --- | --- |
| `getFreeModeTierCode()` | The tier granted, or `null` when payments are on. Cached 10s |
| `applyFreeMode(access, tier)` | Pure rule — lifts access, never lowers it |
| `_resetFreeModeCache()` | Test-only cache reset |

`getEffectiveAccess()` — the single function feature code is meant to call —
applies it, so every consumer of the resolver inherits free mode at once.

### Tier selection

Resolved from `membership_plans`, **not** hardcoded:

```
where: { isActive: true, price: { gt: 0 }, code: { not: "FREE" } }
orderBy: { price: "desc" }
take: 1
```

- **Highest price** wins, so "top tier" follows your pricing.
- **Inactive plans are excluded** — deactivating the top plan during an outage
  *lowers* the free grant instead of handing out a tier that is no longer sold.
  This is the cheapest way to soften the blast radius (§6).
- **Zero-priced and `FREE` plans are excluded** — a comped or promotional plan
  must not become the ceiling, or free mode would grant `FREE` and unlock
  nothing.

With the current price list that means **ELITE_AMBASSADOR** is granted.

### What is included

Everything a paid tier normally confers, **including the paid perks**:

| Unlocked | Mechanism |
| --- | --- |
| Paid-tier content and features | `access.tierCode` |
| Discovery ranking boost | `perksTierCode` → `resolveTierBoost` (`matching.service.ts:434`) |
| Priority support tickets | `perksTierCode` (`membership.service.ts:454`) |
| Likes-received profile reveal | `access.tierCode` (`swipe.controller.ts:375`) |

`includePaidPerks` is forced to `true` under free mode. The reasoning: nobody
can buy the perk while payments are off, so nobody is held to it. A paid tier
that could not be purchased would be a tier whose defining restriction could not
be enforced.

### Invariants

**Free mode only ever adds access.** It never downgrades anyone:

- Someone whose own entitlement already ranks **above** the free tier — a comp
  to a tier above the top active plan — keeps exactly what they had, including
  their grant's `includePaidPerks` setting. Free mode never overrides a ranking
  decision an admin already made.
- At **equal** tier the existing source wins, so a real payer keeps
  `source: "SUBSCRIPTION"` rather than being relabelled.

**Nothing is persisted.** Free mode is applied at resolution time only:

- No `user_subscriptions` row is created, amended, or deleted.
- No `subscription_access_grants` are issued.
- An existing `BASIC` subscriber resolves to `ELITE_AMBASSADOR` while payments
  are off, and snaps back to `BASIC` the moment they are re-enabled.

This is what makes it safe to leave on during a long incident: the blast radius
is bounded by the switch, and recovery is a single `PATCH`.

**`accessSource` reports `FREE_MODE`.** `GET /membership/subscription` surfaces
`accessSource` so the app can say *"everything is open while payments are
paused"* rather than telling a user to go and pay for something they cannot pay
for. Handle the new value in any client switch on that field.

### What free mode does **not** do

**Real purchases stay closed.** Free mode covers *membership entitlements* — the
things a subscription unlocks. It does not make a payment optional:

- **Tour bookings** — the money pays the tour operator.
- **Visa-on-arrival fees** — the money pays the government/agent.

Those flows return the errors in §3 and cannot be completed while payments are
off. There is no version of "free tour booking" that is not a mispricing, so
the app does not offer one.

---

## 5. Re-enabling

```bash
curl -X PATCH "$API_URL/admin/settings/payment-gateway/processing" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

Free mode ends immediately. Everyone resolves back to their real entitlement —
their own subscription, their comp, or `FREE`. Nothing needs to be migrated or
rolled back.

**409 `GATEWAY_NOT_CONNECTED`** is returned if the *currently selected*
environment has not been verified (`payment-gateway-config.service.ts:635`).
Turning payments **off** is never blocked — that asymmetry is intentional, so a
broken gateway can never trap you with money movement enabled. To clear the 409:
save credentials → `POST /admin/settings/payment-gateway/connect` → enable.

---

## 6. Risks worth knowing before you use this

Free mode is automatic by design, and that has consequences you should be
deliberate about.

**An outage is a free-for-all.** Because free mode is implied by the payment
switch rather than a separate control, a 40-minute Hubtel incident gives the
whole user base the top paid tier for 40 minutes. The design accepts this: the
alternative is a paywall nobody can get past, which is a worse outcome during an
incident. But it means **payment downtime now has a revenue cost**, and the
incident you are running should be short.

**Automatic credential rotation triggers it.** Saving new Hubtel credentials or
switching environment force-disables processing (§2) — which engages free mode.
A routine key rotation silently opens the app to everyone. Plan for it: rotate
outside peak, and keep the window short.

**Ranking becomes uniform.** Every free-mode user gets the same top-tier boost,
so `tierBoost` stops differentiating anyone and discovery ranking falls back to
the other scoring signals. Expected and harmless while payments are off; it
self-corrects on re-enable.

**No audit row for free mode itself.** The toggle is audited
(`DISABLE_PAYMENT_PROCESSING`), but the per-user grant is a computed result, not
a record. There is no "who got free access" list to query — the correct audit
trail is *the payment switch being off*, which is exactly what was logged.

### Softening the blast radius

You do not need a second switch. **Deactivate the expensive plans** for the
duration:

```bash
curl -X PATCH "$API_URL/admin/plans/<planId>" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"isActive": false}'
```

The free grant drops to the next-highest active paid plan, so you can run an
incident on `BASIC` instead of `ELITE_AMBASSADOR`, or deactivate every paid plan
to drop the grant to `FREE` — which makes free mode a no-op and leaves only the
kill switch. Remember to reactivate afterwards; nothing re-enables a plan for
you.

---

## 7. Verify, audit, troubleshoot

### Check current state

```bash
# Public — what the app sees. Never exposes updatedBy.
curl "$API_URL/payment/status"

# Admin — adds updatedAt + updatedBy
curl "$API_URL/admin/payments/status" -H "Authorization: Bearer $ADMIN_TOKEN"

# Full gateway picture: connectionStatus, environment, credentialSource,
# processingDisabledReason, lastTestedAt
curl "$API_URL/admin/settings/payment-gateway" -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Audit trail

Every toggle writes an `AdminActivityLog` row. Look for action
`ENABLE_PAYMENT_PROCESSING` / `DISABLE_PAYMENT_PROCESSING` under entity type
`PAYMENT_GATEWAY` (plus `ENABLE_PAYMENTS` / `DISABLE_PAYMENTS` under `PAYMENT`
if you used the legacy endpoint), with the reason in the note.

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `GET /payment/status` still says enabled for ~10s | Cache TTL | Wait; writes refresh it immediately anyway |
| Payments off despite `PAYMENTS_ENABLED=false` in `.env` | A gateway row exists and it wins | Use the API/settings screen |
| Payments switched themselves off | Credentials or environment changed | Read `processingDisabledReason` — free mode is now on too |
| Free mode is too generous | Top plan is the ceiling | Deactivate expensive plans (§6) |
| Free mode granted nothing | No active paid plan | Create/activate a paid plan, or accept the kill switch only |
| Enable returns 409 | Selected environment unverified | **Connect** first, then enable |
| A user paid but never got their tier | In-flight payment, verification still open | `GET /payment/verify/:reference`, or wait for the callback |

---

## 8. Related documents

- [`payment-control-system.md`](./payment-control-system.md) — legacy
  `system_settings` toggle and the original enforcement map
- [`payment-gateway-settings.md`](./payment-gateway-settings.md) — the gateway
  state machine, connection rules, and sanitization invariants
- [`access-grants.md`](./access-grants.md) — complimentary access in full
- [`payment-gateway-frontend-guide.md`](./payment-gateway-frontend-guide.md) —
  building the settings screen

**Tests:** `tests/free-mode.test.ts` (15), `tests/admin-payment-control.test.ts`,
`tests/payment-gateway-settings.test.ts`, `tests/access-grants.test.ts`

```bash
npx vitest run tests/free-mode.test.ts tests/admin-payment-control.test.ts
```

`tests/free-mode.test.ts` covers the pure rule (no-downgrade, equal-tier,
perks preservation), tier selection (highest active paid, inactive excluded,
zero-priced and `FREE` excluded), and the end-to-end outcome: a FREE user
gaining and losing the grant around a payment toggle, a paying subscriber
lifted and restored with their row untouched, and
`hasPaidActiveMembership` / `getPerksTierCode` following.
