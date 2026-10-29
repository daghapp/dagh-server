import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { prisma } from "../src/config/prisma.js";
import { ItineraryPaymentController } from "../src/modules/itinerary/itinerary.payment.controller.js";
import { AdminAccessGrantsConsoleController } from "../src/modules/admin/access-grants-console.controller.js";
import { subscribeToPlan } from "../src/services/membership.service.js";
import { initializePayment } from "../src/services/payment.service.js";
import { hasServiceFeeWaiver, _resetFreeModeCache } from "../src/helpers/membership.js";
import { setPaymentControlStatus, _resetPaymentControlCache } from "../src/config/payments.js";
import { ensurePlans } from "./helpers/plans.js";
import {
  AccountType,
  AuthProvider,
  PaymentStatus,
  PaymentTargetType,
  TourType,
} from "../generated/prisma/client.js";

/**
 * Admin-controlled lifetime free access.
 *
 * A perpetual SubscriptionAccessGrant with waiveServiceFees=true must make the
 * user exempt from every service charge: itinerary, tour bookings and paid
 * membership plans. These tests exercise the gates with payments fully enabled,
 * so a pass cannot be explained by the global kill switch.
 */
describe("Lifetime free access", () => {
  const stamp = Date.now();
  const controller = new ItineraryPaymentController();

  let adminId: string;
  let waivedUserId: string;
  let subscriberUserId: string;
  let emailTargetId: string;
  let waivedGrantId: string;
  let tourRequestId: string;
  let basicPlanId: string;
  let originalPlanPrice: number | null = null;

  async function setPayments(enabled: boolean) {
    await setPaymentControlStatus({
      enabled,
      reason: enabled ? null : "Lifetime free access test",
    });
    _resetPaymentControlCache();
    _resetFreeModeCache();
  }

  function initiatePayment(tourRequestId: string, userId: string) {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const req = {
      user: { id: userId },
      params: { tourRequestId },
    } as unknown as Request;

    return {
      run: () => controller.initiateItineraryPayment(req, { json, status } as unknown as Response),
      json,
      status,
    };
  }

  beforeAll(async () => {
    await setPayments(true);
    await ensurePlans(["FREE", "BASIC"]);

    const admin = await prisma.user.create({
      data: {
        email: `lifetime-admin-${stamp}@example.com`,
        fullName: "Lifetime Admin",
        accountType: AccountType.ADMIN,
        authProvider: AuthProvider.EMAIL,
      },
    });
    adminId = admin.id;

    const waived = await prisma.user.create({
      data: {
        email: `lifetime-free-${stamp}@example.com`,
        fullName: "Lifetime Free",
        accountType: AccountType.USER,
        authProvider: AuthProvider.EMAIL,
      },
    });
    waivedUserId = waived.id;

    const subscriber = await prisma.user.create({
      data: {
        email: `lifetime-subscriber-${stamp}@example.com`,
        fullName: "Lifetime Subscriber",
        accountType: AccountType.USER,
        authProvider: AuthProvider.EMAIL,
      },
    });
    subscriberUserId = subscriber.id;

    const emailTarget = await prisma.user.create({
      data: {
        email: `Email-Target-${stamp}@Example.com`,
        fullName: "Email Target",
        accountType: AccountType.USER,
        authProvider: AuthProvider.EMAIL,
      },
    });
    emailTargetId = emailTarget.id;

    const grant = await prisma.subscriptionAccessGrant.create({
      data: {
        userId: waivedUserId,
        tierCode: "BASELINE",
        includePaidPerks: false,
        waiveServiceFees: true,
        reason: "Lifetime free access test",
        endDate: null,
        grantedById: adminId,
      },
    });
    waivedGrantId = grant.id;

    const tourRequest = await prisma.tourRequest.create({
      data: {
        userId: waivedUserId,
        tourType: TourType.SINGLE,
        durationDays: 5,
        paymentStatus: PaymentStatus.INITIALIZED,
      },
    });
    tourRequestId = tourRequest.id;

    const basicPlan = await prisma.membershipPlan.findUniqueOrThrow({ where: { code: "BASIC" } });
    basicPlanId = basicPlan.id;
    if (basicPlan.price <= 0) {
      originalPlanPrice = basicPlan.price;
      await prisma.membershipPlan.update({ where: { id: basicPlanId }, data: { price: 50 } });
    }
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({
      where: { userId: { in: [waivedUserId, subscriberUserId] } },
    });
    await prisma.userSubscription.deleteMany({
      where: { userId: { in: [waivedUserId, subscriberUserId] } },
    });
    await prisma.tourRequest.deleteMany({ where: { userId: waivedUserId } });
    await prisma.subscriptionAccessGrant.deleteMany({
      where: { OR: [{ id: waivedGrantId }, { userId: emailTargetId }] },
    });
    await prisma.adminActivityLog.deleteMany({ where: { actorId: adminId } });
    await prisma.user.deleteMany({
      where: { id: { in: [adminId, waivedUserId, subscriberUserId, emailTargetId] } },
    });
    await prisma.systemSetting.deleteMany({ where: { key: "PAYMENTS_ENABLED" } });

    if (originalPlanPrice !== null) {
      await prisma.membershipPlan.update({
        where: { id: basicPlanId },
        data: { price: originalPlanPrice },
      });
    }
  });

  it("resolves the waiver from the grant", async () => {
    expect(await hasServiceFeeWaiver(waivedUserId)).toBe(true);
    expect(await hasServiceFeeWaiver(subscriberUserId)).toBe(false);
  });

  it("waives the itinerary fee even though payments are enabled", async () => {
    const { run, json, status } = initiatePayment(tourRequestId, waivedUserId);
    await run();

    expect(status).not.toHaveBeenCalledWith(401);
    expect(status).not.toHaveBeenCalledWith(403);
    expect(status).not.toHaveBeenCalledWith(500);

    const body = json.mock.calls[0]?.[0];
    expect(body.data.waiveServiceFees).toBe(true);
    expect(body.data.freeMode).toBe(false);
    expect(body.data.checkoutUrl).toBeNull();

    const row = await prisma.tourRequest.findUniqueOrThrow({ where: { id: tourRequestId } });
    expect(row.paymentStatus).toBe("SUCCESS");
    expect(row.paymentId).toBeNull();
    expect(row.feeWaived).toBe(true);
  });

  it("resolves the grantee from a case-insensitive email", async () => {
    const controller = new AdminAccessGrantsConsoleController();
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const req = {
      user: { id: adminId },
      body: {
        email: `email-target-${stamp}@example.COM`,
        tierCode: "BASIC",
        waiveServiceFees: true,
        reason: "Email lookup test",
        endDate: null,
      },
    } as unknown as Request;

    await controller.create(req, { json, status } as unknown as Response);

    expect(status).toHaveBeenCalledWith(201);
    const body = json.mock.calls[0]?.[0];
    expect(body.success).toBe(true);
    expect(body.data.userId).toBe(emailTargetId);
    expect(body.data.waiveServiceFees).toBe(true);
  });

  it("refuses a paid-plan checkout for a waived user without creating a subscription", async () => {
    const result = await subscribeToPlan(waivedUserId, {
      planId: basicPlanId,
      returnUrl: "https://example.com/return",
      callbackUrl: "https://example.com/membership/callback",
    });

    if (!result.success) throw new Error(`expected success, got ${result.code}`);

    expect(result.data?.checkoutUrl).toBeNull();
    expect(result.data?.waiveServiceFees).toBe(true);
    expect(result.data?.subscriptionId).toBeNull();

    // The admin's grant is the entitlement. Writing a free paid-tier row here
    // would outlive a revoked waiver, so no row is written at all.
    const subscription = await prisma.userSubscription.findUnique({
      where: { userId: waivedUserId },
    });
    expect(subscription).toBeNull();
  });

  it("refuses to initialize any payment for a waived user", async () => {
    const result = await initializePayment({
      userId: waivedUserId,
      targetType: PaymentTargetType.TOUR_BOOKING,
      targetId: tourRequestId,
      totalAmount: 100,
      currency: "GHS",
      description: "Lifetime free access guard",
      returnUrl: "https://example.com/return",
      callbackUrl: "https://example.com/callback",
      cancellationUrl: "https://example.com/cancel",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("exempt");

    const payments = await prisma.payment.count({ where: { userId: waivedUserId } });
    expect(payments).toBe(0);
  });

  it("drops the exemption when the grant is revoked", async () => {
    await prisma.subscriptionAccessGrant.update({
      where: { id: waivedGrantId },
      data: { revokedAt: new Date(), revokedById: adminId },
    });

    expect(await hasServiceFeeWaiver(waivedUserId)).toBe(false);
  });
});
