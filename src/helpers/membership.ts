import { prisma } from "../config/prisma.js";
// Imported directly rather than through the config barrel: the barrel re-exports
// ./payments, which pulls in the payment gateway service, and going through it
// risks an import cycle on the access-resolver path.
import { isPaymentsEnabled } from "../config/payments.js";
import { SubscriptionStatus } from "../../generated/prisma/client.js";

/**
 * Canonical tier-value ordering.
 *
 * Lives here (rather than in matching.service) so the access resolver and the
 * matching boost read from one source of truth — a grant must never be able to
 * rank someone above a paying member by disagreeing with the boost table.
 *
 * Note this is not a single ladder: SENIOR_PIONEER (1.15) and SILVER (1.25) are
 * not comparable by product intent, so ordering is by boost value, which is the
 * app's existing notion of "how much does this tier count".
 */
export const TIER_VALUE: Record<string, number> = {
  FREE: 1.0,
  BASELINE: 1.1,
  SENIOR_PIONEER: 1.15,
  SANKOFA_SETTLED: 1.2,
  BASIC: 1.15,
  SILVER: 1.25,
  GOLD_INVESTOR: 1.3,
  ELITE_AMBASSADOR: 1.4,
  FAMILY_PLAN: 1.2,
};

export function tierValue(tierCode: string | null | undefined): number {
  if (!tierCode) return TIER_VALUE.FREE;
  return TIER_VALUE[tierCode] ?? TIER_VALUE.FREE;
}

export type AccessSource = "SUBSCRIPTION" | "GRANT" | "FREE" | "FREE_MODE";

export interface EffectiveAccess {
  /** Tier the user is entitled to. Drives content/paywall gating. */
  tierCode: string;
  /** Which record produced the entitlement — surfaced in the admin UI. */
  source: AccessSource;
  /** The governing grant, when source is GRANT. */
  grantId: string | null;
  /**
   * Whether paid-tier perks (matching boost, priority support) apply. A grant
   * with includePaidPerks=false grants access to the tier's content but leaves
   * the user at FREE rank, so comped users never outrank paying members.
   */
  includePaidPerks: boolean;
  /** Tier to use for boost/priority-support. "FREE" when perks don't apply. */
  perksTierCode: string;
}

/** Minimal shape needed from a grant row; keeps the resolver testable. */
export interface GrantLike {
  id: string;
  tierCode: string;
  includePaidPerks: boolean;
  startDate: Date;
  endDate: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** Minimal shape needed from a subscription row. */
export interface SubscriptionLike {
  tierCode: string;
  status: string;
  endDate: Date | null;
}

const ACTIVE = SubscriptionStatus.ACTIVE;

/**
 * A grant is in force when it has not been revoked, has started, and has not
 * run out. Grants never auto-renew: they expire at endDate or run forever.
 */
export function isGrantInForce(grant: GrantLike, now: Date): boolean {
  if (grant.revokedAt) return false;
  if (grant.startDate > now) return false;
  if (grant.endDate && grant.endDate <= now) return false;
  return true;
}

/**
 * Picks the grant that should govern access: the highest-tier in-force grant,
 * breaking ties toward the perpetual one and then the most recently created.
 */
export function selectGoverningGrant<T extends GrantLike>(grants: T[], now: Date): T | null {
  const inForce = grants.filter((g) => isGrantInForce(g, now));
  if (inForce.length === 0) return null;

  return inForce.reduce((best, candidate) => {
    const diff = tierValue(candidate.tierCode) - tierValue(best.tierCode);
    if (diff > 0) return candidate;
    if (diff < 0) return best;

    // Same tier: a perpetual grant outranks a time-boxed one, so a
    // "perpetual" admin decision is never silently shadowed by a shorter
    // overlapping grant.
    const bestPerpetual = !best.endDate;
    const candidatePerpetual = !candidate.endDate;
    if (candidatePerpetual && !bestPerpetual) return candidate;
    if (!candidatePerpetual && bestPerpetual) return best;

    return candidate.createdAt > best.createdAt ? candidate : best;
  });
}

/**
 * Single decision point for "what can this user access, and why".
 *
 * A grant and a paid subscription coexist rather than overwrite each other, and
 * a grant can never downgrade someone who is genuinely paying: the higher of
 * the two wins, compared by tier value.
 */
export function resolveEffectiveAccess(input: {
  subscription: SubscriptionLike | null | undefined;
  grants: GrantLike[];
  now?: Date;
}): EffectiveAccess {
  const now = input.now ?? new Date();

  const sub = input.subscription;
  const subIsPaid =
    !!sub &&
    sub.tierCode !== "FREE" &&
    sub.status === ACTIVE &&
    (!sub.endDate || sub.endDate >= now);

  const grant = selectGoverningGrant(input.grants, now);

  if (subIsPaid && grant) {
    // Both in force — keep the stronger entitlement, and only inherit the
    // grant's perks setting if the grant is what actually won.
    const subWins = tierValue(sub!.tierCode) >= tierValue(grant.tierCode);
    const tierCode = subWins ? sub!.tierCode : grant.tierCode;
    const includePaidPerks = subWins ? true : grant.includePaidPerks;
    return {
      tierCode,
      source: subWins ? "SUBSCRIPTION" : "GRANT",
      grantId: subWins ? null : grant.id,
      includePaidPerks,
      perksTierCode: includePaidPerks ? tierCode : "FREE",
    };
  }

  if (grant) {
    return {
      tierCode: grant.tierCode,
      source: "GRANT",
      grantId: grant.id,
      includePaidPerks: grant.includePaidPerks,
      perksTierCode: grant.includePaidPerks ? grant.tierCode : "FREE",
    };
  }

  if (subIsPaid) {
    return {
      tierCode: sub!.tierCode,
      source: "SUBSCRIPTION",
      grantId: null,
      includePaidPerks: true,
      perksTierCode: sub!.tierCode,
    };
  }

  return {
    tierCode: "FREE",
    source: "FREE",
    grantId: null,
    includePaidPerks: false,
    perksTierCode: "FREE",
  };
}

// ─────────────────────────────────────────
// Free mode
// ─────────────────────────────────────────
// When the payment system is switched off, no one can pay — so the paid tier
// stops being a thing anyone can acquire, and requiring one would lock the
// whole app behind a checkout that cannot be completed. Free mode makes the
// highest active paid plan available to everyone for the duration.
//
// It is deliberately automatic and derived from the payment switch rather than
// being a second control: the failure this guards against is an admin pulling
// the payment kill switch during a provider incident and finding a dead paywall
// behind it. The cost of that choice is that free mode cannot be separated from
// an outage — see docs/disabling-payments.md.

/** Short cache: the tier is read on access resolution, and plan edits should show up promptly. */
let freeModeCache: { tierCode: string | null; cachedAt: number } | null = null;
const FREE_MODE_CACHE_TTL_MS = 10_000;

/**
 * The tier free mode grants, or null when payments are enabled.
 *
 * Resolved as the most expensive *active paid* plan, so a deactivating the
 * top plan during an outage degrades the grant rather than silently keeping
 * everyone at a tier that is no longer for sale.
 */
export async function getFreeModeTierCode(): Promise<string | null> {
  const now = Date.now();
  if (freeModeCache && now - freeModeCache.cachedAt < FREE_MODE_CACHE_TTL_MS) {
    return freeModeCache.tierCode;
  }

  let tierCode: string | null = null;

  try {
    if (!(await isPaymentsEnabled())) {
      const plan = await prisma.membershipPlan.findFirst({
        where: { isActive: true, price: { gt: 0 }, code: { not: "FREE" } },
        orderBy: { price: "desc" },
        select: { code: true },
      });
      tierCode = plan?.code ?? null;
    }
  } catch (error) {
    // Free mode must never be the reason somebody loses access. If the lookup
    // fails, resolve their real entitlement rather than guessing.
    console.error("[FREE_MODE] failed to resolve free-mode tier, using real access:", error);
    return null;
  }

  freeModeCache = { tierCode, cachedAt: now };
  return tierCode;
}

/**
 * Applies the free-mode grant on top of a resolved entitlement.
 *
 * Pure so the in-batch discovery path can apply it without a per-candidate
 * lookup, and so the rule is testable without a database.
 *
 * Free mode only ever adds access. Someone whose own entitlement already ranks
 * above the free tier — a comp to a tier above the top active plan — keeps
 * exactly what they had, including the perks setting on their grant.
 */
export function applyFreeMode(access: EffectiveAccess, freeModeTier: string | null): EffectiveAccess {
  if (!freeModeTier) return access;
  if (tierValue(freeModeTier) <= tierValue(access.tierCode)) return access;

  return {
    tierCode: freeModeTier,
    source: "FREE_MODE",
    grantId: null,
    // Free mode grants the tier in full, paid perks included, so discovery
    // ranking and priority support are open too. It is the same promise as the
    // tier itself: nobody can buy the perk, so nobody is held to it.
    includePaidPerks: true,
    perksTierCode: freeModeTier,
  };
}

/**
 * Loads the user's subscription and in-force grants, then resolves. This is the
 * function feature code should call instead of reading user_subscriptions
 * directly, so grant handling stays in one place.
 */
export async function getEffectiveAccess(userId: string): Promise<EffectiveAccess> {
  const now = new Date();

  const [subscription, grants, freeModeTier] = await Promise.all([
    prisma.userSubscription.findUnique({
      where: { userId },
      select: { tierCode: true, status: true, endDate: true },
    }),
    prisma.subscriptionAccessGrant.findMany({
      where: { userId },
      select: {
        id: true,
        tierCode: true,
        includePaidPerks: true,
        startDate: true,
        endDate: true,
        revokedAt: true,
        createdAt: true,
      },
    }),
    getFreeModeTierCode(),
  ]);

  return applyFreeMode(
    resolveEffectiveAccess({
      subscription: subscription
        ? {
            tierCode: subscription.tierCode,
            status: subscription.status,
            endDate: subscription.endDate,
          }
        : null,
      grants,
      now,
    }),
    freeModeTier,
  );
}

/**
 * True when the user is entitled to paid content, whether by paying or by an
 * admin comp. Replaces the previous subscription-only check.
 */
export const hasPaidActiveMembership = async (userId: string): Promise<boolean> => {
  const access = await getEffectiveAccess(userId);
  return access.tierCode !== "FREE";
};

/**
 * Tier to use for paid perks (matching boost, priority support). Comped users
 * whose grant has includePaidPerks=false resolve to FREE here, so a comp waives
 * the fee without conferring ranking privilege.
 */
export async function getPerksTierCode(userId: string): Promise<string> {
  const access = await getEffectiveAccess(userId);
  return access.perksTierCode;
}

/**
 * Test-only reset of the free-mode tier cache. Clear this alongside
 * `_resetPaymentControlCache()` after changing payment state, or the resolver
 * will keep serving the previous answer for up to the cache TTL.
 */
export function _resetFreeModeCache(): void {
  freeModeCache = null;
}
