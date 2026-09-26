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

A grant has two independent effects:

| Effect | Controlled by | Grants |
| --- | --- | --- |
| **Content access** — the paid tier's features and paywalled content | `tierCode` | Always |
| **Ranking perks** — matching boost, priority support | `includePaidPerks` | Only when `true` |

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

Tier ordering (`TIER_VALUE`) is defined once in `src/helpers/membership.ts` and
reused by `resolveTierBoost` in `src/services/matching.service.ts`, so the access
resolver and the matching boost can never disagree about which tier ranks higher.

### Call sites already repointed

| Call site | Uses |
| --- | --- |
| `hasPaidActiveMembership` (`src/helpers/membership.ts`) | `tierCode` — content gating |
| `createPrioritySupportRequest` (`src/services/membership.service.ts:419`) | `perksTierCode` |
| Discovery ranking (`src/services/matching.service.ts`) | `perksTierCode`, resolved in-batch |
| `getUserSubscription` (`src/services/membership.service.ts:376`) | Surfaces `accessSource` / `accessGrant` |

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
  "userId": "user-uuid",
  "tierCode": "GOLD_INVESTOR",
  "includePaidPerks": false,
  "reason": "Board member — 2026 term",
  "endDate": null
}
```

`reason` is **required** (3–500 chars) — it is the audit trail. `tierCode: "FREE"`
is rejected: a grant must confer more than the user already has.

**201** granted · **400** invalid payload · **404** unknown user ·
**409** an in-force grant for the same tier already exists (keeping "who
approved this" singular)

### List grants

```http
GET /admin/access-grants?status=active
```

Filter by `userId`, `tierCode`, or `status=active|revoked|expired`. `active`
means not revoked, already started, and not past `endDate`. Each row includes
the grantee plus `grantedBy` / `revokedBy`.

### Amend a grant

```http
PATCH /admin/access-grants/{id}
```

Any of `tierCode`, `includePaidPerks`, `reason`, `startDate`, `endDate`. An empty
body is rejected — it would be a no-op that still wrote an "updated" audit entry.
Revoked grants cannot be modified (**409**).

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
| `reason` | Required; audit trail |
| `startDate` / `endDate` | `endDate: null` = perpetual |
| `grantedById` | Required, `onDelete: Restrict` |
| `revokedAt` / `revokedById` | Soft revoke; `SetNull` if the admin is deleted |

`PrioritySupportRequest.subscriptionId` became **nullable**, with a new
`accessGrantId` FK, because a comped user may have no subscription row to point
at. A DB `CHECK` constraint prevents a ticket referencing both.

---

## Verification

`tests/access-grants.test.ts` — 44 tests covering the resolver and validators,
including the cases that motivated the design:

- comp survives the user later subscribing for real
- revoking a comp exposes the underlying subscription
- a comp with `includePaidPerks: false` ranks as `FREE` (cannot outrank payers)
- perpetual beats expiring at the same tier
- an expired/cancelled subscription alongside a live comp still gets the comp
- empty patch, `FREE` grant, and inverted date ranges are rejected

## Deployment

Migration `20261005_add_subscription_access_grants` is additive and idempotent
(every statement guarded), following the convention set by
`20261004_add_payment_gateway_config` after a non-idempotent `ALTER TABLE`
blocked a deploy here once.

```bash
npx prisma migrate deploy
```

`prisma migrate dev` will refuse to run against a database that has drifted
(unmanaged tables such as `session` from express-session) unless you reset it.
Use `migrate deploy` in environments you cannot afford to reset.
