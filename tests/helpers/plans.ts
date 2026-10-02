import { prisma } from "../../src/config/prisma.js";
import type { BillingInterval, MembershipTierCode } from "../../generated/prisma/client.js";

/**
 * Ensures a membership plan exists, creating it only if the database lacks it.
 *
 * CI provisions a fresh database with `prisma migrate deploy` and never runs
 * `db:seed`, and the migrations do not insert membership_plans — so every plan
 * row is something the local/seeded database happens to have. A test that reads
 * a plan therefore fails on CI for reasons that have nothing to do with the code
 * under test (this is why tests/free-mode.test.ts was skipped, not passed, on
 * every push to main).
 *
 * Provisioning here keeps each test self-sufficient instead of inheriting that.
 * Prices matter and are not arbitrary: free mode grants the *most expensive*
 * active paid plan, so the ordering below is what ELITE_AMBASSADOR-beats-all and
 * the GOLD_INVESTOR-fallback assertions depend on.
 */

export const PLAN_FIXTURES: Record<
  string,
  { code: MembershipTierCode; name: string; price: number; interval: BillingInterval }
> = {
  FREE: { code: "FREE", name: "Free", price: 0, interval: "MONTHLY" },
  BASIC: { code: "BASIC", name: "Basic", price: 50, interval: "MONTHLY" },
  GOLD_INVESTOR: { code: "GOLD_INVESTOR", name: "Gold Investor", price: 200, interval: "MONTHLY" },
  ELITE_AMBASSADOR: {
    code: "ELITE_AMBASSADOR",
    name: "Elite Ambassador",
    price: 500,
    interval: "MONTHLY",
  },
};

/** Codes this helper had to create, so a suite can clean up only its own rows. */
const created: MembershipTierCode[] = [];

export async function ensurePlans(
  codes: string[] = Object.keys(PLAN_FIXTURES),
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};

  for (const key of codes) {
    const fixture = PLAN_FIXTURES[key];
    if (!fixture) throw new Error(`No plan fixture for "${key}"`);

    const existing = await prisma.membershipPlan.findUnique({
      where: { code: fixture.code },
      select: { id: true },
    });

    if (existing) {
      ids[key] = existing.id;
      continue;
    }

    const plan = await prisma.membershipPlan.create({
      data: {
        code: fixture.code,
        name: fixture.name,
        price: fixture.price,
        interval: fixture.interval,
        features: [],
      },
    });
    ids[key] = plan.id;
    created.push(fixture.code);
  }

  return ids;
}

/** Removes only plans this helper created, leaving a seeded database untouched. */
export async function cleanupPlans(): Promise<void> {
  if (created.length === 0) return;
  await prisma.membershipPlan.deleteMany({ where: { code: { in: created } } });
  created.length = 0;
}
