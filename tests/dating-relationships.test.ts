import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────
// Relationship state derivation logic
// ─────────────────────────────────────────
// Mirrors the enrichment logic in swipe.controller.ts getRecommendations
// and getRelationshipStatus. Tested as a pure function to verify correctness
// independent of database queries.

type SwipeDirection = "LIKE" | "SUPER_LIKE" | "PASS";

interface Swipe {
  swiperId: string;
  targetId: string;
  direction: SwipeDirection;
}

interface Match {
  userId: string;
  matchedId: string;
  status: string;
}

interface RelationshipResult {
  relationshipStatus: string;
  canSendInterest: boolean;
}

function deriveRelationship(
  userId: string,
  targetId: string,
  swipes: Swipe[],
  matches: Match[],
  blockedIds: Set<string>,
): RelationshipResult {
  // Blocked users should not appear, but as defense-in-depth:
  if (blockedIds.has(targetId)) {
    return { relationshipStatus: "BLOCKED", canSendInterest: false };
  }

  const isMatched = matches.some(
    (m) => m.userId === targetId || m.matchedId === targetId,
  );

  if (isMatched) {
    return { relationshipStatus: "MATCHED", canSendInterest: false };
  }

  const outgoing = swipes.find(
    (s) => s.swiperId === userId && s.targetId === targetId,
  );
  const incoming = swipes.find(
    (s) => s.swiperId === targetId && s.targetId === userId,
  );

  if (outgoing && outgoing.direction !== "PASS") {
    return { relationshipStatus: "INTEREST_SENT", canSendInterest: false };
  }

  if (incoming && incoming.direction !== "PASS") {
    return { relationshipStatus: "INTEREST_RECEIVED", canSendInterest: false };
  }

  if (outgoing && outgoing.direction === "PASS") {
    return { relationshipStatus: "PASSED", canSendInterest: false };
  }

  if (incoming && incoming.direction === "PASS") {
    return { relationshipStatus: "NONE", canSendInterest: true };
  }

  return { relationshipStatus: "NONE", canSendInterest: true };
}

const emptyBlocked = new Set<string>();

describe("deriveRelationship", () => {
  it("returns NONE when no swipes or matches exist", () => {
    const result = deriveRelationship("userA", "userB", [], [], emptyBlocked);
    expect(result).toEqual({ relationshipStatus: "NONE", canSendInterest: true });
  });

  it("returns INTEREST_SENT after outgoing LIKE", () => {
    const swipes: Swipe[] = [
      { swiperId: "userA", targetId: "userB", direction: "LIKE" },
    ];
    const result = deriveRelationship("userA", "userB", swipes, [], emptyBlocked);
    expect(result).toEqual({ relationshipStatus: "INTEREST_SENT", canSendInterest: false });
  });

  it("returns INTEREST_SENT after outgoing SUPER_LIKE", () => {
    const swipes: Swipe[] = [
      { swiperId: "userA", targetId: "userB", direction: "SUPER_LIKE" },
    ];
    const result = deriveRelationship("userA", "userB", swipes, [], emptyBlocked);
    expect(result).toEqual({ relationshipStatus: "INTEREST_SENT", canSendInterest: false });
  });

  it("returns INTEREST_RECEIVED after incoming LIKE", () => {
    const swipes: Swipe[] = [
      { swiperId: "userB", targetId: "userA", direction: "LIKE" },
    ];
    const result = deriveRelationship("userA", "userB", swipes, [], emptyBlocked);
    expect(result).toEqual({ relationshipStatus: "INTEREST_RECEIVED", canSendInterest: false });
  });

  it("returns INTEREST_RECEIVED after incoming SUPER_LIKE", () => {
    const swipes: Swipe[] = [
      { swiperId: "userB", targetId: "userA", direction: "SUPER_LIKE" },
    ];
    const result = deriveRelationship("userA", "userB", swipes, [], emptyBlocked);
    expect(result).toEqual({ relationshipStatus: "INTEREST_RECEIVED", canSendInterest: false });
  });

  it("returns MATCHED when a match record exists (userId side)", () => {
    const swipes: Swipe[] = [
      { swiperId: "userA", targetId: "userB", direction: "LIKE" },
    ];
    const matches: Match[] = [
      { userId: "userA", matchedId: "userB", status: "MATCHED" },
    ];
    const result = deriveRelationship("userA", "userB", swipes, matches, emptyBlocked);
    expect(result).toEqual({ relationshipStatus: "MATCHED", canSendInterest: false });
  });

  it("returns MATCHED when a match record exists (matchedId side)", () => {
    const swipes: Swipe[] = [
      { swiperId: "userB", targetId: "userA", direction: "LIKE" },
    ];
    const matches: Match[] = [
      { userId: "userB", matchedId: "userA", status: "MATCHED" },
    ];
    const result = deriveRelationship("userA", "userB", swipes, matches, emptyBlocked);
    expect(result).toEqual({ relationshipStatus: "MATCHED", canSendInterest: false });
  });

  it("returns PASSED after outgoing PASS", () => {
    const swipes: Swipe[] = [
      { swiperId: "userA", targetId: "userB", direction: "PASS" },
    ];
    const result = deriveRelationship("userA", "userB", swipes, [], emptyBlocked);
    expect(result).toEqual({ relationshipStatus: "PASSED", canSendInterest: false });
  });

  it("returns NONE after incoming PASS (can still send interest)", () => {
    const swipes: Swipe[] = [
      { swiperId: "userB", targetId: "userA", direction: "PASS" },
    ];
    const result = deriveRelationship("userA", "userB", swipes, [], emptyBlocked);
    expect(result).toEqual({ relationshipStatus: "NONE", canSendInterest: true });
  });

  it("returns BLOCKED for blocked users", () => {
    const blockedIds = new Set(["userB"]);
    const result = deriveRelationship("userA", "userB", [], [], blockedIds);
    expect(result).toEqual({ relationshipStatus: "BLOCKED", canSendInterest: false });
  });

  it("MATCHED takes priority over INTEREST_SENT", () => {
    const swipes: Swipe[] = [
      { swiperId: "userA", targetId: "userB", direction: "LIKE" },
    ];
    const matches: Match[] = [
      { userId: "userA", matchedId: "userB", status: "MATCHED" },
    ];
    const result = deriveRelationship("userA", "userB", swipes, matches, emptyBlocked);
    expect(result.relationshipStatus).toBe("MATCHED");
  });

  it("INTEREST_SENT takes priority over INTEREST_RECEIVED", () => {
    const swipes: Swipe[] = [
      { swiperId: "userA", targetId: "userB", direction: "LIKE" },
      { swiperId: "userB", targetId: "userA", direction: "LIKE" },
    ];
    const result = deriveRelationship("userA", "userB", swipes, [], emptyBlocked);
    // When both outgoing and incoming exist but not matched yet,
    // outgoing is checked first in the logic
    expect(result.relationshipStatus).toBe("INTEREST_SENT");
    expect(result.canSendInterest).toBe(false);
  });
});

// ─────────────────────────────────────────
// Like status derivation (likes-sent endpoint)
// ─────────────────────────────────────────

function deriveLikeStatus(
  swiperId: string,
  targetId: string,
  matches: Match[],
): string {
  const isMatched = matches.some(
    (m) =>
      (m.userId === swiperId && m.matchedId === targetId) ||
      (m.userId === targetId && m.matchedId === swiperId),
  );
  return isMatched ? "MATCHED" : "PENDING";
}

describe("deriveLikeStatus (likes-sent)", () => {
  it("returns PENDING when no match exists", () => {
    expect(deriveLikeStatus("userA", "userB", [])).toBe("PENDING");
  });

  it("returns MATCHED when match exists", () => {
    const matches: Match[] = [
      { userId: "userA", matchedId: "userB", status: "MATCHED" },
    ];
    expect(deriveLikeStatus("userA", "userB", matches)).toBe("MATCHED");
  });

  it("returns MATCHED regardless of match direction", () => {
    const matches: Match[] = [
      { userId: "userB", matchedId: "userA", status: "MATCHED" },
    ];
    expect(deriveLikeStatus("userA", "userB", matches)).toBe("MATCHED");
  });

  it("returns PENDING for unrelated matches", () => {
    const matches: Match[] = [
      { userId: "userA", matchedId: "userC", status: "MATCHED" },
    ];
    expect(deriveLikeStatus("userA", "userB", matches)).toBe("PENDING");
  });
});

// ─────────────────────────────────────────
// canSendInterest consistency
// ─────────────────────────────────────────

describe("canSendInterest consistency", () => {
  it("canSendInterest is true only for NONE status", () => {
    // NONE: no swipes
    const none = deriveRelationship("userA", "userB", [], [], emptyBlocked);
    expect(none.canSendInterest).toBe(true);

    // INTEREST_SENT: outgoing non-PASS swipe
    const sent = deriveRelationship(
      "userA",
      "userB",
      [{ swiperId: "userA", targetId: "userB", direction: "LIKE" }],
      [],
      emptyBlocked,
    );
    expect(sent.canSendInterest).toBe(false);

    // INTEREST_RECEIVED: incoming non-PASS swipe
    const received = deriveRelationship(
      "userA",
      "userB",
      [{ swiperId: "userB", targetId: "userA", direction: "LIKE" }],
      [],
      emptyBlocked,
    );
    expect(received.canSendInterest).toBe(false);

    // MATCHED: match record exists
    const matched = deriveRelationship(
      "userA",
      "userB",
      [],
      [{ userId: "userA", matchedId: "userB", status: "MATCHED" }],
      emptyBlocked,
    );
    expect(matched.canSendInterest).toBe(false);

    // PASSED: outgoing PASS
    const passed = deriveRelationship(
      "userA",
      "userB",
      [{ swiperId: "userA", targetId: "userB", direction: "PASS" }],
      [],
      emptyBlocked,
    );
    expect(passed.canSendInterest).toBe(false);

    // BLOCKED: blocked user
    const blocked = deriveRelationship("userA", "userB", [], [], new Set(["userB"]));
    expect(blocked.canSendInterest).toBe(false);
  });

  it("NONE allows sending interest", () => {
    // NONE: no swipes at all
    const none = deriveRelationship("userA", "userB", [], [], emptyBlocked);
    expect(none.canSendInterest).toBe(true);
  });

  it("all other statuses disallow sending interest", () => {
    // INTEREST_SENT
    const sent = deriveRelationship(
      "userA",
      "userB",
      [{ swiperId: "userA", targetId: "userB", direction: "LIKE" }],
      [],
      emptyBlocked,
    );
    expect(sent.canSendInterest).toBe(false);

    // INTEREST_RECEIVED — spec: canSendInterest only for NONE
    const received = deriveRelationship(
      "userA",
      "userB",
      [{ swiperId: "userB", targetId: "userA", direction: "LIKE" }],
      [],
      emptyBlocked,
    );
    expect(received.canSendInterest).toBe(false);

    // MATCHED
    const matched = deriveRelationship(
      "userA",
      "userB",
      [],
      [{ userId: "userA", matchedId: "userB", status: "MATCHED" }],
      emptyBlocked,
    );
    expect(matched.canSendInterest).toBe(false);

    // PASSED
    const passed = deriveRelationship(
      "userA",
      "userB",
      [{ swiperId: "userA", targetId: "userB", direction: "PASS" }],
      [],
      emptyBlocked,
    );
    expect(passed.canSendInterest).toBe(false);
  });
});
