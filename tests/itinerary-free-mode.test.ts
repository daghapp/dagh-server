import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import type { Request, Response } from "express";
import { prisma } from "../src/config/prisma.js";
import { ItineraryPaymentController } from "../src/modules/itinerary/itinerary.payment.controller.js";
import { setPaymentControlStatus, _resetPaymentControlCache } from "../src/config/payments.js";
import { _resetFreeModeCache } from "../src/helpers/membership.js";
import { AuthProvider, AccountType, TourType, PaymentStatus } from "../generated/prisma/client.js";

/**
 * The itinerary fee is released while payments are off.
 *
 * Regression guard: the itinerary gate is tour_request.paymentStatus, not a
 * membership tier, so free mode does not reach it by itself. Before this was
 * handled explicitly, disabling payments skipped the charge and then locked the
 * user out of the itinerary — the feature stayed unreachable for the whole
 * outage, which is the exact failure free mode exists to prevent.
 */
describe("Itinerary fee under free mode", () => {
  const stamp = Date.now();
  const controller = new ItineraryPaymentController();

  let userId: string;
  let requestId: string;

  async function setPayments(enabled: boolean) {
    await setPaymentControlStatus({ enabled, reason: enabled ? null : "Itinerary free-mode test" });
    _resetPaymentControlCache();
    _resetFreeModeCache();
  }

  function call(tourRequestId: string) {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { json, status } as unknown as Response;
    const req = {
      user: { id: userId },
      params: { tourRequestId },
    } as unknown as Request;

    return { req, res, json, status, run: () => controller.initiateItineraryPayment(req, res) };
  }

  async function resetRequest(paymentStatus = PaymentStatus.INITIALIZED) {
    await prisma.tourRequest.update({
      where: { id: requestId },
      data: { paymentStatus, paymentId: null, feeWaived: false },
    });
  }

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `itinerary-free-mode-${stamp}@example.com`,
        fullName: "Itinerary Free Mode",
        accountType: AccountType.USER,
        authProvider: AuthProvider.EMAIL,
      },
    });
    userId = user.id;

    const tourRequest = await prisma.tourRequest.create({
      data: { userId, tourType: TourType.SINGLE, durationDays: 5 },
    });
    requestId = tourRequest.id;
  });

  afterAll(async () => {
    await prisma.tourRequest.deleteMany({ where: { id: requestId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.systemSetting.deleteMany({ where: { key: "PAYMENTS_ENABLED" } });
  });

  it("waives the fee and marks the request paid when payments are off", async () => {
    await resetRequest();
    await setPayments(false);
    try {
      const { run, json, status } = call(requestId);
      await run();

      expect(status).not.toHaveBeenCalledWith(503);
      expect(status).not.toHaveBeenCalledWith(400);
      const body = json.mock.calls[0]?.[0];

      expect(body.data.paymentId).toBeNull();
      expect(body.data.freeMode).toBe(true);
      expect(body.data.checkoutUrl).toBeNull();

      // The whole point: the gate in itinerary.service.ts reads this column, so
      // it must be SUCCESS or the itinerary stays locked.
      const row = await prisma.tourRequest.findUniqueOrThrow({ where: { id: requestId } });
      expect(row.paymentStatus).toBe("SUCCESS");
      expect(row.paymentId).toBeNull();
      expect(row.feeWaived).toBe(true);
    } finally {
      await setPayments(true);
    }
  });

  it("still charges when payments are enabled", async () => {
    await setPayments(true);
    await resetRequest();

    // No gateway credentials in test env, so Hubtel initialization fails. What
    // matters is that the request is NOT marked paid for free.
    const { run } = call(requestId);
    await run();

    const row = await prisma.tourRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(row.paymentStatus).not.toBe("SUCCESS");
    expect(row.feeWaived).toBe(false);
  });

  it("keeps the request paid after payments come back on", async () => {
    // Free mode elsewhere is a resolution-time grant that persists nothing, but
    // here SUCCESS is written on purpose: a user who generated an itinerary
    // during the outage must not be locked out of the itinerary row that
    // already exists once processing resumes.
    await setPayments(false);
    await resetRequest();
    const run = call(requestId);
    await run.run();

    await setPayments(true);

    const row = await prisma.tourRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(row.paymentStatus).toBe("SUCCESS");
    expect(row.paymentId).toBeNull();
    expect(row.feeWaived).toBe(true);

    // And the endpoint does not re-charge an already-paid request — a second
    // call must not reset it to PENDING, which would lock the user out of the
    // itinerary row that already exists.
    const second = call(requestId);
    await second.run();
    expect(second.json.mock.calls[0]?.[0].data.alreadyPaid).toBe(true);
    expect(second.json.mock.calls[0]?.[0].data.freeMode).toBe(true);
    expect(second.json.mock.calls[0]?.[0].data.paymentId).toBeNull();

    const after = await prisma.tourRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(after.paymentStatus).toBe("SUCCESS");
    expect(after.paymentId).toBeNull();
    expect(after.feeWaived).toBe(true);
  });

  it("refuses a request belonging to another user", async () => {
    await resetRequest();
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const req = {
      user: { id: "some-other-user" },
      params: { tourRequestId: requestId },
    } as unknown as Request;

    await controller.initiateItineraryPayment(req, { json, status } as unknown as Response);

    expect(status).toHaveBeenCalledWith(403);
    const row = await prisma.tourRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(row.paymentStatus).not.toBe("SUCCESS");
  });
});
