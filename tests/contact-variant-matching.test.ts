import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPhoneNumber } from "../src/helpers/phoneHash.js";

const prismaMock = {
  user: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  userBlock: { findMany: vi.fn() },
  phoneHashVariant: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  contactSyncConsent: { findUnique: vi.fn(), upsert: vi.fn() },
  contactMatch: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  userDevice: { findMany: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(async (_sql: TemplateStringsArray, ..._values: unknown[]) => 1),
};

vi.mock("../src/config/index.js", () => ({ prisma: prismaMock }));

const deepLinkMock = {
  createSmartLink: vi.fn(async () => ({
    token: "invite-token",
    shareUrl: "https://api.example.com/share/app/u1?token=invite-token",
    deepLink: "diasporansync://share/app/u1?token=invite-token",
    deferredDeepLink: "diasporansync://deferred?token=invite-token",
    storeUrl: "https://play.google.com/store/apps/details?id=app",
    playStoreUrl: "https://play.google.com/store/apps/details?id=app",
    appStoreUrl: "",
  })),
};

vi.mock("../src/modules/deep-links/deep-link.service.js", () => deepLinkMock);

const {
  findContactUsers,
  syncPhoneHashVariants,
  buildInviteLink,
  matchContacts,
  getContactMatchSummary,
} = await import("../src/modules/contacts/contacts.service.js");

const MATCHED_USER = {
  id: "matched-user",
  fullName: "Ama Mensah",
  username: "ama",
  phoneNumber: "+233244000000",
  phoneNumberHash: hashPhoneNumber("+233244000000"),
  phoneHash: null,
  profileImageUrl: null,
  profile: null,
  datingProfile: null,
};

describe("pre-hashed contact matching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.userBlock.findMany.mockResolvedValue([]);
    prismaMock.contactMatch.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof prismaMock) => unknown) =>
      cb(prismaMock),
    );
  });

  it("stores every plausible hash form for a registered phone", async () => {
    await syncPhoneHashVariants("u1", "+233244000000");

    expect(prismaMock.phoneHashVariant.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
    });
    const args = prismaMock.phoneHashVariant.createMany.mock.calls[0][0];
    const hashes = args.data.map((row: { hash: string }) => row.hash);
    expect(hashes).toContain(hashPhoneNumber("+233244000000"));
    expect(hashes).toContain(hashPhoneNumber("0244000000"));
    expect(hashes).toContain(hashPhoneNumber("244000000"));
    expect(hashes).toContain(crypto.createHash("sha256").update("+233244000000").digest("hex"));
  });

  it("matches a pre-hashed local contact to an E.164 registration via variants", async () => {
    // Client sent a SHA-256 hash of the local form 0244000000.
    const localHash = hashPhoneNumber("0244000000");
    prismaMock.user.findMany.mockResolvedValue([MATCHED_USER]);

    const { users } = await findContactUsers("caller", [localHash]);

    expect(users).toHaveLength(1);
    const where = prismaMock.user.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { phoneHashVariants: { some: { hash: { in: expect.arrayContaining([localHash]) } } } },
      ]),
    );
  });

  it("chunks large hash lookups to stay below Prisma bind-parameter limits", async () => {
    const contacts = Array.from({ length: 2250 }, (_, index) =>
      index.toString(16).padStart(64, "0"),
    );
    prismaMock.user.findMany.mockResolvedValue([]);

    await findContactUsers("caller", contacts);

    const hashQueries = prismaMock.user.findMany.mock.calls.filter(([args]) =>
      args.where.OR?.some(
        (clause: { phoneNumberHash?: { in?: string[] } }) => clause.phoneNumberHash?.in,
      ),
    );
    expect(hashQueries.length).toBeGreaterThan(1);
    for (const [args] of hashQueries) {
      for (const rawClause of args.where.OR) {
        const clause = rawClause as {
          phoneNumberHash?: { in?: string[] };
          phoneHash?: { in?: string[] };
          phoneHashVariants?: { some?: { hash?: { in?: string[] } } };
        };
        expect(clause.phoneNumberHash?.in?.length ?? 0).toBeLessThanOrEqual(2000);
        expect(clause.phoneHash?.in?.length ?? 0).toBeLessThanOrEqual(2000);
        expect(clause.phoneHashVariants?.some?.hash?.in?.length ?? 0).toBeLessThanOrEqual(2000);
      }
    }
  });

  it("excludes deleted and restricted accounts from contact matches", async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    await findContactUsers("caller", [hashPhoneNumber("0244000000")]);
    const where = prismaMock.user.findMany.mock.calls[0][0].where;
    expect(where.isDeleted).toBe(false);
    expect(where.accountStatus).toEqual({
      notIn: ["SUSPENDED", "TERMINATED", "DEACTIVATED"],
    });
  });

  it("does not apply a gender filter to general People You May Know matches", async () => {
    prismaMock.user.findMany.mockResolvedValue([MATCHED_USER]);

    const result = await matchContacts("caller", ["0244000000"]);

    expect(result.matches).toHaveLength(1);
    const where = prismaMock.user.findMany.mock.calls[0][0].where;
    expect(where.gender).toBeUndefined();
  });

  it("returns explicit counts for contacts who use the app", async () => {
    prismaMock.user.findMany.mockResolvedValue([MATCHED_USER]);
    const result = await matchContacts("caller", ["0244000000"]);

    expect(result.totalContacts).toBe(1);
    expect(result.matchedCount).toBe(1);
    expect(result.contactsOnAppCount).toBe(1);
    expect(result.appUserCount).toBe(1);
    expect(result.matchedContactsCount).toBe(1);
    expect(result.unmatchedCount).toBe(0);

    const consentArgs = prismaMock.contactSyncConsent.upsert.mock.calls[0][0];
    expect(consentArgs.create.lookupHashes).toContain(hashPhoneNumber("0244000000"));
    expect(consentArgs.create.lookupHashes).toContain(hashPhoneNumber("233244000000"));
  });

  it("fails sync when matches cannot be persisted", async () => {
    prismaMock.user.findMany.mockResolvedValue([MATCHED_USER]);
    prismaMock.$transaction.mockRejectedValueOnce(new Error("db down"));

    await expect(matchContacts("caller", ["0244000000"])).rejects.toThrow("db down");
  });

  it("still syncs when the lookupHashes column is not deployed", async () => {
    prismaMock.user.findMany.mockResolvedValue([MATCHED_USER]);
    prismaMock.contactSyncConsent.findUnique
      .mockRejectedValueOnce(new Error("Unknown argument `lookupHashes`"))
      .mockResolvedValueOnce({ granted: true, contactCount: 1 });

    const result = await matchContacts("caller", ["0244000000"]);

    expect(result.matchedCount).toBe(1);
    expect(prismaMock.contactSyncConsent.upsert).not.toHaveBeenCalled();
    expect(prismaMock.$executeRaw).toHaveBeenCalled();
    expect(prismaMock.$executeRaw.mock.calls[0][0].join("")).not.toContain("lookupHashes");
  });

  it("still syncs when Prisma hides the missing column name in P2022", async () => {
    prismaMock.user.findMany.mockResolvedValue([MATCHED_USER]);
    prismaMock.contactSyncConsent.findUnique
      .mockRejectedValueOnce({
        code: "P2022",
        meta: { modelName: "ContactSyncConsent" },
        message: "The column `(not available)` does not exist in the current database.",
      })
      .mockResolvedValueOnce({ granted: true, contactCount: 1 });

    const result = await matchContacts("caller", ["0244000000"]);

    expect(result.matchedCount).toBe(1);
    expect(prismaMock.contactSyncConsent.upsert).not.toHaveBeenCalled();
    expect(prismaMock.$executeRaw).toHaveBeenCalled();
    expect(prismaMock.$executeRaw.mock.calls[0][0].join("")).not.toContain("lookupHashes");
  });

  it("refreshes newly joined matches from stored lookup hashes", async () => {
    prismaMock.contactSyncConsent.findUnique.mockResolvedValue({
      granted: true,
      contactCount: 1,
      lookupHashes: [hashPhoneNumber("0244000000")],
    });
    prismaMock.user.findMany.mockResolvedValue([MATCHED_USER]);
    prismaMock.contactMatch.findMany.mockResolvedValue([{ matchedUser: MATCHED_USER }]);

    const summary = await getContactMatchSummary("caller");

    expect(prismaMock.contactMatch.createMany).toHaveBeenCalled();
    expect(summary.matchedCount).toBe(1);
  });

  it("includes explicit counts in the persisted matches summary", async () => {
    prismaMock.contactSyncConsent.findUnique.mockResolvedValue({ contactCount: 4, granted: true });
    prismaMock.contactMatch.findMany.mockResolvedValue([{ matchedUser: MATCHED_USER }]);

    const summary = await getContactMatchSummary("caller");

    expect(summary.totalContacts).toBe(4);
    expect(summary.contactsOnAppCount).toBe(1);
    expect(summary.appUserCount).toBe(1);
    expect(summary.unmatchedCount).toBe(3);
  });
});

describe("invite link", () => {
  beforeEach(() => vi.clearAllMocks());

  it("includes the deep-link token in the share URL for attribution", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      fullName: "Kojo",
      username: "kojo",
      profileImageUrl: null,
    });

    const invite = await buildInviteLink("u1");

    expect(invite.shareUrl).toContain("token=invite-token");
    expect(invite.shareUrl).toContain("inviter=Kojo");
    expect(invite.token).toBe("invite-token");
  });
});
