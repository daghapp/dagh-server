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
`src/config/payments.ts:42`); writes refresh the cache synchronously. A toggle
therefore takes effect **immediately on the instance that handled the write**, and
within 10 seconds on every other instance — the caches are per-process, so there
is no cross-instance invalidation. Single-instance deployments see no lag.

Free mode's own cache (`FREE_MODE_CACHE_TTL_MS`, `src/helpers/membership.ts`) is
keyed on the payment state it was resolved under, so it invalidates on the same
read that observes a toggle rather than waiting out its TTL. That matters: when
the two caches were independent, disabling payments left a window — up to 10
seconds — in which the kill switch had fired but free mode had not yet engaged.
That window is the failure this whole system exists to prevent, and it is now
closed.

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
| Itinerary fee | `src/modules/itinerary/itinerary.payment.controller.ts:50` | **Not blocked** — the fee is waived and the itinerary is released. See §4 |

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

### The itinerary fee is waived

Itinerary generation is also open, but through a different mechanism, and the
distinction matters if you change this code.

The itinerary is gated on `tour_request.paymentStatus === "SUCCESS"`
(`src/modules/itinerary/itinerary.service.ts:189`) — a **per-record payment
gate**, not a membership tier. Free mode therefore does not reach it: the only
thing that can flip `SUCCESS` is a completed Hubtel checkout, which the kill
switch makes impossible. Left alone, disabling payments skips the charge and then
locks the user out of the itinerary they were just promised, for the entire
outage.

So `POST /itinerary/:tourRequestId/payment` waives the fee explicitly while
payments are off, writing `paymentStatus: "SUCCESS"` with
`paymentId: "FREE_ITINERARY"` — the same shape the zero-fee path has always used
(`itinerary.payment.controller.ts:50`). The response carries `freeMode: true` and
`checkoutUrl: null` so the client can skip the redirect and say why.

The reasoning for waiving rather than blocking: the GHS 350/500 facilitation fee
is **DAGh's own revenue** — it books to `Account_DAGh_Revenue` as
*"Itinerary Facilitation Fee"* (`itinerary.payment.controller.ts:182`). It is a
product, not a pass-through, so it behaves like a membership entitlement.

**One deliberate departure from "nothing is persisted".** Free mode normally
writes nothing, so access reverts the instant payments come back. The itinerary
waiver *does* persist `paymentStatus: "SUCCESS"`. That is intentional: a user
who generated an itinerary during the outage keeps it after re-enable, rather
than being locked out of an `itinerary` row that already exists. The cost is that
an outage window is a window in which itineraries are genuinely free — the same
trade the zero-fee path already makes.

### Re-calling the endpoint is safe

Persisting `SUCCESS` creates a hazard that did not exist before: once payments
are back on, a request waived during the outage no longer matches
`amount === 0` or `paymentsOff`, so a naive second call would charge for it —
resetting `paymentStatus` to `PENDING` and locking the user out of the itinerary
they already have.

`POST /itinerary/:tourRequestId/payment` therefore returns early on an
already-`SUCCESS` request, before any Hubtel call
(`itinerary.payment.controller.ts:24`). The response carries `alreadyPaid: true`
and no `checkoutUrl`. This is plain idempotency, not a free-mode concern — it
also stops a double-tap from charging twice.


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

**Pass-through payments stay closed.** The dividing line is *whose money is it*:

| Fee | Whose money | Free mode |
| --- | --- | --- |
| Membership plans | DAGh — access to the product | **Open** |
| Itinerary facilitation | DAGh — `Account_DAGh_Revenue` | **Open** (waived, §4) |
| Tour bookings | The tour operator | **Closed** |
| Visa-on-arrival | The government / agent | **Closed** |

A pass-through fee is money DAGh never keeps, so there is no version of "free"
that is not a mispricing — the app does not offer one. Those flows return the
errors in §3 and cannot be completed while payments are off.

DAGh's own fees are different: not charging them loses nothing but the revenue,
and blocking them strands a feature the user is entitled to. So the rule for
adding a new paid feature is **decide whose money it is first.** If it is
DAGh's, it must be reachable while payments are off.

## 4a. Why features go missing when payments are off

Free mode only works if every gate is *derived* from the resolver. There are
three ways to get this wrong, and all three shipped as bugs before the itinerary
fix. They are worth knowing because the symptom is always the same — a feature
goes quiet the moment the kill switch is pulled, with nothing in the logs.

| Trap | What it looks like | Rule |
| --- | --- | --- |
| **Per-record payment flag** | A column like `tour_request.paymentStatus` that only a completed checkout can set. Free mode lifts tiers; it cannot flip a column. | If a gate reads a payment column, it also needs a free-mode branch. |
| **Reading the subscription row directly** | `prisma.user.findUnique({ select: { subscription: { tierCode } } })`. Fine for a payer, empty for a comped user and for free mode, so both silently get `FREE`. | Never read `user_subscriptions` in feature code. Call `getEffectiveAccess()`. |
| **Assuming a tier implies a row** | Entitlement granted at resolution time, then the code demands the backing record and throws. `FREE_MODE` writes nothing by design, so this always fires. | Only require the record when `access.source === "SUBSCRIPTION"`. |

All three were found in the same audit, in `swipe.controller.ts` (super-like
daily limit, 1/day instead of 20) and `membership.service.ts` (priority support
throwing *"Your subscription is not active"* — which closed the support channel
during the very outage it exists for). `getLikesReceived` carries a comment
warning about the second trap; it had been fixed there and left broken 250 lines
away.

**Audit checklist for a new gate.** Three questions, and if any answer is "no",
the feature is dead while payments are off:

1. Does it call `getEffectiveAccess()` / `getPerksTierCode()` rather than
   reading `user_subscriptions`?
2. If it keys off a payment column, is there a free-mode branch that satisfies
   it?
3. If it throws when a backing record is missing, is that guarded by
   `access.source === "SUBSCRIPTION"` rather than applied to every source?

Tier-only gates are already covered — free mode feeds every consumer of
`getEffectiveAccess()`, and `matching.service.ts` resolves in batch rather than
per candidate. Note that `matching.service.ts` and `swipe.controller.ts` use
`perksTierCode`, not `tierCode`, because a quota perk like a super-like limit is
a perk and must respect `includePaidPerks`.

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

Two things deliberately **survive** re-enabling, both consequences of the
itinerary waiver persisting `SUCCESS` (§4):

- A user who generated an itinerary during the outage keeps viewing it, rather
  than losing access to a row that already exists.
- `POST /itinerary/:tourRequestId/payment` on such a request returns
  `alreadyPaid: true` with `freeMode: true` and no `checkoutUrl`, so the client
  should not expect to redirect. A client that only checks for `checkoutUrl` and
  treats its absence as an error will show a false failure here.

Free mode grants access, not tier *perks that were paid for* — but note that
because it forces `includePaidPerks: true`, a user on a comp that had
`includePaidPerks: false` gets full perks while payments are off and drops back
to FREE perks on re-enable. That is the documented fail-open choice (§6), not a
regression.

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
| A feature is dead while payments are off | A gate that free mode does not reach | §4a — check the gate against the three questions |
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
`tests/payment-gateway-settings.test.ts`, `tests/access-grants.test.ts`,
`tests/itinerary-free-mode.test.ts` (4), `tests/superlike-free-mode.test.ts` (4),
`tests/priority-support-free-mode.test.ts` (3)

```bash
npx vitest run tests/free-mode.test.ts tests/admin-payment-control.test.ts \
  tests/itinerary-free-mode.test.ts tests/superlike-free-mode.test.ts \
  tests/priority-support-free-mode.test.ts
```

`tests/free-mode.test.ts` covers the pure rule (no-downgrade, equal-tier,
perks preservation), tier selection (highest active paid, inactive excluded,
zero-priced and `FREE` excluded), and the end-to-end outcome: a FREE user
gaining and losing the grant around a payment toggle, a paying subscriber
lifted and restored with their row untouched, and
`hasPaidActiveMembership` / `getPerksTierCode` following.

The three `*-free-mode.test.ts` files are the regression guards for the traps
in §4a, one per gate. Each was verified to **fail against the pre-fix code**, so
they will catch a reintroduction rather than merely describing current
behaviour. Super-like and priority support had no prior coverage at all, which is
why those bugs survived.
