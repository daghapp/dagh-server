import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../src/config/prisma.js";
import { createPrioritySupportRequest } from "../src/services/membership.service.js";
import { setPaymentControlStatus, _resetPaymentControlCache } from "../src/config/payments.js";
import { _resetFreeModeCache } from "../src/helpers/membership.js";
import { AuthProvider, AccountType, SubscriptionStatus } from "../generated/prisma/client.js";
import { ensurePlans, cleanupPlans } from "./helpers/plans.js";

/**
 * Priority support is reachable in free mode.
 *
 * Regression guard: the function granted the perk (perksTierCode is the top
 * tier) and then immediately threw "Your subscription is not active" because it
 * insisted on a user_subscriptions row for any source other than GRANT.
 * FREE_MODE is a resolution-time grant that deliberately writes no row, so the
 * check denied precisely the users free mode exists to serve — closing the
 * support channel for the whole payment outage it was meant to be used during.
 */
describe("Priority support under free mode", () => {
  const stamp = Date.now();

  let freeUserId: string;
  let payingUserId: string;

  const payload = { subject: "Payment page fails", message: "Checkout will not load for me." };

  async function setPayments(enabled: boolean) {
    await setPaymentControlStatus({ enabled, reason: enabled ? null : "Priority support test" });
    _resetPaymentControlCache();
    _resetFreeModeCache();
  }

  beforeAll(async () => {
    const mkUser = async (label: string) => {
      const user = await prisma.user.create({
        data: {
          email: `priority-support-${label}-${stamp}@example.com`,
          fullName: `Priority Support ${label}`,
          accountType: AccountType.USER,
          authProvider: AuthProvider.EMAIL,
        },
      });
      return user.id;
    };

    await ensurePlans(["BASIC"]);

    freeUserId = await mkUser("free");
    payingUserId = await mkUser("paying");

    const basic = await prisma.membershipPlan.findUniqueOrThrow({ where: { code: "BASIC" } });
    await prisma.userSubscription.create({
      data: {
        userId: payingUserId,
        planId: basic.id,
        tierCode: "BASIC",
        memberCode: `PS${stamp}`,
        startDate: new Date(),
        status: SubscriptionStatus.ACTIVE,
      },
    });
  });

  beforeEach(async () => {
    await setPayments(true);
  });

  afterAll(async () => {
    await prisma.prioritySupportRequest.deleteMany({
      where: { userId: { in: [freeUserId, payingUserId] } },
    });
    await prisma.userSubscription.deleteMany({
      where: { userId: { in: [freeUserId, payingUserId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [freeUserId, payingUserId] } } });
    await prisma.systemSetting.deleteMany({ where: { key: "PAYMENTS_ENABLED" } });
    await cleanupPlans();
  });

  it("refuses a FREE user while payments are enabled", async () => {
    await expect(createPrioritySupportRequest(freeUserId, payload)).rejects.toThrow(
      /only available for paid tier/i,
    );
  });

  it("accepts a FREE user when payments are off, with no subscription row", async () => {
    await setPayments(false);

    const ticket = await createPrioritySupportRequest(freeUserId, payload);

    expect(ticket.id).toBeDefined();
    expect(ticket.userId).toBe(freeUserId);
    // Nothing to attribute to: free mode writes no subscription and no grant, so
    // both FKs stay null rather than the ticket being rejected.
    expect(ticket.subscriptionId).toBeNull();
    expect(ticket.accessGrantId).toBeNull();
  });

  it("still attributes a real payer's ticket to their subscription", async () => {
    const ticket = await createPrioritySupportRequest(payingUserId, payload);

    expect(ticket.subscriptionId).not.toBeNull();
    expect(ticket.accessGrantId).toBeNull();
  });
});
