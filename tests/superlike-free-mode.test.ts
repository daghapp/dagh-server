import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { prisma } from "../src/config/prisma.js";
import { recordSwipe } from "../src/modules/dating/swipe.controller.js";
import { setPaymentControlStatus, _resetPaymentControlCache } from "../src/config/payments.js";
import { _resetFreeModeCache } from "../src/helpers/membership.js";
import { AuthProvider, AccountType } from "../generated/prisma/client.js";
import { ensurePlans, cleanupPlans } from "./helpers/plans.js";

/**
 * Super-like daily limits follow the effective tier, not the subscription row.
 *
 * Regression guard: this limit used to be computed from
 * `user.subscription.tierCode` read directly, which silently pinned both a
 * comped user and every user in free mode to the FREE limit of 1/day — the
 * whole point of free mode being to open the app up during a payment outage.
 * The correct source is `access.perksTierCode`, since a comp granted with
 * includePaidPerks=false waives the fee without conferring quota perks.
 */
describe("Super-like daily limit under free mode", () => {
  const stamp = Date.now();

  let swiperId: string;
  const targetIds: string[] = [];

  async function setPayments(enabled: boolean) {
    await setPaymentControlStatus({
      enabled,
      reason: enabled ? null : "Super-like free-mode test",
    });
    _resetPaymentControlCache();
    _resetFreeModeCache();
  }

  function superLike(targetId: string) {
    // Declared params so the mocks' call tuples stay typed for assertions below.
    const json = vi.fn((_body: unknown) => undefined);
    const status = vi.fn((_code: number) => ({ json }));
    const req = { user: { id: swiperId }, body: { targetId, direction: "SUPER_LIKE" } };
    return {
      run: () => recordSwipe(req as unknown as Request, { json, status } as unknown as Response),
      json,
      status,
    };
  }

  /** The 429 details carry the limit, so this reads it back directly. */
  function limitFrom(call: ReturnType<typeof superLike>): number | undefined {
    if (!call.status.mock.calls.some(([code]) => code === 429)) return undefined;
    const body = call.json.mock.calls.at(-1)?.[0] as { details?: { limit?: number } } | undefined;
    return body?.details?.limit;
  }

  beforeAll(async () => {
    // Free mode grants the most expensive active paid plan, so ELITE_AMBASSADOR
    // must exist for the FREE-limit-vs-top-tier assertion to mean anything.
    await ensurePlans(["FREE", "BASIC", "GOLD_INVESTOR", "ELITE_AMBASSADOR"]);

    const mkUser = async (label: string, gender: "MALE" | "FEMALE") => {
      const user = await prisma.user.create({
        data: {
          email: `superlike-${label}-${stamp}@example.com`,
          fullName: `Super Like ${label}`,
          accountType: AccountType.USER,
          authProvider: AuthProvider.EMAIL,
          gender,
        },
      });
      return user.id;
    };

    swiperId = await mkUser("swiper", "MALE");
    await prisma.userProfile.create({
      data: {
        userId: swiperId,
        profileVerification: {
          create: {
            phone_number_verified: true,
            bio_profile_verification: true,
            document_verification: true,
            faceStatus: "APPROVED",
            documentStatus: "APPROVED",
            isVerified: true,
          },
        },
      },
    });
    for (let i = 0; i < 2; i++) {
      const id = await mkUser(`target${i}`, "FEMALE");
      await prisma.datingProfile.create({ data: { userId: id, photos: [], interests: [] } });
      targetIds.push(id);
    }
  });

  beforeEach(async () => {
    await prisma.userSwipe.deleteMany({ where: { swiperId } });
    await setPayments(true);
  });

  afterAll(async () => {
    await prisma.userSwipe.deleteMany({ where: { swiperId } });
    await prisma.datingProfile.deleteMany({ where: { userId: { in: targetIds } } });
    await prisma.profileVerification.deleteMany({ where: { userProfile: { userId: swiperId } } });
    await prisma.userProfile.deleteMany({ where: { userId: swiperId } });
    await prisma.user.deleteMany({ where: { id: { in: [swiperId, ...targetIds] } } });
    await prisma.systemSetting.deleteMany({ where: { key: "PAYMENTS_ENABLED" } });
    await cleanupPlans();
  });

  it("caps an unentitled user at the FREE limit while payments are enabled", async () => {
    await superLike(targetIds[0]).run();

    const second = superLike(targetIds[1]);
    await second.run();

    expect(limitFrom(second)).toBe(1);
  });

  it("lifts the limit for a free-mode user when payments are off", async () => {
    await setPayments(false);

    await superLike(targetIds[0]).run();

    // The same second super-like that 429s above must now be allowed: free mode
    // grants ELITE_AMBASSADOR (20/day), and reading the subscription row
    // directly left this user stuck at 1.
    const second = superLike(targetIds[1]);
    await second.run();

    expect(limitFrom(second)).toBeUndefined();
    const body = second.json.mock.calls.at(-1)?.[0] as { success?: boolean } | undefined;
    expect(body?.success).toBe(true);
  });

  it("honours a comp even with no subscription row", async () => {
    await prisma.subscriptionAccessGrant.create({
      data: {
        userId: swiperId,
        tierCode: "GOLD_INVESTOR",
        includePaidPerks: true,
        startDate: new Date(),
        reason: "Super-like free-mode test",
      },
    });

    try {
      await superLike(targetIds[0]).run();
      const second = superLike(targetIds[1]);
      await second.run();

      expect(limitFrom(second)).toBeUndefined();
    } finally {
      await prisma.subscriptionAccessGrant.deleteMany({ where: { userId: swiperId } });
    }
  });

  it("does not grant quota perks to a comp that waived them", async () => {
    // includePaidPerks=false waives the fee without conferring paid perks, so
    // this user keeps the FREE limit even though their tierCode is paid.
    await prisma.subscriptionAccessGrant.create({
      data: {
        userId: swiperId,
        tierCode: "GOLD_INVESTOR",
        includePaidPerks: false,
        startDate: new Date(),
        reason: "Super-like free-mode test",
      },
    });

    try {
      await superLike(targetIds[0]).run();
      const second = superLike(targetIds[1]);
      await second.run();

      expect(limitFrom(second)).toBe(1);
    } finally {
      await prisma.subscriptionAccessGrant.deleteMany({ where: { userId: swiperId } });
    }
  });
});
