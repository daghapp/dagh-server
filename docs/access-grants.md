# Complimentary Access Grants (Comped Membership)

Lets an admin give a specific user access to a paid tier **without a payment** —
board members, partners, sponsors, staff, or anyone else you decide to make an
exception for.

Every decision is made per grant, by an admin, and is recorded in the audit trail.

> **Not the same as free mode.** Turning the payment system off grants *everyone*
> the highest active paid plan automatically — see
> [`disabling-payments.md`](./disabling-payments.md) §4. Grants remain the tool
> for exempting a *specific* person while payments are on, and the only way to
> give someone access permanently or at a tier above the top plan.

---

## How it works

A grant is a separate record from the user's subscription. That is the whole
design:

- A comp and a real paid subscription **coexist**. If you comp someone to
  `GOLD_INVESTOR` and they later subscribe to `BASIC` for real, they keep the
  comp. Writing the comp into `user_subscriptions` instead would have been
  silently overwritten by that subscription — quietly revoking your decision.
- Revoking a comp is **distinct** from a user cancelling. One is an admin
  decision, the other is a user action, and the audit trail keeps them apart.
- Grants are **soft-revoked, never deleted**. The row is the record explaining
  why someone had access, so `GET /admin/users/{userId}/access` can always
  answer "why does this person have access?" instead of making you infer it from
  tier codes.

### Perks are opt-in

A grant has three independent effects:

| Effect | Controlled by | Grants |
| --- | --- | --- |
| **Content access** — the paid tier's features and paywalled content | `tierCode` | Always |
| **Ranking perks** — matching boost, priority support | `includePaidPerks` | Only when `true` |
| **Service-fee exemption** — itinerary, tour bookings, paid plan checkout | `waiveServiceFees` | Only when `true` |

`includePaidPerks` defaults to **`false`**, which means a comp waives the fee
while leaving the user equivalent to `FREE` for ranking. This is deliberate: it
stops comped users from outranking paying members in discovery, which would
quietly devalue the thing people are paying for. Turn it on for a genuine
equivalent — a board member who should genuinely have ELITE_AMBASSADOR
visibility.

### Perpetual or time-boxed

`endDate` is optional. Omit it and the comp is **perpetual**; set it and it
expires on that date. Grants never auto-renew — there is no billing side
effect, so `expireExpiredSubscriptions` and `renewSubscriptions`
(`src/services/membership.service.ts`) never touch them. A perpetual comp is
literally `endDate: null` + not revoked.

To revoke early without losing the record, either `PATCH` `endDate` into the
past, or use the revoke endpoint.

### Lifetime free access

**Lifetime free** is not a separate model or flag on `User`. It is one grant with
both of these set:

```json
{
  "email": "person@example.com",
  "tierCode": "BASELINE",
  "includePaidPerks": false,
  "waiveServiceFees": true,
  "reason": "Founding partner — lifetime exemption",
  "endDate": null
}
```

Identify the grantee by `email` or `userId`. Email is matched
case-insensitively so an admin can work from the address they know; `userId`
takes precedence if both are sent.

That single record does two things:

- gives the user a tier (content access) for as long as the grant is in force;
- waives **every service fee** in the app, including itinerary fees, tour
  bookings, and paid membership checkout.

Selecting a paid plan in the app returns **no checkout** and does not write a
`user_subscriptions` row for a waived user. The tier is whatever the admin
granted, so a user cannot self-upgrade by picking a more expensive plan, and
revoking the grant removes the exemption instead of leaving behind a free
paid-tier row that would outlive it. To change a lifetime-free user's tier,
edit the grant.

Because `endDate` is `null`, the exemption never expires. Revoke the grant (or
set an `endDate`) to end it; the row remains as the audit trail.

`waiveServiceFees` is independent of `includePaidPerks` and of `tierCode`:

- A user can be fee-exempt without getting paid ranking perks.
- The waiver is **per user**, not per governing grant. If the user later buys a
  subscription that outranks the comp, or an admin grants a higher tier
  elsewhere, the fee waiver keeps applying. Purchasing must never silently cancel
  an exemption an admin set.
- Revoking or expiring the grant that carries the flag removes the waiver on the
  next resolution. Any other in-force grant with `waiveServiceFees: true` keeps
  it.

Admins control this entirely: there is no self-service path to
`waiveServiceFees`. It is only writable through `POST` / `PATCH
/admin/access-grants` and is recorded in the audit metadata.

---

## The single decision point

All entitlement logic routes through `resolveEffectiveAccess` in
`src/helpers/membership.ts`. Do not read `user_subscriptions` directly to decide
whether someone has access — that is how grant handling drifts apart from the
paywall.

```ts
const access = await getEffectiveAccess(userId);
// {
//   tierCode:         "GOLD_INVESTOR",  // content gating
//   source:           "GRANT",          // SUBSCRIPTION | GRANT | FREE
//   grantId:          "…",              // non-null when source is GRANT
//   includePaidPerks: true,
//   perksTierCode:    "GOLD_INVESTOR",  // ranking; "FREE" when perks don't apply
//   waiveServiceFees: false,            // true for lifetime free accounts
// }
```

The rules it implements:

1. An in-force grant is one that is not revoked, has started, and has not expired.
2. A grant never downgrades someone genuinely paying. When both a grant and an
   active subscription exist, the **higher tier wins**, compared by tier value.
3. A grant with `includePaidPerks: false` sets `perksTierCode: "FREE"` even
   though `tierCode` is the comped tier.
4. Ties go to the subscription, so revoking a same-tier comp changes nothing.
5. When several grants overlap, the highest tier wins; at equal tier a
   **perpetual** grant outranks a time-boxed one, so a "forever" decision is
   never shadowed by a later short grant.
6. `waiveServiceFees` is true when **any** in-force grant sets it, regardless of
   which grant governs the tier. It is cleared only when no in-force grant with
   the flag remains.

Tier ordering (`TIER_VALUE`) is defined once in `src/helpers/membership.ts` and
reused by `resolveTierBoost` in `src/services/matching.service.ts`, so the access
resolver and the matching boost can never disagree about which tier ranks higher.

### Call sites already repointed

| Call site | Uses |
| --- | --- |
| `hasPaidActiveMembership` (`src/helpers/membership.ts`) | `tierCode` — content gating |
| `createPrioritySupportRequest` (`src/services/membership.service.ts:419`) | `perksTierCode` |
| Discovery ranking (`src/services/matching.service.ts`) | `perksTierCode`, resolved in-batch |
| `getUserSubscription` (`src/services/membership.service.ts`) | Surfaces `accessSource`, `accessGrant`, `waiveServiceFees` |
| `hasServiceFeeWaiver` (`src/helpers/membership.ts`) | `waiveServiceFees` — every payment gate |
| `subscribeToPlan` (`src/services/membership.service.ts`) | Returns no checkout and writes no subscription row; the grant remains the entitlement |
| Itinerary fee gate and `initiateItineraryPayment` | Waives the itinerary fee |
| Tour `bookTour` / `initiateTourBookingMoMo` | Waives the tour booking fee |
| Payment initialization (`src/services/payment.service.ts`) | Refuses to create a charge for a waived user |

Discovery resolves access in-batch from the candidate rows it already selects —
a per-candidate lookup would have been an N+1 across the whole candidate pool.

---

## Admin API

All endpoints require `requireAdmin` (any `accountType: ADMIN` account) and a
bearer token, and every mutation writes an `AdminActivityLog` row under the
`SUBSCRIPTION_ACCESS_GRANT` entity type.

### Grant access

```http
POST /admin/access-grants
```

```json
{
  "email": "person@example.com",
  "tierCode": "GOLD_INVESTOR",
  "includePaidPerks": false,
  "waiveServiceFees": false,
  "reason": "Board member — 2026 term",
  "endDate": null
}
```

`reason` is **required** (3–500 chars) — it is the audit trail. Identify the
grantee with `email` or `userId`; email matching is case-insensitive, and
`userId` wins if both are supplied. `tierCode: "FREE"` is rejected: a grant must
confer more than the user already has.
`waiveServiceFees` defaults to `false`; set it to `true` for a lifetime-free
account (and omit `endDate` to make the exemption perpetual).

**201** granted · **400** invalid payload or missing identifier · **404**
unknown user · **409** an in-force grant for the same tier already exists
(keeping "who approved this" singular), or the email matches multiple accounts
(send `userId` instead)

### List grants

```http
GET /admin/access-grants?status=active
```

Filter by `userId`, `email`, `tierCode`, or `status=active|revoked|expired`. `active`
means not revoked, already started, and not past `endDate`. Each row includes
the grantee plus `grantedBy` / `revokedBy`.

### Amend a grant

```http
PATCH /admin/access-grants/{id}
```

Any of `tierCode`, `includePaidPerks`, `waiveServiceFees`, `reason`, `startDate`,
`endDate`. An empty body is rejected — it would be a no-op that still wrote an
"updated" audit entry. Revoked grants cannot be modified (**409**).

### Revoke a grant

```http
POST /admin/access-grants/{id}/revoke
```

```json
{ "reason": "Term ended" }
```

Soft revoke: access is withdrawn immediately, the row is kept. **409** if
already revoked.

### Inspect a user's access

```http
GET /admin/users/{userId}/access
```

Returns the user, their `effectiveAccess` (including which record produced it),
their subscription if any, and their full grant history. This is the endpoint
to reach for when someone claims they should have access you can't account for.

---

## Data model

`SubscriptionAccessGrant` → `subscription_access_grants`

| Field | Notes |
| --- | --- |
| `tierCode` | The comped tier |
| `includePaidPerks` | Default `false` |
| `waiveServiceFees` | Default `false`; exempts the user from all service fees |
| `reason` | Required; audit trail |
| `startDate` / `endDate` | `endDate: null` = perpetual |
| `grantedById` | Required, `onDelete: Restrict` |
| `revokedAt` / `revokedById` | Soft revoke; `SetNull` if the admin is deleted |

`PrioritySupportRequest.subscriptionId` became **nullable**, with a new
`accessGrantId` FK, because a comped user may have no subscription row to point
at. A DB `CHECK` constraint prevents a ticket referencing both.

---

## Verification

`tests/access-grants.test.ts` covers the resolver and validators, including:

- comp survives the user later subscribing for real
- revoking a comp exposes the underlying subscription
- a comp with `includePaidPerks: false` ranks as `FREE` (cannot outrank payers)
- perpetual beats expiring at the same tier
- an expired/cancelled subscription alongside a live comp still gets the comp
- empty patch, `FREE` grant, and inverted date ranges are rejected
- the fee waiver survives a higher-tier grant and a paid subscription
- the fee waiver disappears when its grant is revoked or expires

`tests/lifetime-free-access.test.ts` exercises the gates against the database
with payments enabled: itinerary fee waived, paid plan activated without a
checkout, payment initialization refused, and the exemption dropped on revoke.

## Deployment

Migrations `20261005_add_subscription_access_grants` and
`20261029000003_add_access_grant_service_fee_waiver` are additive and idempotent
(every statement guarded), following the convention set by
`20261004_add_payment_gateway_config` after a non-idempotent `ALTER TABLE`
blocked a deploy here once.

```bash
npx prisma migrate deploy
```

`prisma migrate dev` will refuse to run against a database that has drifted
(unmanaged tables such as `session` from express-session) unless you reset it.
Use `migrate deploy` in environments you cannot afford to reset.
