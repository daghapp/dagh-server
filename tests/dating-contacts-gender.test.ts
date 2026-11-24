import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  contactMatch: { findMany: vi.fn(), count: vi.fn(), deleteMany: vi.fn() },
  contactSyncConsent: { upsert: vi.fn() },
  $transaction: vi.fn(),
};

vi.mock("../src/config/index.js", () => ({ prisma: prismaMock }));

const contactsMock = {
  buildInviteLink: vi.fn(async () => ({ token: "invite-token" })),
  findContactUsers: vi.fn(),
  getContactSyncConsent: vi.fn(async () => ({ granted: true })),
  getContactSyncConsentWithCapabilities: vi.fn(async () => ({
    consent: { granted: true, lookupHashes: ["hash-1"] },
    supportsLookupHashes: true,
  })),
  persistContactMatches: vi.fn(async () => undefined),
  refreshContactMatches: vi.fn(async () => undefined),
};

vi.mock("../src/modules/contacts/contacts.service.js", () => ({
  ...contactsMock,
  contactUserSelect: { id: true },
}));

const { syncDatingContacts, getDatingContactMatches, revokeDatingContactConsent } =
  await import("../src/services/dating-contacts.service.js");

function contact(id: string, fullName: string) {
  return {
    id,
    fullName,
    username: id,
    phoneNumber: null,
    phoneNumberHash: null,
    phoneHash: null,
    profileImageUrl: null,
    profile: null,
    datingProfile: null,
  };
}

const MALE_CONTACT = contact("male-user", "Male Contact");
const FEMALE_CONTACT = contact("female-user", "Female Contact");

describe("dating contacts enforce the opposite-gender rule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof prismaMock) => unknown) =>
      cb(prismaMock),
    );
    contactsMock.getContactSyncConsent.mockResolvedValue({ granted: true });
    contactsMock.findContactUsers.mockResolvedValue({
      users: [MALE_CONTACT, FEMALE_CONTACT],
      totalContacts: 2,
      lookupHashes: ["hash-1"],
    });
    prismaMock.user.findUnique.mockResolvedValue({ gender: "MALE" });
    prismaMock.user.findMany.mockResolvedValue([
      { id: MALE_CONTACT.id, gender: "MALE" },
      { id: FEMALE_CONTACT.id, gender: "FEMALE" },
    ]);
  });

  it("shows a male viewer only female contacts but persists every match", async () => {
    const result = await syncDatingContacts("caller", ["0244000000"], true);

    expect(result.matchedCount).toBe(1);
    expect(result.matches.map((match) => match.userId)).toEqual(["female-user"]);
    expect(contactsMock.persistContactMatches).toHaveBeenCalledWith(
      "caller",
      expect.arrayContaining([MALE_CONTACT, FEMALE_CONTACT]),
      2,
      ["hash-1"],
    );
  });

  it("shows a female viewer only male contacts", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ gender: "FEMALE" });

    const result = await syncDatingContacts("caller", ["0244000000"], true);

    expect(result.matchedCount).toBe(1);
    expect(result.matches.map((match) => match.userId)).toEqual(["male-user"]);
  });

  it("filters persisted matches by the viewer's opposite gender", async () => {
    prismaMock.contactMatch.findMany.mockResolvedValue([{ matchedUser: FEMALE_CONTACT }]);

    const matches = await getDatingContactMatches("caller");

    expect(matches.map((match) => match.userId)).toEqual(["female-user"]);
    const args = prismaMock.contactMatch.findMany.mock.calls[0][0];
    expect(args.where.matchedUser.gender).toEqual({ in: ["FEMALE"] });
  });

  it("returns no dating contacts for an unknown viewer gender", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ gender: null });

    await expect(getDatingContactMatches("caller")).resolves.toEqual([]);
    expect(prismaMock.contactMatch.findMany).not.toHaveBeenCalled();
  });

  it("returns every matched gender for People You May Know", async () => {
    prismaMock.contactMatch.findMany.mockResolvedValue([
      { matchedUser: MALE_CONTACT },
      { matchedUser: FEMALE_CONTACT },
    ]);

    const matches = await getDatingContactMatches("caller", { allGenders: true });

    expect(matches.map((match) => match.userId)).toEqual(["male-user", "female-user"]);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    const args = prismaMock.contactMatch.findMany.mock.calls[0][0];
    expect(args.where.matchedUser.gender).toBeUndefined();
  });

  it("does not fail sync when the invite link cannot be built", async () => {
    contactsMock.buildInviteLink.mockRejectedValueOnce(new Error("no deep link secret"));

    const result = await syncDatingContacts("caller", ["0244000000"], true);

    expect(result.matches.map((match) => match.userId)).toEqual(["female-user"]);
    expect(result.invite).toBeNull();
  });

  it("clears stored lookup hashes when dating contact consent is revoked", async () => {
    await revokeDatingContactConsent("caller");

    const args = prismaMock.contactSyncConsent.upsert.mock.calls[0][0];
    expect(args.update.lookupHashes).toEqual([]);
    expect(args.update.contactCount).toBe(0);
  });
});
