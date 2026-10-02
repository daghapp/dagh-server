import { describe, expect, it, beforeEach, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma.js";
import {
  applyFreeMode,
  getEffectiveAccess,
  getFreeModeTierCode,
  hasPaidActiveMembership,
  getPerksTierCode,
  _resetFreeModeCache,
  type EffectiveAccess,
} from "../src/helpers/membership.js";
import {
  setPaymentControlStatus,
  isPaymentsEnabled,
  _resetPaymentControlCache,
} from "../src/config/payments.js";
import { AuthProvider, AccountType, SubscriptionStatus } from "../generated/prisma/client.js";
import { ensurePlans, cleanupPlans } from "./helpers/plans.js";

/**
 * Free mode: with payments switched off, nobody can buy a paid tier, so the
 * highest active paid plan is granted to everyone until payments come back on.
 */
describe("Free mode (payments disabled ⇒ paid features are free)", () => {
  const stamp = Date.now();

  /** Users with no entitlement, to prove free mode is what unlocks them. */
  let freeUserId: string;
  /** A genuine paying member, to prove free mode never downgrades them. */
  let payingUserId: string;
  let basicPlanId: string;

  /** Highest-priced plan the resolver should land on. */
  const TOP_PLAN_CODE = "ELITE_AMBASSADOR";

  async function setPayments(enabled: boolean) {
    await setPaymentControlStatus({ enabled, reason: enabled ? null : "Free mode test" });
    _resetPaymentControlCache();
    _resetFreeModeCache();
  }

  beforeAll(async () => {
    // CI migrates a fresh database and never seeds, and the migrations do not
    // insert membership_plans. Without this the whole suite threw in beforeAll
    // and was reported as 15 *skipped* rather than passing.
    await ensurePlans();

    const mkUser = async (label: string) => {
      const user = await prisma.user.create({
        data: {
          email: `free-mode-${label}-${stamp}@example.com`,
          fullName: `Free Mode ${label}`,
          accountType: AccountType.USER,
          authProvider: AuthProvider.EMAIL,
        },
      });
      return user.id;
    };

    freeUserId = await mkUser("free");
    payingUserId = await mkUser("paying");

    const basic = await prisma.membershipPlan.findUnique({ where: { code: "BASIC" } });
    expect(basic).not.toBeNull();
    basicPlanId = basic!.id;

    await prisma.userSubscription.create({
      data: {
        userId: payingUserId,
        planId: basicPlanId,
        tierCode: "BASIC",
        memberCode: `FM${stamp}`,
        startDate: new Date(),
        status: SubscriptionStatus.ACTIVE,
      },
    });
  });

  beforeEach(async () => {
    _resetPaymentControlCache();
    _resetFreeModeCache();
    await setPayments(true);
  });

  afterAll(async () => {
    await prisma.userSubscription.deleteMany({
      where: { userId: { in: [freeUserId, payingUserId] } },
    });
    // Any plans this file created, identified by the stamp in their name.
    await prisma.membershipPlan.deleteMany({ where: { name: { contains: `FM${stamp}` } } });
    await prisma.user.deleteMany({ where: { id: { in: [freeUserId, payingUserId] } } });
    await prisma.systemSetting.deleteMany({ where: { key: "PAYMENTS_ENABLED" } });
    await cleanupPlans();
    await prisma.adminActivityLog.deleteMany({
      where: { actorId: { in: [freeUserId, payingUserId] } },
    });
  });

  // ─────────────────────────────────────────
  // applyFreeMode — pure rule, no database
  // ─────────────────────────────────────────
  describe("applyFreeMode", () => {
    const access = (over: Partial<EffectiveAccess> = {}): EffectiveAccess => ({
      tierCode: "FREE",
      source: "FREE",
      grantId: null,
      includePaidPerks: false,
      perksTierCode: "FREE",
      ...over,
    });

    it("leaves access untouched when free mode is off (null tier)", () => {
      const before = access({ tierCode: "BASIC", source: "SUBSCRIPTION", perksTierCode: "BASIC" });
      expect(applyFreeMode(before, null)).toEqual(before);
    });

    it("lifts a FREE user to the free-mode tier with paid perks", () => {
      const result = applyFreeMode(access(), TOP_PLAN_CODE);
      expect(result.tierCode).toBe(TOP_PLAN_CODE);
      expect(result.source).toBe("FREE_MODE");
      expect(result.grantId).toBeNull();
      expect(result.includePaidPerks).toBe(true);
      expect(result.perksTierCode).toBe(TOP_PLAN_CODE);
    });

    it("never downgrades an entitlement that already ranks higher", () => {
      // Ceiling sits below the comp, so the comp already outranks free mode.
      const comp = access({
        tierCode: "ELITE_AMBASSADOR",
        source: "GRANT",
        grantId: "grant-1",
        includePaidPerks: true,
        perksTierCode: "ELITE_AMBASSADOR",
      });
      const result = applyFreeMode(comp, "GOLD_INVESTOR");
      expect(result.source).toBe("GRANT");
      expect(result.grantId).toBe("grant-1");
      expect(result.tierCode).toBe("ELITE_AMBASSADOR");
    });

    it("preserves a comp's includePaidPerks=false when it outranks the free tier", () => {
      // A comp above the free-mode ceiling but without paid perks must keep
      // ranking as FREE: free mode only grants, it never overrides a decision an
      // admin already made about ranking privilege.
      const comp = access({
        tierCode: "ELITE_AMBASSADOR",
        source: "GRANT",
        grantId: "grant-2",
        includePaidPerks: false,
        perksTierCode: "FREE",
      });
      const result = applyFreeMode(comp, "SILVER");
      expect(result.perksTierCode).toBe("FREE");
      expect(result.includePaidPerks).toBe(false);
      expect(result.source).toBe("GRANT");
    });

    it("is a no-op at equal tier, so a real payer keeps their own source", () => {
      const sub = access({
        tierCode: TOP_PLAN_CODE,
        source: "SUBSCRIPTION",
        includePaidPerks: true,
        perksTierCode: TOP_PLAN_CODE,
      });
      const result = applyFreeMode(sub, TOP_PLAN_CODE);
      expect(result.source).toBe("SUBSCRIPTION");
    });
  });

  // ─────────────────────────────────────────
  // getFreeModeTierCode — which tier is granted
  // ─────────────────────────────────────────
  describe("getFreeModeTierCode", () => {
    it("grants nothing while payments are enabled", async () => {
      expect(await getFreeModeTierCode()).toBeNull();
    });

    it("grants the highest-priced active paid plan while payments are disabled", async () => {
      await setPayments(false);
      expect(await getFreeModeTierCode()).toBe(TOP_PLAN_CODE);
    });

    // These deliberately do NOT call _resetFreeModeCache(). Nothing in production
    // resets it, so a toggle has to invalidate the cached tier on its own — the
    // cache is keyed on the payment state it was resolved under.
    it("engages on the same read that sees the kill switch", async () => {
      await getFreeModeTierCode(); // warm the cache while payments are enabled

      await setPaymentControlStatus({ enabled: false, reason: "Cache coherence test" });

      // The kill switch is synchronous with the write, so if free mode is still
      // null here the app is refusing checkout while granting nothing — the
      // exact outage state free mode exists to prevent.
      expect(await isPaymentsEnabled()).toBe(false);
      expect(await getFreeModeTierCode()).toBe(TOP_PLAN_CODE);
    });

    it("drops the grant on the same read that clears the kill switch", async () => {
      await setPaymentControlStatus({ enabled: false, reason: "Cache coherence test" });
      expect(await getFreeModeTierCode()).toBe(TOP_PLAN_CODE);

      await setPaymentControlStatus({ enabled: true });

      expect(await isPaymentsEnabled()).toBe(true);
      expect(await getFreeModeTierCode()).toBeNull();
    });

    it("ignores a deactivated plan even when it is the most expensive", async () => {
      // Deactivating the top plan must degrade the grant rather than keep
      // handing out a tier that is no longer for sale.
      const elite = await prisma.membershipPlan.findUniqueOrThrow({
        where: { code: TOP_PLAN_CODE },
      });

      await prisma.membershipPlan.update({
        where: { id: elite.id },
        data: { isActive: false },
      });

      try {
        await setPayments(false);
        const tier = await getFreeModeTierCode();
        expect(tier).not.toBe(TOP_PLAN_CODE);
        expect(tier).toBe("GOLD_INVESTOR");
      } finally {
        await prisma.membershipPlan.update({
          where: { id: elite.id },
          data: { isActive: true },
        });
      }
    });

    it("ignores zero-priced plans so a comped FREE plan cannot become the grant", async () => {
      const original = await prisma.membershipPlan.findUniqueOrThrow({
        where: { id: basicPlanId },
      });

      await prisma.membershipPlan.update({
        where: { id: basicPlanId },
        data: { price: 0 },
      });

      try {
        await setPayments(false);
        // BASIC is now free, so the paid ceiling is unchanged.
        expect(await getFreeModeTierCode()).toBe(TOP_PLAN_CODE);
      } finally {
        await prisma.membershipPlan.update({
          where: { id: basicPlanId },
          data: { price: original.price },
        });
      }
    });

    it("excludes the FREE code even if it were ever priced above zero", async () => {
      const freePlan = await prisma.membershipPlan.findUnique({ where: { code: "FREE" } });
      if (!freePlan) return; // FREE plan absent in this environment; nothing to prove.

      const original = freePlan.price;
      await prisma.membershipPlan.update({
        where: { id: freePlan.id },
        data: { price: 5_000_000 },
      });

      try {
        await setPayments(false);
        // A mispriced FREE row must not hand the whole app a "FREE" grant that
        // unlocks nothing, and must not become the ceiling either.
        expect(await getFreeModeTierCode()).toBe(TOP_PLAN_CODE);
      } finally {
        await prisma.membershipPlan.update({
          where: { id: freePlan.id },
          data: { price: original },
        });
      }
    });
  });

  // ─────────────────────────────────────────
  // getEffectiveAccess — the user-visible outcome
  // ─────────────────────────────────────────
  describe("getEffectiveAccess", () => {
    it("keeps an unentitled user on FREE while payments are enabled", async () => {
      const access = await getEffectiveAccess(freeUserId);
      expect(access.tierCode).toBe("FREE");
      expect(access.source).toBe("FREE");
      expect(access.perksTierCode).toBe("FREE");
      expect(await hasPaidActiveMembership(freeUserId)).toBe(false);
    });

    it("grants a paying-equivalent entitlement to a FREE user when payments are off", async () => {
      await setPayments(false);

      const access = await getEffectiveAccess(freeUserId);
      expect(access.tierCode).toBe(TOP_PLAN_CODE);
      expect(access.source).toBe("FREE_MODE");
      expect(access.grantId).toBeNull();
      // Full perks, so discovery ranking and priority support open too.
      expect(access.includePaidPerks).toBe(true);
      expect(access.perksTierCode).toBe(TOP_PLAN_CODE);

      expect(await hasPaidActiveMembership(freeUserId)).toBe(true);
      expect(await getPerksTierCode(freeUserId)).toBe(TOP_PLAN_CODE);
    });

    it("reverts the grant the moment payments come back on", async () => {
      await setPayments(false);
      expect((await getEffectiveAccess(freeUserId)).tierCode).toBe(TOP_PLAN_CODE);

      await setPayments(true);
      const access = await getEffectiveAccess(freeUserId);
      expect(access.tierCode).toBe("FREE");
      expect(access.source).toBe("FREE");
      expect(await hasPaidActiveMembership(freeUserId)).toBe(false);
    });

    it("lifts an existing subscriber to the free tier without rewriting their row", async () => {
      // Free mode is a resolution-time grant, not a migration: nobody's
      // subscription row is touched, so lifting a payer is safe and reversible.
      await setPayments(false);

      const during = await getEffectiveAccess(payingUserId);
      expect(during.tierCode).toBe(TOP_PLAN_CODE);
      expect(during.source).toBe("FREE_MODE");

      const row = await prisma.userSubscription.findUniqueOrThrow({
        where: { userId: payingUserId },
      });
      expect(row.tierCode).toBe("BASIC");
      expect(row.status).toBe(SubscriptionStatus.ACTIVE);

      await setPayments(true);
      const after = await getEffectiveAccess(payingUserId);
      expect(after.tierCode).toBe("BASIC");
      expect(after.source).toBe("SUBSCRIPTION");
      expect(after.perksTierCode).toBe("BASIC");
    });

    it("falls back to the next tier down while the top plan is deactivated", async () => {
      const elite = await prisma.membershipPlan.findUniqueOrThrow({
        where: { code: TOP_PLAN_CODE },
      });

      await prisma.membershipPlan.update({
        where: { id: elite.id },
        data: { isActive: false },
      });

      try {
        await setPayments(false);
        const access = await getEffectiveAccess(freeUserId);
        expect(access.tierCode).toBe("GOLD_INVESTOR");
        expect(access.source).toBe("FREE_MODE");
      } finally {
        await prisma.membershipPlan.update({
          where: { id: elite.id },
          data: { isActive: true },
        });
      }
    });
  });
});
