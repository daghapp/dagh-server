// ─────────────────────────────────────────
// Membership Service — Plans, Subscriptions, Support
// ─────────────────────────────────────────
// Orchestrates membership plan CRUD, user subscription lifecycle (free & paid),
// Hubtel payment initialization for paid tier upgrades, and priority support ticketing.

import { prisma } from "../config/index.js";
import * as paymentService from "./payment.service.js";
import type { HubtelCheckoutResponse } from "./payment.service.js";
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

  if (!plan || !plan.isActive) {
    return { success: false, code: "INVALID_PLAN_ID", message: "Plan does not exist or is inactive" };
  }

  const existingSub = await prisma.userSubscription.findUnique({ where: { userId } });
  if (existingSub && existingSub.planId === plan.id && existingSub.status === "ACTIVE") {
    return { success: false, code: "SUBSCRIPTION_ALREADY_ACTIVE", message: "User already has the requested active plan" };
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

    if (!subscription.memberCode) {
      await prisma.userSubscription.update({
        where: { id: subscription.id },
        data: { memberCode: await generateUniqueMemberCode() },
      });
    }

    return {
      success: true,
      message: "Free membership activated successfully.",
      data: {
        subscriptionId: subscription.id,
        status: "ACTIVE",
        checkoutUrl: null
      }
    };
  }

  // Paid plan — initialize Hubtel checkout; subscription activated on callback
  let paymentResponse;
  try {
    paymentResponse = await paymentService.initializePayment({
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
  } catch (error) {
    console.error("[MEMBERSHIP_CHECKOUT_PROVIDER_ERROR]", {
      userId,
      planId: plan.id,
      planPrice: plan.price,
      planCurrency: plan.currency,
      planInterval: plan.interval,
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, code: "PAYMENT_PROVIDER_ERROR", message: "Payment provider returned an error" };
  }

  if (!paymentResponse.success) {
    console.error("[MEMBERSHIP_CHECKOUT_FAILED]", {
      userId,
      planId: plan.id,
      planPrice: plan.price,
      planCurrency: plan.currency,
      providerMessage: paymentResponse.message,
    });
    return { success: false, code: "CHECKOUT_INITIALIZATION_FAILED", message: paymentResponse.message };
  }

  const hubtelData = (paymentResponse.data as HubtelCheckoutResponse | undefined);
  const rawUrl = hubtelData?.data?.checkoutUrl;

  // Checkout URL validation — reject anything that won't open in a browser
  if (!rawUrl || typeof rawUrl !== "string") {
    console.error("[MEMBERSHIP_CHECKOUT_NO_URL]", {
      userId,
      planId: plan.id,
      providerResponseCode: hubtelData?.responseCode,
    });
    return { success: false, code: "CHECKOUT_INITIALIZATION_FAILED", message: "Provider could not create checkout (missing URL)" };
  }

  if (rawUrl.includes("`") || rawUrl.includes('"') || rawUrl.includes("'") ||
      rawUrl.includes(" ") || rawUrl.includes("{") || rawUrl.includes("}") ||
      rawUrl.includes("[") || rawUrl.includes("]") || rawUrl.includes("\\") ||
      rawUrl.includes("\n") || rawUrl.includes("\r") || rawUrl.includes("\t")) {
    console.error("[MEMBERSHIP_CHECKOUT_MALFORMED_URL]", {
      userId,
      planId: plan.id,
      urlLength: rawUrl.length,
    });
    return { success: false, code: "CHECKOUT_INITIALIZATION_FAILED", message: "Provider returned malformed URL" };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    console.error("[MEMBERSHIP_CHECKOUT_INVALID_URL]", {
      userId,
      planId: plan.id,
      rawUrlPrefix: rawUrl.substring(0, 50),
    });
    return { success: false, code: "CHECKOUT_INITIALIZATION_FAILED", message: "Provider returned invalid URL format" };
  }

  if (process.env.NODE_ENV === "production" && parsedUrl.protocol !== "https:") {
    console.error("[MEMBERSHIP_CHECKOUT_HTTP_URL]", {
      userId,
      planId: plan.id,
      urlProtocol: parsedUrl.protocol,
    });
    return { success: false, code: "CHECKOUT_INITIALIZATION_FAILED", message: "Checkout URL must use HTTPS in production" };
  }

  if (!parsedUrl.hostname || parsedUrl.hostname === "localhost") {
    console.error("[MEMBERSHIP_CHECKOUT_BAD_HOSTNAME]", {
      userId,
      planId: plan.id,
      hostname: parsedUrl.hostname,
    });
    return { success: false, code: "CHECKOUT_INITIALIZATION_FAILED", message: "Checkout URL has invalid hostname" };
  }

  console.log("[MEMBERSHIP_CHECKOUT_URL_VALIDATED]", {
    userId,
    planId: plan.id,
    planPrice: plan.price,
    planCurrency: plan.currency,
    urlProtocol: parsedUrl.protocol,
    urlHostname: parsedUrl.hostname,
  });

  const subscription = await prisma.userSubscription.upsert({
    where: { userId },
    update: {
      planId: plan.id,
      tierCode: plan.code,
      startDate: new Date(),
      status: SubscriptionStatus.PAYMENT_PENDING,
    },
    create: {
      userId,
      planId: plan.id,
      tierCode: plan.code,
      memberCode: await generateUniqueMemberCode(),
      startDate: new Date(),
      status: SubscriptionStatus.PAYMENT_PENDING,
    },
  });

  const payment = await prisma.payment.findUnique({ where: { id: paymentResponse.paymentId } });

  return {
    success: true,
    message: "Membership checkout initialized successfully.",
    data: {
      subscriptionId: subscription.id,
      paymentReference: payment?.reference || "",
      status: "PAYMENT_PENDING",
      checkoutUrl: parsedUrl.toString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    }
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
      activatedAt: null,
      endDate: null,
      status: "ACTIVE",
      autoRenew: false,
    };
  }

  const latestPayment = subscription.planId
    ? await prisma.payment.findFirst({
        where: {
          userId,
          targetType: "MEMBERSHIP_SUBSCRIPTION",
          targetId: subscription.planId,
        },
        orderBy: { createdAt: "desc" },
        select: { reference: true },
      })
    : null;

  const { startDate: _startDate, ...rest } = subscription;
  return {
    ...rest,
    activatedAt: subscription.startDate,
    paymentReference: latestPayment?.reference ?? null,
  };
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

  await prisma.userSubscription.updateMany({
    where: { userId: payment.userId, status: SubscriptionStatus.PAYMENT_PENDING },
    data: { status: SubscriptionStatus.PAYMENT_FAILED },
  });

  return { payment };
}
