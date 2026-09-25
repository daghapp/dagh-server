import { describe, expect, it, beforeEach, beforeAll, afterAll, vi } from "vitest";
import { updatePaymentControlSchema } from "../src/validator/payment-validator.js";
import {
  isPaymentsEnabled,
  getPaymentControlDetails,
  setPaymentControlStatus,
  _resetPaymentControlCache,
  PAYMENTS_DISABLED_MESSAGE,
} from "../src/config/payments.js";
import { prisma } from "../src/config/prisma.js";
import { initializePayment, initializePaymentMOMO } from "../src/services/payment.service.js";
import { AdminPaymentsConsoleController } from "../src/modules/admin/payments-console.controller.js";
import { PaymentTargetType, AuthProvider, AccountType } from "../generated/prisma/client.js";
import type { Request, Response } from "express";

function createMockRes(): {
  res: Response;
  json: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const status = vi.fn().mockImplementation(() => ({ json }));
  const res = {
    status,
    json,
  } as unknown as Response;
  return { res, json, status };
}

describe("Admin Payment Control", () => {
  const originalEnv = process.env.PAYMENTS_ENABLED;
  let testAdminId: string;

  beforeAll(async () => {
    // Create a real admin user for foreign key constraint testing
    const admin = await prisma.user.create({
      data: {
        email: `test-admin-${Date.now()}@example.com`,
        fullName: "Test Admin",
        accountType: AccountType.ADMIN,
        authProvider: AuthProvider.EMAIL,
      },
    });
    testAdminId = admin.id;
  });

  beforeEach(() => {
    _resetPaymentControlCache();
  });

  afterAll(async () => {
    process.env.PAYMENTS_ENABLED = originalEnv;
    // Clean up test setting and admin user
    try {
      await prisma.systemSetting.deleteMany({
        where: { key: "PAYMENTS_ENABLED" },
      });
      if (testAdminId) {
        await prisma.adminActivityLog.deleteMany({
          where: { actorId: testAdminId },
        });
        await prisma.user.delete({
          where: { id: testAdminId },
        });
      }
    } catch {
      // Ignore cleanup error
    }
  });

  describe("Schema Validation (updatePaymentControlSchema)", () => {
    it("accepts valid payload with enabled=true", () => {
      const result = updatePaymentControlSchema.safeParse({ enabled: true });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enabled).toBe(true);
      }
    });

    it("accepts valid payload with enabled=false and reason", () => {
      const result = updatePaymentControlSchema.safeParse({
        enabled: false,
        reason: "Scheduled maintenance until 14:00 GMT",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enabled).toBe(false);
        expect(result.data.reason).toBe("Scheduled maintenance until 14:00 GMT");
      }
    });

    it("rejects missing enabled property", () => {
      const result = updatePaymentControlSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = result.error.issues?.[0]?.message;
        expect(msg).toMatch(/boolean/i);
      }
    });

    it("rejects non-boolean enabled property", () => {
      const result = updatePaymentControlSchema.safeParse({ enabled: "true" });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = result.error.issues?.[0]?.message;
        expect(msg).toMatch(/boolean/i);
      }
    });

    it("rejects reason longer than 500 characters", () => {
      const result = updatePaymentControlSchema.safeParse({
        enabled: false,
        reason: "A".repeat(501),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = result.error.issues?.[0]?.message;
        expect(msg).toMatch(/500 characters/);
      }
    });
  });

  describe("Payment Control State & Persistence", () => {
    it("persists disabled status to DB and returns through getPaymentControlDetails", async () => {
      const updated = await setPaymentControlStatus({
        enabled: false,
        reason: "Testing disable",
        updatedBy: testAdminId,
      });

      expect(updated.enabled).toBe(false);
      expect(updated.reason).toBe("Testing disable");
      expect(updated.updatedBy).toBe(testAdminId);

      const current = await getPaymentControlDetails();
      expect(current.enabled).toBe(false);
      expect(current.reason).toBe("Testing disable");

      const isEnabled = await isPaymentsEnabled();
      expect(isEnabled).toBe(false);
    });

    it("persists re-enabled status to DB", async () => {
      const updated = await setPaymentControlStatus({
        enabled: true,
        reason: "Maintenance complete",
        updatedBy: testAdminId,
      });

      expect(updated.enabled).toBe(true);
      expect(updated.reason).toBe("Maintenance complete");

      const isEnabled = await isPaymentsEnabled();
      expect(isEnabled).toBe(true);
    });
  });

  describe("Payment Service Integration", () => {
    it("blocks initializePayment when payments are disabled", async () => {
      await setPaymentControlStatus({
        enabled: false,
        reason: "Maintenance window",
      });

      const result = await initializePayment({
        totalAmount: 100,
        description: "Test Tour Booking",
        returnUrl: "https://example.com/return",
        callbackUrl: "https://example.com/callback",
        cancellationUrl: "https://example.com/cancel",
        targetType: PaymentTargetType.TOUR_BOOKING,
        targetId: "00000000-0000-0000-0000-000000000000",
        userId: "00000000-0000-0000-0000-000000000000",
        currency: "GHS",
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe(PAYMENTS_DISABLED_MESSAGE);
      expect(result.paymentId).toBe("");
    });

    it("blocks initializePaymentMOMO when payments are disabled", async () => {
      await setPaymentControlStatus({
        enabled: false,
        reason: "Maintenance window",
      });

      const result = await initializePaymentMOMO({
        userId: "00000000-0000-0000-0000-000000000000",
        targetType: "TOUR_BOOKING",
        targetId: "00000000-0000-0000-0000-000000000000",
        amount: 50,
        currency: "GHS",
        method: "MTN_MOMO",
        provider: "HUBTEL",
        callbackUrl: "https://example.com/callback",
        customerPhone: "233241234567",
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe(PAYMENTS_DISABLED_MESSAGE);
      expect(result.paymentId).toBe("");
    });
  });

  describe("Admin Controller Integration", () => {
    const controller = new AdminPaymentsConsoleController();

    it("getControlStatus returns JSON with current state", async () => {
      await setPaymentControlStatus({
        enabled: true,
        reason: "All operational",
      });

      const { res, json } = createMockRes();
      const req = {} as Request;

      await controller.getControlStatus(req, res);

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            enabled: true,
            reason: "All operational",
          }),
        }),
      );
    });

    it("updateControlStatus returns 400 for invalid body", async () => {
      const { res, json, status } = createMockRes();
      const req = {
        body: { enabled: "not-a-boolean" },
        user: { id: testAdminId },
      } as unknown as Request;

      await controller.updateControlStatus(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
        }),
      );
    });

    it("updateControlStatus toggles state and writes admin activity log", async () => {
      const { res, json } = createMockRes();
      const req = {
        body: { enabled: false, reason: "Emergency payment processor pause" },
        user: { id: testAdminId },
      } as unknown as Request;

      await controller.updateControlStatus(req, res);

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            enabled: false,
            reason: "Emergency payment processor pause",
          }),
          message: "Payment system disabled successfully",
        }),
      );

      // Verify that admin activity log was created
      const activity = await prisma.adminActivityLog.findFirst({
        where: {
          actorId: testAdminId,
          action: "DISABLE_PAYMENTS",
        },
        orderBy: { createdAt: "desc" },
      });

      expect(activity).not.toBeNull();
      expect(activity?.note).toBe("Emergency payment processor pause");
    });

    it("updateControlStatus surfaces the gateway 409 instead of a 500", async () => {
      // This legacy endpoint is an alias for
      // PATCH /admin/settings/payment-gateway/processing, so it must inherit its
      // guard errors. An expected rejection is not a server fault, and reporting
      // it as 500 would send an operator looking in the wrong place.
      await prisma.paymentGatewayConfig.deleteMany({ where: { provider: "HUBTEL" } });
      // A row with no credentials exists but is NOT_CONNECTED, which is the
      // state that makes enabling invalid.
      await prisma.paymentGatewayConfig.create({
        data: { provider: "HUBTEL" },
      });

      try {
        const { res, json, status } = createMockRes();
        const req = {
          body: { enabled: true },
          user: { id: testAdminId },
        } as unknown as Request;

        await controller.updateControlStatus(req, res);

        expect(status).toHaveBeenCalledWith(409);
        expect(json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
          }),
        );
      } finally {
        await prisma.adminActivityLog.deleteMany({ where: { actorId: testAdminId } });
        await prisma.paymentGatewayConfig.deleteMany({ where: { provider: "HUBTEL" } });
      }
    });
  });
});
