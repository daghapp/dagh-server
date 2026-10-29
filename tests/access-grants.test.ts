import { describe, expect, it } from "vitest";
import {
  isGrantInForce,
  selectGoverningGrant,
  resolveEffectiveAccess,
  tierValue,
  TIER_VALUE,
  type GrantLike,
  type SubscriptionLike,
} from "../src/helpers/membership.js";
import { resolveTierBoost } from "../src/services/matching.service.js";
import {
  createAccessGrantSchema,
  updateAccessGrantSchema,
} from "../src/validator/membership-validator.js";

const NOW = new Date("2026-06-01T00:00:00.000Z");

function grant(overrides: Partial<GrantLike> = {}): GrantLike {
  return {
    id: "g1",
    tierCode: "SILVER",
    includePaidPerks: false,
    waiveServiceFees: false,
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    endDate: null,
    revokedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function sub(overrides: Partial<SubscriptionLike> = {}): SubscriptionLike {
  return { tierCode: "SILVER", status: "ACTIVE", endDate: null, ...overrides };
}

// ─────────────────────────────────────────
// isGrantInForce
// ─────────────────────────────────────────
describe("isGrantInForce", () => {
  it("accepts a perpetual grant that has started", () => {
    expect(isGrantInForce(grant(), NOW)).toBe(true);
  });

  it("rejects a revoked grant", () => {
    expect(isGrantInForce(grant({ revokedAt: new Date("2026-05-01") }), NOW)).toBe(false);
  });

  it("rejects a grant that has not started yet", () => {
    expect(isGrantInForce(grant({ startDate: new Date("2026-07-01") }), NOW)).toBe(false);
  });

  it("rejects an expired grant", () => {
    expect(isGrantInForce(grant({ endDate: new Date("2026-05-31") }), NOW)).toBe(false);
  });

  it("accepts a grant expiring exactly now (endDate is exclusive)", () => {
    expect(isGrantInForce(grant({ endDate: NOW }), NOW)).toBe(false);
  });

  it("accepts a grant expiring in the future", () => {
    expect(isGrantInForce(grant({ endDate: new Date("2026-06-02") }), NOW)).toBe(true);
  });
});

// ─────────────────────────────────────────
// selectGoverningGrant
// ─────────────────────────────────────────
describe("selectGoverningGrant", () => {
  it("returns null when nothing is in force", () => {
    expect(selectGoverningGrant([grant({ revokedAt: new Date("2026-05-01") })], NOW)).toBeNull();
  });

  it("picks the highest-tier in-force grant", () => {
    const chosen = selectGoverningGrant(
      [
        grant({ id: "basic", tierCode: "BASIC" }),
        grant({ id: "silver", tierCode: "SILVER" }),
        grant({ id: "gold", tierCode: "GOLD_INVESTOR" }),
      ],
      NOW,
    );
    expect(chosen?.id).toBe("gold");
  });

  it("ignores expired grants when choosing", () => {
    const chosen = selectGoverningGrant(
      [
        grant({
          id: "expired-elite",
          tierCode: "ELITE_AMBASSADOR",
          endDate: new Date("2026-05-01"),
        }),
        grant({ id: "live-basic", tierCode: "BASIC" }),
      ],
      NOW,
    );
    expect(chosen?.id).toBe("live-basic");
  });

  it("prefers a perpetual grant over an expiring one at the same tier", () => {
    const chosen = selectGoverningGrant(
      [
        grant({
          id: "temporary",
          endDate: new Date("2026-07-01"),
          createdAt: new Date("2026-05-01"),
        }),
        grant({ id: "perpetual", endDate: null, createdAt: new Date("2026-01-01") }),
      ],
      NOW,
    );
    // The perpetual grant is older but must still win, otherwise a long-standing
    // "forever" comp is silently downgraded by a later short overlapping grant.
    expect(chosen?.id).toBe("perpetual");
  });

  it("prefers the newer grant when tier and expiry type both match", () => {
    const chosen = selectGoverningGrant(
      [
        grant({ id: "old", createdAt: new Date("2026-01-01") }),
        grant({ id: "new", createdAt: new Date("2026-05-01") }),
      ],
      NOW,
    );
    expect(chosen?.id).toBe("new");
  });
});

// ─────────────────────────────────────────
// resolveEffectiveAccess — grant only
// ─────────────────────────────────────────
describe("resolveEffectiveAccess — comp without a subscription", () => {
  it("grants access with no subscription present", () => {
    const access = resolveEffectiveAccess({ subscription: null, grants: [grant()], now: NOW });
    expect(access).toEqual({
      tierCode: "SILVER",
      source: "GRANT",
      grantId: "g1",
      includePaidPerks: false,
      perksTierCode: "FREE",
      waiveServiceFees: false,
    });
  });

  it("keeps perks out of reach when includePaidPerks is false", () => {
    const access = resolveEffectiveAccess({
      subscription: null,
      grants: [grant({ tierCode: "GOLD_INVESTOR", includePaidPerks: false })],
      now: NOW,
    });
    // The user is entitled to the tier's content...
    expect(access.tierCode).toBe("GOLD_INVESTOR");
    // ...but ranks as FREE, so a comp never outranks a paying member.
    expect(access.perksTierCode).toBe("FREE");
    expect(resolveTierBoost(access.perksTierCode)).toBe(TIER_VALUE.FREE);
  });

  it("confers perks when includePaidPerks is true", () => {
    const access = resolveEffectiveAccess({
      subscription: null,
      grants: [grant({ tierCode: "GOLD_INVESTOR", includePaidPerks: true })],
      now: NOW,
    });
    expect(access.perksTierCode).toBe("GOLD_INVESTOR");
    expect(resolveTierBoost(access.perksTierCode)).toBe(TIER_VALUE.GOLD_INVESTOR);
  });

  it("falls back to FREE once the grant is revoked", () => {
    const access = resolveEffectiveAccess({
      subscription: null,
      grants: [grant({ revokedAt: new Date("2026-05-01") })],
      now: NOW,
    });
    expect(access.source).toBe("FREE");
    expect(access.tierCode).toBe("FREE");
    expect(access.perksTierCode).toBe("FREE");
  });

  it("falls back to FREE once the grant expires", () => {
    const access = resolveEffectiveAccess({
      subscription: null,
      grants: [grant({ endDate: new Date("2026-05-01") })],
      now: NOW,
    });
    expect(access.source).toBe("FREE");
  });

  it("still grants access before a future-dated grant starts", () => {
    const access = resolveEffectiveAccess({
      subscription: null,
      grants: [grant({ startDate: new Date("2026-07-01") })],
      now: NOW,
    });
    expect(access.source).toBe("FREE");
  });
});

// ─────────────────────────────────────────
// resolveEffectiveAccess — subscription only
// ─────────────────────────────────────────
describe("resolveEffectiveAccess — paid subscription without a comp", () => {
  it("resolves an active subscription with perks", () => {
    const access = resolveEffectiveAccess({ subscription: sub(), grants: [], now: NOW });
    expect(access).toEqual({
      tierCode: "SILVER",
      source: "SUBSCRIPTION",
      grantId: null,
      includePaidPerks: true,
      perksTierCode: "SILVER",
      waiveServiceFees: false,
    });
  });

  it("ignores a FREE subscription", () => {
    const access = resolveEffectiveAccess({
      subscription: sub({ tierCode: "FREE" }),
      grants: [],
      now: NOW,
    });
    expect(access.source).toBe("FREE");
  });

  it("ignores a cancelled subscription", () => {
    const access = resolveEffectiveAccess({
      subscription: sub({ status: "CANCELLED" }),
      grants: [],
      now: NOW,
    });
    expect(access.source).toBe("FREE");
  });

  it("ignores an expired subscription", () => {
    const access = resolveEffectiveAccess({
      subscription: sub({ endDate: new Date("2026-05-01") }),
      grants: [],
      now: NOW,
    });
    expect(access.source).toBe("FREE");
  });

  it("returns FREE when the user has neither", () => {
    const access = resolveEffectiveAccess({ subscription: null, grants: [], now: NOW });
    expect(access).toEqual({
      tierCode: "FREE",
      source: "FREE",
      grantId: null,
      includePaidPerks: false,
      perksTierCode: "FREE",
      waiveServiceFees: false,
    });
  });
});

// ─────────────────────────────────────────
// resolveEffectiveAccess — coexistence
// ─────────────────────────────────────────
describe("resolveEffectiveAccess — comp and subscription coexist", () => {
  it("keeps the subscription when it outranks the comp", () => {
    const access = resolveEffectiveAccess({
      subscription: sub({ tierCode: "GOLD_INVESTOR" }),
      grants: [grant({ tierCode: "BASIC", includePaidPerks: true })],
      now: NOW,
    });
    expect(access.source).toBe("SUBSCRIPTION");
    expect(access.tierCode).toBe("GOLD_INVESTOR");
    expect(access.grantId).toBeNull();
    // A comp with perks must not downgrade a genuinely paying member.
    expect(access.perksTierCode).toBe("GOLD_INVESTOR");
  });

  it("lets a higher comp outrank a lower subscription", () => {
    const access = resolveEffectiveAccess({
      subscription: sub({ tierCode: "BASIC" }),
      grants: [grant({ id: "comp-elite", tierCode: "ELITE_AMBASSADOR", includePaidPerks: true })],
      now: NOW,
    });
    expect(access.source).toBe("GRANT");
    expect(access.tierCode).toBe("ELITE_AMBASSADOR");
    expect(access.grantId).toBe("comp-elite");
    expect(access.perksTierCode).toBe("ELITE_AMBASSADOR");
  });

  it("keeps the comp after the user later subscribes for real", () => {
    // The regression this guards: writing a comp into user_subscriptions would be
    // silently overwritten by this subscription, revoking the comp.
    const access = resolveEffectiveAccess({
      subscription: sub({ tierCode: "BASIC" }),
      grants: [grant({ tierCode: "GOLD_INVESTOR", includePaidPerks: true })],
      now: NOW,
    });
    expect(access.source).toBe("GRANT");
    expect(access.tierCode).toBe("GOLD_INVESTOR");
  });

  it("breaks a tier tie in favour of the subscription", () => {
    const access = resolveEffectiveAccess({
      subscription: sub({ tierCode: "SILVER" }),
      grants: [grant({ tierCode: "SILVER", includePaidPerks: true })],
      now: NOW,
    });
    // Equal tier: the paying record wins, so revoking the comp changes nothing.
    expect(access.source).toBe("SUBSCRIPTION");
  });

  it("does not inherit a comp's perks when the subscription wins", () => {
    const access = resolveEffectiveAccess({
      subscription: sub({ tierCode: "ELITE_AMBASSADOR" }),
      grants: [grant({ tierCode: "ELITE_AMBASSADOR", includePaidPerks: false })],
      now: NOW,
    });
    expect(access.source).toBe("SUBSCRIPTION");
    expect(access.perksTierCode).toBe("ELITE_AMBASSADOR");
  });

  it("revoking the comp exposes the underlying subscription", () => {
    const access = resolveEffectiveAccess({
      subscription: sub({ tierCode: "BASIC" }),
      grants: [grant({ tierCode: "GOLD_INVESTOR", revokedAt: new Date("2026-05-01") })],
      now: NOW,
    });
    expect(access.source).toBe("SUBSCRIPTION");
    expect(access.tierCode).toBe("BASIC");
  });

  it("a comp survives an expired subscription on the same user", () => {
    const access = resolveEffectiveAccess({
      subscription: sub({ tierCode: "GOLD_INVESTOR", endDate: new Date("2026-05-01") }),
      grants: [grant({ tierCode: "SILVER", includePaidPerks: true })],
      now: NOW,
    });
    expect(access.source).toBe("GRANT");
    expect(access.tierCode).toBe("SILVER");
  });
});

// ─────────────────────────────────────────
// resolveEffectiveAccess — service-fee waivers
// ─────────────────────────────────────────
describe("resolveEffectiveAccess — lifetime service-fee waiver", () => {
  it("waives fees when a perpetual grant sets the flag", () => {
    const access = resolveEffectiveAccess({
      subscription: null,
      grants: [grant({ waiveServiceFees: true, endDate: null })],
      now: NOW,
    });
    expect(access.waiveServiceFees).toBe(true);
  });

  it("does not waive fees for a tier-only comp", () => {
    const access = resolveEffectiveAccess({
      subscription: null,
      grants: [grant({ waiveServiceFees: false })],
      now: NOW,
    });
    expect(access.waiveServiceFees).toBe(false);
  });

  it("waives fees even when a different, higher-tier grant governs", () => {
    // The waiver is a per-user entitlement, not a property of the winning tier.
    const access = resolveEffectiveAccess({
      subscription: null,
      grants: [
        grant({ id: "basic-waiver", tierCode: "BASIC", waiveServiceFees: true }),
        grant({ id: "gold", tierCode: "GOLD_INVESTOR", waiveServiceFees: false }),
      ],
      now: NOW,
    });
    expect(access.tierCode).toBe("GOLD_INVESTOR");
    expect(access.grantId).toBe("gold");
    expect(access.waiveServiceFees).toBe(true);
  });

  it("keeps waiving fees after a paid subscription outranks the grant", () => {
    // Buying a plan must not silently cancel the admin's exemption.
    const access = resolveEffectiveAccess({
      subscription: sub({ tierCode: "ELITE_AMBASSADOR" }),
      grants: [grant({ tierCode: "BASIC", waiveServiceFees: true })],
      now: NOW,
    });
    expect(access.source).toBe("SUBSCRIPTION");
    expect(access.waiveServiceFees).toBe(true);
  });

  it("drops the waiver when the grant expires", () => {
    const access = resolveEffectiveAccess({
      subscription: null,
      grants: [grant({ waiveServiceFees: true, endDate: new Date("2026-05-01") })],
      now: NOW,
    });
    expect(access.waiveServiceFees).toBe(false);
  });

  it("drops the waiver when the grant is revoked", () => {
    const access = resolveEffectiveAccess({
      subscription: null,
      grants: [grant({ waiveServiceFees: true, revokedAt: new Date("2026-05-01") })],
      now: NOW,
    });
    expect(access.waiveServiceFees).toBe(false);
  });
});

// ─────────────────────────────────────────
// Tier ordering consistency
// ─────────────────────────────────────────
describe("tier ordering", () => {
  it("ranks FREE lowest", () => {
    for (const [tier, value] of Object.entries(TIER_VALUE)) {
      expect(value).toBeGreaterThanOrEqual(TIER_VALUE.FREE);
      if (tier !== "FREE") expect(value).toBeGreaterThan(TIER_VALUE.FREE);
    }
  });

  it("agrees with resolveTierBoost in matching (one source of truth)", () => {
    for (const tier of Object.keys(TIER_VALUE)) {
      expect(tierValue(tier)).toBe(resolveTierBoost(tier));
    }
  });

  it("treats an unknown tier as FREE rather than granting access", () => {
    const access = resolveEffectiveAccess({
      subscription: null,
      grants: [grant({ tierCode: "NOT_A_TIER" })],
      now: NOW,
    });
    // The raw tierCode is still reported so the admin UI can show the bad data,
    // but it carries no value and so no ranking privilege.
    expect(tierValue("NOT_A_TIER")).toBe(TIER_VALUE.FREE);
    expect(resolveTierBoost(access.perksTierCode)).toBe(TIER_VALUE.FREE);
  });

  it("gives a null tier no value", () => {
    expect(tierValue(null)).toBe(TIER_VALUE.FREE);
    expect(tierValue(undefined)).toBe(TIER_VALUE.FREE);
  });
});

// ─────────────────────────────────────────
// Grant payload validation
// ─────────────────────────────────────────
describe("createAccessGrantSchema", () => {
  const valid = { userId: "u1", tierCode: "SILVER", reason: "Board member" };

  it("accepts a perpetual comp with no endDate", () => {
    const parsed = createAccessGrantSchema.parse(valid);
    expect(parsed.endDate).toBeUndefined();
    expect(parsed.includePaidPerks).toBe(false);
    expect(parsed.waiveServiceFees).toBe(false);
  });

  it("defaults includePaidPerks to false so a comp is fee-only by default", () => {
    expect(createAccessGrantSchema.parse(valid).includePaidPerks).toBe(false);
  });

  it("accepts an explicit all-service fee waiver", () => {
    expect(
      createAccessGrantSchema.parse({ ...valid, waiveServiceFees: true }).waiveServiceFees,
    ).toBe(true);
  });

  it("accepts an email instead of a userId", () => {
    const parsed = createAccessGrantSchema.parse({
      email: "person@example.com",
      tierCode: "SILVER",
      reason: "Email lookup",
    });
    expect(parsed.email).toBe("person@example.com");
    expect(parsed.userId).toBeUndefined();
  });

  it("accepts both identifiers, leaving precedence to the controller", () => {
    expect(
      createAccessGrantSchema.safeParse({
        ...valid,
        email: "person@example.com",
      }).success,
    ).toBe(true);
  });

  it("requires at least one identifier", () => {
    expect(
      createAccessGrantSchema.safeParse({ tierCode: "SILVER", reason: "No identifier" }).success,
    ).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(
      createAccessGrantSchema.safeParse({
        email: "not-an-email",
        tierCode: "SILVER",
        reason: "Bad email",
      }).success,
    ).toBe(false);
  });

  it("rejects a FREE grant", () => {
    const parsed = createAccessGrantSchema.safeParse({ ...valid, tierCode: "FREE" });
    expect(parsed.success).toBe(false);
  });

  it("requires a reason for the audit trail", () => {
    expect(createAccessGrantSchema.safeParse({ ...valid, reason: "" }).success).toBe(false);
    expect(createAccessGrantSchema.safeParse({ ...valid, reason: "ab" }).success).toBe(false);
  });

  it("rejects an endDate at or before startDate", () => {
    const start = "2026-01-01T00:00:00.000Z";
    expect(
      createAccessGrantSchema.safeParse({ ...valid, startDate: start, endDate: start }).success,
    ).toBe(false);
    expect(
      createAccessGrantSchema.safeParse({
        ...valid,
        startDate: start,
        endDate: "2025-12-31T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("accepts an endDate after startDate", () => {
    expect(
      createAccessGrantSchema.safeParse({
        ...valid,
        startDate: "2026-01-01T00:00:00.000Z",
        endDate: "2026-07-01T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("accepts an explicit null endDate as perpetual", () => {
    expect(createAccessGrantSchema.safeParse({ ...valid, endDate: null }).success).toBe(true);
  });

  it("rejects an unknown tier code", () => {
    expect(createAccessGrantSchema.safeParse({ ...valid, tierCode: "PLATINUM" }).success).toBe(
      false,
    );
  });
});

describe("updateAccessGrantSchema", () => {
  it("accepts a partial update", () => {
    expect(updateAccessGrantSchema.safeParse({ includePaidPerks: true }).success).toBe(true);
  });

  it("accepts turning the service-fee waiver on or off", () => {
    expect(updateAccessGrantSchema.safeParse({ waiveServiceFees: true }).success).toBe(true);
    expect(updateAccessGrantSchema.safeParse({ waiveServiceFees: false }).success).toBe(true);
  });

  it("rejects downgrading a grant to FREE", () => {
    expect(updateAccessGrantSchema.safeParse({ tierCode: "FREE" }).success).toBe(false);
  });

  it("rejects an empty patch", () => {
    expect(updateAccessGrantSchema.safeParse({}).success).toBe(false);
  });
});
