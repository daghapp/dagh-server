import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import {
  AccountStatus,
  AccountType,
  AuthProvider,
  MembershipTierCode,
} from "../generated/prisma/client.js";
import { prisma } from "../src/config/prisma.js";
import * as bcrypt from "bcrypt";
import { AuthAdminController } from "../src/modules/authentication/auth-admin.controller.js";

/**
 * Admin DELETE is a SOFT delete (spec §3.7): the record is kept with
 * isDeleted/deletedAt for audit, so the old RESTRICT drama no longer applies —
 * no audit purge, no grant nulling. These tests pin the soft-delete contract:
 * the row survives, the trail survives, and access grants are untouched.
 * (Self-service DELETE /profile/account below still hard-deletes.)
 */

const controller = new AuthAdminController();

let issuerId: string;
let granteeId: string;
let actingAdminId: string;

function mockRes(): {
  res: Response;
  json: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
} {
  // Express-faithful mock: res.status()/res.json() return `res` (truthy), which
  // is what the controllers' `if (unauthorizedResponse) return ...` guards rely
  // on. A bare vi.fn() returns undefined and would let execution continue past
  // a rejection — masking exactly the guard under test.
  const res = {} as unknown as Response;
  const jsonMock = vi.fn().mockReturnValue(res);
  const statusMock = vi.fn().mockReturnValue(res);
  res.json = jsonMock as never;
  res.status = statusMock as never;
  return { res, json: jsonMock, status: statusMock };
}

/** The caller is an admin (accountType) deleting `targetId` from params. */
function adminReq(targetId: string): Request {
  return {
    user: { id: actingAdminId, accountType: "ADMIN" },
    params: { userId: targetId },
  } as unknown as Request;
}

async function createUser(accountType: AccountType, email: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      authProvider: AuthProvider.EMAIL,
      email,
      fullName: email,
      accountType,
      accountStatus: AccountStatus.ACTIVE,
    },
  });
  return user.id;
}

beforeEach(async () => {
  issuerId = await createUser(AccountType.ADMIN, `issuer-${Date.now()}@test.local`);
  granteeId = await createUser(AccountType.USER, `grantee-${Date.now()}@test.local`);
  actingAdminId = await createUser(AccountType.ADMIN, `acting-${Date.now()}@test.local`);
});

afterEach(async () => {
  // Issued grants null out on delete, so clear the survivors explicitly. Audit
  // rows are RESTRICT, so they must be purged before the users or this cleanup
  // trips the very constraint the tests are about.
  await prisma.subscriptionAccessGrant.deleteMany({
    where: { userId: { in: [granteeId, issuerId] } },
  });
  await prisma.adminActivityLog.deleteMany({
    where: { actorId: { in: [issuerId, actingAdminId] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [issuerId, granteeId, actingAdminId] } },
  });
});

describe("admin deleteUser against RESTRICT foreign keys", () => {
  it("soft-deletes an admin who has audit-log rows and issued an access grant", async () => {
    // The exact combination that used to 500 on hard delete. Soft delete
    // touches only the users row, so neither RESTRICT fires.
    await prisma.adminActivityLog.create({
      data: {
        actorId: issuerId,
        entityType: "USER",
        entityId: granteeId,
        action: "APPROVED",
      },
    });
    await prisma.subscriptionAccessGrant.create({
      data: {
        userId: granteeId,
        tierCode: MembershipTierCode.SILVER,
        reason: "Test comp",
        grantedById: issuerId,
      },
    });

    const { res, json } = mockRes();
    await controller.deleteUser(adminReq(issuerId), res);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: "User deleted successfully" }),
    );
    const row = await prisma.user.findUnique({ where: { id: issuerId } });
    expect(row).not.toBeNull();
    expect(row!.isDeleted).toBe(true);
    expect(row!.deletedAt).not.toBeNull();
  });

  it("keeps the deleted user's audit rows instead of purging them", async () => {
    await prisma.adminActivityLog.create({
      data: {
        actorId: issuerId,
        entityType: "USER",
        action: "APPROVED",
      },
    });

    const { res } = mockRes();
    await controller.deleteUser(adminReq(issuerId), res);

    await expect(prisma.adminActivityLog.count({ where: { actorId: issuerId } })).resolves.toBe(1);
  });

  it("leaves issued grants fully untouched when the issuer's account goes", async () => {
    // Soft delete keeps the issuer row, so the grant survives with its
    // grantedById intact — no nulling, no revocation.
    const grant = await prisma.subscriptionAccessGrant.create({
      data: {
        userId: granteeId,
        tierCode: MembershipTierCode.GOLD_INVESTOR,
        includePaidPerks: true,
        reason: "Board member",
        grantedById: issuerId,
      },
    });

    const { res } = mockRes();
    await controller.deleteUser(adminReq(issuerId), res);

    const surviving = await prisma.subscriptionAccessGrant.findUnique({
      where: { id: grant.id },
    });
    expect(surviving).not.toBeNull();
    expect(surviving!.userId).toBe(granteeId);
    expect(surviving!.tierCode).toBe(MembershipTierCode.GOLD_INVESTOR);
    expect(surviving!.grantedById).toBe(issuerId);
  });

  it("leaves other admins' audit rows untouched", async () => {
    // The purge is scoped to the actor, so deleting one admin must not quietly
    // erase the audit trail of the admin who performed the deletion.
    const acting = await prisma.adminActivityLog.create({
      data: { actorId: actingAdminId, entityType: "USER", action: "APPROVED" },
    });

    const { res } = mockRes();
    await controller.deleteUser(adminReq(issuerId), res);

    await expect(
      prisma.adminActivityLog.findUnique({ where: { id: acting.id } }),
    ).resolves.not.toBeNull();
  });

  it("does not leak the Prisma error detail to the client on failure", async () => {
    // The previous version returned error.message, which surfaced the Prisma
    // error code and the failing constraint/table names.
    const { res, json, status } = mockRes();
    const boom = new Error("Foreign key constraint failed on the field: grantedById");
    const spy = vi.spyOn(prisma.user, "findUnique").mockRejectedValueOnce(boom);

    await controller.deleteUser(adminReq(issuerId), res);
    spy.mockRestore();

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0]?.[0];
    expect(body?.error).toBe("Failed to delete user");
    // The old signature passed error.message as `details`, which is where the
    // Prisma code and constraint name used to reach the client.
    expect(body?.details).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("Foreign key constraint");
  });

  it("404s an unknown user", async () => {
    const { res, status } = mockRes();
    await controller.deleteUser(adminReq("00000000-0000-0000-0000-000000000000"), res);

    expect(status).toHaveBeenCalledWith(404);
  });

  it("403s a non-admin caller", async () => {
    const { res, status, json } = mockRes();
    await controller.deleteUser(
      {
        user: { id: granteeId, accountType: "USER" },
        params: { userId: granteeId },
      } as unknown as Request,
      res,
    );

    expect(status).toHaveBeenCalledWith(403);
    // The rejection must stop the handler: exactly one response, no trail, no delete.
    expect(json).toHaveBeenCalledTimes(1);
    await expect(
      prisma.user.findUnique({ where: { id: granteeId }, select: { isDeleted: true } }),
    ).resolves.toEqual({ isDeleted: false });
    await expect(prisma.adminActivityLog.count({ where: { actorId: granteeId } })).resolves.toBe(0);
  });
});

// ─────────────────────────────────────────
// Self-service deletion: DELETE /profile/account
// ─────────────────────────────────────────
// The reported symptom was a user who had comped somebody into a tier being
// unable to delete their own account at all — an opaque 500 with the delete
// rolled back. Same root cause, opposite code path.

const { deleteAccount } =
  await import("../src/modules/profile-management/account-profile.controller.js");

const PASSWORD = "correct-horse-battery";

function selfReq(userId: string, body: Record<string, unknown> = {}): Request {
  return { user: { id: userId }, body } as unknown as Request;
}

describe("self-service deleteAccount against RESTRICT foreign keys", () => {
  it("deletes a user who has issued an access grant", async () => {
    await prisma.subscriptionAccessGrant.create({
      data: {
        userId: granteeId,
        tierCode: MembershipTierCode.SILVER,
        reason: "Issued by the user deleting themselves",
        grantedById: issuerId,
      },
    });

    const { res, json } = mockRes();
    await deleteAccount(selfReq(issuerId), res);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: "Account deleted successfully" }),
    );
    await expect(prisma.user.findUnique({ where: { id: issuerId } })).resolves.toBeNull();
  });

  it("leaves the comped recipient's access intact", async () => {
    const grant = await prisma.subscriptionAccessGrant.create({
      data: {
        userId: granteeId,
        tierCode: MembershipTierCode.ELITE_AMBASSADOR,
        reason: "Must survive the issuer's departure",
        grantedById: issuerId,
      },
    });

    const { res } = mockRes();
    await deleteAccount(selfReq(issuerId), res);

    const surviving = await prisma.subscriptionAccessGrant.findUnique({ where: { id: grant.id } });
    expect(surviving).not.toBeNull();
    expect(surviving!.tierCode).toBe(MembershipTierCode.ELITE_AMBASSADOR);
    expect(surviving!.grantedById).toBeNull();
  });

  it("deletes a password-holding user who also has audit rows", async () => {
    await prisma.user.update({
      where: { id: issuerId },
      data: { passwordHash: await bcrypt.hash(PASSWORD, 10) },
    });
    await prisma.adminActivityLog.create({
      data: { actorId: issuerId, entityType: "USER", action: "APPROVED" },
    });

    const { res, json } = mockRes();
    await deleteAccount(selfReq(issuerId, { password: PASSWORD }), res);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: "Account deleted successfully" }),
    );
    await expect(prisma.adminActivityLog.count({ where: { actorId: issuerId } })).resolves.toBe(0);
  });

  it("refuses a wrong password and leaves the account in place", async () => {
    await prisma.user.update({
      where: { id: issuerId },
      data: { passwordHash: await bcrypt.hash(PASSWORD, 10) },
    });

    const { res, status, json } = mockRes();
    await deleteAccount(selfReq(issuerId, { password: "wrong" }), res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0]?.[0]?.error).toBe("Incorrect password");
    await expect(prisma.user.findUnique({ where: { id: issuerId } })).resolves.not.toBeNull();
  });

  it("refuses a missing password on a password-holding account", async () => {
    await prisma.user.update({
      where: { id: issuerId },
      data: { passwordHash: await bcrypt.hash(PASSWORD, 10) },
    });

    const { res, status } = mockRes();
    await deleteAccount(selfReq(issuerId), res);

    expect(status).toHaveBeenCalledWith(400);
    await expect(prisma.user.findUnique({ where: { id: issuerId } })).resolves.not.toBeNull();
  });
});
