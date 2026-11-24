import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  userStatusHistory: {
    create: vi.fn(),
  },
};

vi.mock("../src/config/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../src/helpers/admin-activity.js", () => ({ logAdminActivity: vi.fn() }));
vi.mock("../src/helpers/notify-admins.js", () => ({ notifyAdmins: vi.fn() }));
vi.mock("../src/config/resend.config.js", () => ({ default: vi.fn() }));

const { AuthAdminController } =
  await import("../src/modules/authentication/auth-admin.controller.js");
const controller = new AuthAdminController();

type ResponseBody = {
  success: boolean;
  data?: Record<string, unknown>;
  message?: string;
  error?: { code?: string };
};

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as ResponseBody | null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: ResponseBody) {
      this.body = body;
      return this;
    },
  };
  return res;
}

function mockReq(body: Record<string, unknown> = {}) {
  return {
    params: { userId: "user-1" },
    body,
    user: { id: "admin-1", accountType: "ADMIN" },
  } as unknown as Request;
}

function userFixture(accountStatus: string) {
  return {
    id: "user-1",
    fullName: "Ama Mensah",
    email: "ama@example.com",
    accountStatus,
    isDeleted: false,
  };
}

function setUpUser(accountStatus: string) {
  const user = userFixture(accountStatus);
  prismaMock.user.findUnique.mockResolvedValue(user);
  prismaMock.user.update.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...user, ...data }) as never,
  );
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("admin user approval", () => {
  it("approves a PENDING user and records the real from-status", async () => {
    setUpUser("PENDING");
    const res = mockRes();

    await controller.approveUser(mockReq(), res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body?.data?.accountStatus).toBe("ACTIVE");
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ accountStatus: "ACTIVE" }),
      }),
    );
    expect(prismaMock.userStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ from: "PENDING", to: "ACTIVE" }),
      }),
    );
  });

  it("approves a PENDING_VERIFICATION user instead of rejecting the transition", async () => {
    setUpUser("PENDING_VERIFICATION");
    const res = mockRes();

    await controller.approveUser(mockReq(), res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body?.data?.accountStatus).toBe("ACTIVE");
    expect(prismaMock.userStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ from: "PENDING_VERIFICATION", to: "ACTIVE" }),
      }),
    );
  });

  it("treats a second approve as a no-op success", async () => {
    setUpUser("ACTIVE");
    const res = mockRes();

    await controller.approveUser(mockReq(), res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body?.message).toBe("User already approved");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.userStatusHistory.create).not.toHaveBeenCalled();
  });

  it("refuses to approve a suspended user", async () => {
    setUpUser("SUSPENDED");
    const res = mockRes();

    await controller.approveUser(mockReq(), res as unknown as Response);

    expect(res.statusCode).toBe(409);
    expect(res.body?.error?.code).toBe("INVALID_STATUS_TRANSITION");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects a PENDING_VERIFICATION user with a reason", async () => {
    setUpUser("PENDING_VERIFICATION");
    const res = mockRes();

    await controller.rejectUser(
      mockReq({ reason: "Duplicate account" }),
      res as unknown as Response,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body?.data?.accountStatus).toBe("TERMINATED");
    expect(prismaMock.userStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          from: "PENDING_VERIFICATION",
          to: "TERMINATED",
          reason: "Duplicate account",
        }),
      }),
    );
  });

  it("treats a second reject as a no-op success", async () => {
    setUpUser("TERMINATED");
    const res = mockRes();

    await controller.rejectUser(
      mockReq({ reason: "Duplicate account" }),
      res as unknown as Response,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body?.message).toBe("User already rejected");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.userStatusHistory.create).not.toHaveBeenCalled();
  });
});
