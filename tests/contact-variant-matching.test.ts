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
  contactMatch: { deleteMany: vi.fn(), createMany: vi.fn() },
  userDevice: { findMany: vi.fn() },
  $transaction: vi.fn(),
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
    prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof prismaMock) => unknown) =>
      cb(prismaMock),
    );
  });

  it("stores every plausible hash form for a registered phone", async () => {
    await syncPhoneHashVariants("u1", "+233244000000");

    expect(prismaMock.phoneHashVariant.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    const args = prismaMock.phoneHashVariant.createMany.mock.calls[0][0];
    const hashes = args.data.map((row: { hash: string }) => row.hash);
    expect(hashes).toContain(hashPhoneNumber("+233244000000"));
    expect(hashes).toContain(hashPhoneNumber("0244000000"));
    expect(hashes).toContain(hashPhoneNumber("244000000"));
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

  it("excludes deleted and restricted accounts from contact matches", async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    await findContactUsers("caller", [hashPhoneNumber("0244000000")]);
    const where = prismaMock.user.findMany.mock.calls[0][0].where;
    expect(where.isDeleted).toBe(false);
    expect(where.accountStatus).toEqual({
      notIn: ["SUSPENDED", "TERMINATED", "DEACTIVATED"],
    });
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
