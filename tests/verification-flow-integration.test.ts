import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  profileVerification: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  userProfile: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  datingProfile: {
    findUnique: vi.fn(),
  },
  discoveryPreference: {
    findUnique: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  userSwipe: {
    findMany: vi.fn(),
  },
  userBlock: {
    findMany: vi.fn(),
  },
  otp: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    delete: vi.fn(),
  },
};

vi.mock("../src/config/index.js", () => ({ prisma: prismaMock }));
vi.mock("../src/config/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../src/services/dating-contacts.service.js", () => ({
  getDatingContactUserIds: vi.fn().mockResolvedValue(new Set()),
}));
vi.mock("../src/helpers/membership.js", () => ({
  TIER_VALUE: {},
  applyFreeMode: vi.fn((access) => access),
  getFreeModeTierCode: vi.fn().mockResolvedValue(null),
  getEffectiveAccess: vi.fn().mockResolvedValue({ perksTierCode: "FREE" }),
  resolveEffectiveAccess: vi.fn().mockReturnValue({ perksTierCode: "FREE" }),
}));
vi.mock("../src/services/kyc-verification.service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/services/kyc-verification.service.js")
  >("../src/services/kyc-verification.service.js");
  return { ...actual, requireKYCVerification: vi.fn() };
});

function createRes() {
  return {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      return this;
    },
  };
}

const baseVerification = {
  id: "verification-1",
  phone_number_verified: true,
  bio_profile_verification: true,
  document_verification: false,
  faceStatus: "APPROVED",
  documentStatus: "PENDING",
  bioDataStatus: "PENDING",
  isVerified: false,
  validationStep: "DOCUMENT_VERIFICATION",
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.profileVerification.findUnique.mockResolvedValue(baseVerification);
  prismaMock.profileVerification.update.mockImplementation(
    (args: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...baseVerification, ...args.data }),
  );
  prismaMock.userProfile.findUnique.mockResolvedValue({
    id: "profile-1",
    userId: "user-1",
  });
  prismaMock.datingProfile.findUnique.mockResolvedValue(null);
  prismaMock.discoveryPreference.findUnique.mockResolvedValue(null);
  prismaMock.user.findUnique.mockResolvedValue({ gender: "WOMAN" });
  prismaMock.userSwipe.findMany.mockResolvedValue([]);
  prismaMock.userBlock.findMany.mockResolvedValue([]);
  prismaMock.user.findMany.mockResolvedValue([]);
});

describe("verification approval", () => {
  it("sets stored isVerified when documents are the last approved step", async () => {
    const { AdminProfileController } =
      await import("../src/modules/profile-management/admin-profile.controller.js");
    const res = createRes();

    await new AdminProfileController().updateDocumentStatus(
      {
        params: { id: "verification-1" },
        body: { action: "APPROVED" },
        user: { id: "admin-1" },
      } as unknown as Request,
      res as unknown as Response,
    );

    expect(res.statusCode).toBe(200);
    expect(prismaMock.profileVerification.update.mock.calls[0][0].data.isVerified).toBe(true);
    expect(res.body.data.isVerified).toBe(true);
  });

  it("sets stored isVerified when bio data is the last approved step", async () => {
    const { AdminProfileController } =
      await import("../src/modules/profile-management/admin-profile.controller.js");
    const res = createRes();

    await new AdminProfileController().updateBioDataStatus(
      {
        params: { id: "verification-1" },
        body: { action: "APPROVED" },
        user: { id: "admin-1" },
      } as unknown as Request,
      res as unknown as Response,
    );

    expect(res.statusCode).toBe(200);
    expect(prismaMock.profileVerification.update.mock.calls[0][0].data.isVerified).toBe(true);
  });

  it("clears stored isVerified on rejection", async () => {
    const { AdminProfileController } =
      await import("../src/modules/profile-management/admin-profile.controller.js");
    prismaMock.profileVerification.findUnique.mockResolvedValue({
      ...baseVerification,
      document_verification: true,
      isVerified: true,
    });
    const res = createRes();

    await new AdminProfileController().updateFaceStatus(
      { params: { id: "verification-1" }, body: { action: "REJECTED" } } as unknown as Request,
      res as unknown as Response,
    );

    expect(prismaMock.profileVerification.update.mock.calls[0][0].data.isVerified).toBe(false);
  });
});

describe("verification status", () => {
  it("returns profileExists aliases and derived completion", async () => {
    const { getVerificationStatus } =
      await import("../src/modules/profile-management/profile.validation-step.controller.js");
    prismaMock.profileVerification.findUnique.mockResolvedValue({
      ...baseVerification,
      document_verification: true,
      documentStatus: "APPROVED",
    });
    const res = createRes();

    await getVerificationStatus(
      { user: { id: "user-1" } } as unknown as Request,
      res as unknown as Response,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.profileExists).toBe(true);
    expect(res.body.data.verificationProfileExists).toBe(true);
    expect(res.body.data.datingProfileExists).toBe(false);
    expect(res.body.data.isVerified).toBe(true);
  });
});

describe("dating KYC enforcement", () => {
  it("blocks swipes for unverified users", async () => {
    const kyc = await import("../src/services/kyc-verification.service.js");
    const { recordSwipe } = await import("../src/modules/dating/swipe.controller.js");
    vi.mocked(kyc.requireKYCVerification).mockRejectedValueOnce(
      new kyc.KYCVerificationError("Complete verification", "PHONE_NUMBER_VERIFICATION", {
        completedSteps: [],
        requiredSteps: ["PHONE_NUMBER_VERIFICATION"],
        nextStep: "PHONE_NUMBER_VERIFICATION",
      }),
    );
    const res = createRes();

    await recordSwipe(
      {
        user: { id: "user-1" },
        body: { targetId: "user-2", direction: "LIKE" },
      } as unknown as Request,
      res as unknown as Response,
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe("KYC_VERIFICATION_REQUIRED");
    expect(res.body.details.action).toBe("COMPLETE_VERIFICATION");
  });

  it("filters discovery candidates to fully verified profiles", async () => {
    const { getDiscoveryCandidates } = await import("../src/services/matching.service.js");

    await getDiscoveryCandidates("user-1", { limit: 5 });

    const where = prismaMock.user.findMany.mock.calls[0][0].where;
    const verificationFilter = JSON.stringify(where.AND);
    expect(verificationFilter).toContain("phone_number_verified");
    expect(verificationFilter).toContain("bio_profile_verification");
    expect(verificationFilter).toContain("document_verification");
  });
});
