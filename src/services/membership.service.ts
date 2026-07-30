// ─────────────────────────────────────────
// Membership Service — Plans, Subscriptions, Support
// ─────────────────────────────────────────
// Orchestrates membership plan CRUD, user subscription lifecycle (free & paid),
// Hubtel payment initialization for paid tier upgrades, and priority support ticketing.

import { prisma } from "../config/index.js";
import * as paymentService from "./payment.service.js";
import {
  PaymentStatus,
  PaymentTargetType,
  SubscriptionStatus,
} from "../../generated/prisma/client.js";
import type { SubscribeMembershipSchema, PrioritySupportSchema } from "../validator/index.js";

// Generates a random member code in the format "89345-SGF" and checks uniqueness in the DB.
// Retries up to 5 times on collision before throwing.
async function generateUniqueMemberCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const digits = Math.floor(10000 + Math.random() * 90000).toString();
    const letters = Array.from({ length: 3 }, () =>
      String.fromCharCode(65 + Math.floor(Math.random() * 26)),
    ).join("");
    const code = `${digits}-${letters}`;
    const existing = await prisma.userSubscription.findUnique({ where: { memberCode: code } });
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique member code after 5 attempts");
}

// Fetches all active membership plans sorted by price ascending
// Used by the public GET /api/membership/plans endpoint
export async function getMembershipPlans() {
  const plans = await prisma.membershipPlan.findMany({
    where: { isActive: true },
    orderBy: { price: "asc" },
  });
  return plans;
}

// Subscribes a user to a membership plan
// - Free plans: activates immediately via upsert, generates memberCode if missing
// - Paid plans: initializes a Hubtel checkout payment; activation happens in the callback handler
// Returns the payment initialization result or the activated subscription
export async function subscribeToPlan(userId: string, payload: SubscribeMembershipSchema) {
  const plan = await prisma.membershipPlan.findUnique({
    where: { id: payload.planId },
  });

  if (!plan) {
    return { success: false, message: "Plan not found", paymentId: "", paymentStatus: "" };
  }

  if (!plan.isActive) {
    return { success: false, message: "Plan is not active", paymentId: "", paymentStatus: "" };
  }

  // Free plan — activate immediately without payment
  if (plan.price === 0) {
    const subscription = await prisma.userSubscription.upsert({
      where: { userId },
      update: {
        planId: plan.id,
        tierCode: plan.code,
        startDate: new Date(),
        endDate: null,
        status: SubscriptionStatus.ACTIVE,
      },
      create: {
        userId,
        planId: plan.id,
        tierCode: plan.code,
        memberCode: await generateUniqueMemberCode(),
        startDate: new Date(),
        status: SubscriptionStatus.ACTIVE,
      },
    });

    // Ensure memberCode exists (covers migrations from pre-memberCode schema)
    if (!subscription.memberCode) {
      await prisma.userSubscription.update({
        where: { id: subscription.id },
        data: { memberCode: await generateUniqueMemberCode() },
      });
    }

    return {
      success: true,
      message: "Free plan activated successfully",
      paymentId: "",
      paymentStatus: "SUCCESS",
      subscription,
      paymentRequired: false,
    };
  }

  // Paid plan — initialize Hubtel checkout; subscription activated on callback
  const paymentResponse = await paymentService.initializePayment({
    userId,
    targetType: PaymentTargetType.MEMBERSHIP_SUBSCRIPTION,
    targetId: plan.id,
    totalAmount: plan.price,
    currency: plan.currency,
    description: `Subscription to ${plan.name}`,
    callbackUrl: payload.callbackUrl,
    returnUrl: payload.returnUrl,
    cancellationUrl: payload.cancellationUrl || payload.returnUrl,
  });

  return {
    ...paymentResponse,
    paymentRequired: true,
  };
}

// Returns the current user's subscription with the associated plan details
// If no subscription exists yet, returns a virtual FREE-tier response
export async function getUserSubscription(userId: string) {
  const subscription = await prisma.userSubscription.findUnique({
    where: { userId },
    include: { plan: true },
  });

  if (!subscription) {
    const freePlan = await prisma.membershipPlan.findUnique({
      where: { code: "FREE" },
    });

    return {
      tierCode: "FREE" as const,
      plan: freePlan || null,
      memberCode: null,
      startDate: null,
      endDate: null,
      status: "ACTIVE",
      autoRenew: false,
    };
  }

  return subscription;
}

// Creates a priority support ticket for active paid-tier members
// Throws if the user is on FREE tier or their subscription is not active
export async function createPrioritySupportRequest(userId: string, payload: PrioritySupportSchema) {
  const subscription = await prisma.userSubscription.findUnique({
    where: { userId },
  });

  if (!subscription || subscription.tierCode === "FREE") {
    throw new Error("Priority support is only available for paid tier members");
  }

  if (subscription.status !== SubscriptionStatus.ACTIVE) {
    throw new Error("Your subscription is not active");
  }

  const request = await prisma.prioritySupportRequest.create({
    data: {
      subscriptionId: subscription.id,
      userId,
      subject: payload.subject,
      message: payload.message,
    },
  });

  return request;
}

// Computes the subscription endDate by adding the plan's interval to the current date.
// Uses calendar-aware date math (not fixed 30-day months).
function computeEndDate(interval: string, start: Date): Date | null {
  const d = new Date(start);
  switch (interval) {
    case "MONTHLY":
      d.setMonth(d.getMonth() + 1);
      break;
    case "ANNUAL":
      d.setFullYear(d.getFullYear() + 1);
      break;
    case "BIENNIAL":
      d.setFullYear(d.getFullYear() + 2);
      break;
    default:
      return null;
  }
  return d;
}

// Handles Hubtel payment callbacks for membership subscription payments
// Finds the payment by client reference, activates/upgrades the user's subscription on success,
// and calculates the endDate based on the plan's billing interval.
// Idempotent: skips if the payment has already been processed (status !== INITIALIZED).
export async function handleSubscriptionPaymentCallback(
  clientReference: string,
  status: PaymentStatus,
) {
  const payment = await prisma.payment.findUnique({
    where: { reference: clientReference },
  });

  if (!payment) {
    throw new Error(`Payment not found for reference: ${clientReference}`);
  }

  // Idempotency guard — only process payments still in INITIALIZED state
  if (payment.status !== PaymentStatus.INITIALIZED) {
    return { payment };
  }

  if (
    status === PaymentStatus.SUCCESS &&
    payment.targetType === PaymentTargetType.MEMBERSHIP_SUBSCRIPTION
  ) {
    const plan = await prisma.membershipPlan.findUnique({
      where: { id: payment.targetId },
    });

    if (!plan) {
      throw new Error("Membership plan not found");
    }

    const now = new Date();
    const endDate = computeEndDate(plan.interval, now);

    const subscription = await prisma.userSubscription.upsert({
      where: { userId: payment.userId },
      update: {
        planId: plan.id,
        tierCode: plan.code,
        startDate: now,
        endDate,
        status: SubscriptionStatus.ACTIVE,
      },
      create: {
        userId: payment.userId,
        planId: plan.id,
        tierCode: plan.code,
        memberCode: await generateUniqueMemberCode(),
        startDate: now,
        endDate,
        status: SubscriptionStatus.ACTIVE,
      },
    });

    if (!subscription.memberCode) {
      await prisma.userSubscription.update({
        where: { id: subscription.id },
        data: { memberCode: await generateUniqueMemberCode() },
      });
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.SUCCESS },
    });

    return { subscription, plan };
  }

  // Payment failed — mark the payment record accordingly
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: PaymentStatus.FAILED },
  });

  return { payment };
}
