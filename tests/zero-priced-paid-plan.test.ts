import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma.js";
import { subscribeToPlan } from "../src/services/membership.service.js";
import { createMembershipPlanSchema } from "../src/validator/membership-validator.js";
import { AuthProvider, AccountType } from "../generated/prisma/client.js";
import { ensurePlans } from "./helpers/plans.js";

/**
 * A paid membership tier priced at 0 is a revenue leak, not a free plan.
 *
 * `subscribeToPlan` used to branch on `price === 0` alone, so any zero-priced
 * tier — FAMILY_PLAN was seeded that way — activated with no payment at all, with
 * payments fully enabled. Because planId is a public UUID from the unauthenticated
 * GET /membership/plans, that made a real tier self-service.
 */
describe("Zero-priced paid plans cannot be self-service", () => {
  const stamp = Date.now();
  const PLAN_NAME = `ZP${stamp}`;

  let userId: string;
  let zeroPricedPlanId: string;
  /** The row's real field values, so a seeded database is left untouched. */
  let original: { price: number; isActive: boolean } | null = null;

  const payload = (planId: string) => ({
    planId,
    returnUrl: "https://example.com/return",
    callbackUrl: "https://api.example.com/membership/payment-callback",
  });

  beforeAll(async () => {
    await ensurePlans(["FREE"]);

    const user = await prisma.user.create({
      data: {
        email: `zero-priced-plan-${stamp}@example.com`,
        fullName: "Zero Priced Plan",
        accountType: AccountType.USER,
        authProvider: AuthProvider.EMAIL,
      },
    });
    userId = user.id;

    // `code` is unique and a seeded database already carries FAMILY_PLAN, so
    // borrow that row rather than colliding with it: zero its price for the test
    // and put the real values back in afterAll.
    const plan = await prisma.membershipPlan.findUnique({ where: { code: "FAMILY_PLAN" } });
    if (plan) {
      original = { price: plan.price, isActive: plan.isActive };
      zeroPricedPlanId = plan.id;
    } else {
      const created = await prisma.membershipPlan.create({
        data: {
          code: "FAMILY_PLAN",
          name: PLAN_NAME,
          price: 0,
          interval: "CUSTOM",
          features: [],
          isActive: true,
        },
      });
      zeroPricedPlanId = created.id;
    }

    await prisma.membershipPlan.update({
      where: { id: zeroPricedPlanId },
      data: { price: 0, isActive: true },
    });
  });

  afterAll(async () => {
    await prisma.userSubscription.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });

    if (original) {
      await prisma.membershipPlan.update({ where: { id: zeroPricedPlanId }, data: original });
    } else {
      await prisma.membershipPlan.deleteMany({ where: { name: PLAN_NAME } });
    }
  });

  it("refuses to activate a zero-priced paid tier without payment", async () => {
    const result = await subscribeToPlan(userId, payload(zeroPricedPlanId));

    expect(result.success).toBe(false);
    expect(result.code).toBe("PLAN_NOT_PURCHASABLE");

    // The important half: no subscription row was written.
    const subscription = await prisma.userSubscription.findUnique({ where: { userId } });
    expect(subscription).toBeNull();
  });

  it("still activates the genuine FREE tier without payment", async () => {
    const freePlan = await prisma.membershipPlan.findUniqueOrThrow({ where: { code: "FREE" } });

    const result = await subscribeToPlan(userId, payload(freePlan.id));

    expect(result.success).toBe(true);

    const subscription = await prisma.userSubscription.findUniqueOrThrow({ where: { userId } });
    expect(subscription.status).toBe("ACTIVE");
    expect(subscription.tierCode).toBe("FREE");
  });

  describe("admin plan schema", () => {
    const base = {
      name: "Family Plan",
      currency: "GHS",
      interval: "CUSTOM",
      features: [],
      isMostPopular: false,
      isActive: true,
    };

    it("rejects a paid tier priced at 0", () => {
      const result = createMembershipPlanSchema.safeParse({
        ...base,
        code: "FAMILY_PLAN",
        price: 0,
      });
      expect(result.success).toBe(false);
    });

    it("accepts the FREE plan priced at 0", () => {
      const result = createMembershipPlanSchema.safeParse({ ...base, code: "FREE", price: 0 });
      expect(result.success).toBe(true);
    });

    it("accepts a paid tier priced above 0", () => {
      const result = createMembershipPlanSchema.safeParse({
        ...base,
        code: "FAMILY_PLAN",
        price: 350,
      });
      expect(result.success).toBe(true);
    });
  });
});
