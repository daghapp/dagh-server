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
  type MembershipTierCode,
} from "../../generated/prisma/client.js";
import type { SubscribeMembershipSchema, PrioritySupportSchema } from "../validator/index.js";
import { getEffectiveAccess, hasServiceFeeWaiver } from "../helpers/membership.js";
import {
  shouldBlockIosDigitalPurchase,
  IOS_IAP_REQUIRED_CODE,
  IOS_IAP_REQUIRED_MESSAGE,
  type ClientPlatform,
} from "../helpers/client-platform.js";

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
export async function subscribeToPlan(
  userId: string,
  payload: SubscribeMembershipSchema & { clientPlatform?: ClientPlatform },
) {
  const plan = await prisma.membershipPlan.findUnique({
    where: { id: payload.planId },
  });

  if (!plan || !plan.isActive) {
    return {
      success: false,
      code: "INVALID_PLAN_ID",
      message: "Plan does not exist or is inactive",
    };
  }

  const existingSub = await prisma.userSubscription.findUnique({ where: { userId } });
  if (existingSub && existingSub.planId === plan.id && existingSub.status === "ACTIVE") {
    return {
      success: false,
      code: "SUBSCRIPTION_ALREADY_ACTIVE",
      message: "User already has the requested active plan",
    };
  }

  // Only the genuine FREE tier may be self-service. Gating on price alone let any
  // zero-priced *paid* tier (e.g. FAMILY_PLAN, seeded at price 0) be activated with
  // no payment, which handed out a real tier for free with payments fully enabled.
  // Such a plan is a misconfiguration, not a free plan — refuse it rather than fall
  // through and open a zero-amount Hubtel checkout.
  if (plan.code !== "FREE" && plan.price <= 0) {
    return {
      success: false,
      code: "PLAN_NOT_PURCHASABLE",
      message: "This plan is not available for subscription. Please contact support.",
    };
  }

  // Admins can exempt an account from every charge. Such users are never sent
  // to a checkout. Crucially we do NOT write a free subscription row for them:
  // that row would outlive a revoked waiver and leave them on a paid tier
  // without a payment. The admin's grant already defines their tier, so the
  // exemption stays under admin control and disappears when the grant does.
  const feeWaiver = await hasServiceFeeWaiver(userId);
  if (feeWaiver) {
    return {
      success: true,
      message: "Your account already has complimentary lifetime access. No payment is required.",
      data: {
        subscriptionId: existingSub?.id ?? null,
        status: "ACTIVE",
        checkoutUrl: null,
        waiveServiceFees: true,
      },
    };
  }

  // App Store Guideline 3.1.1: a paid digital membership cannot be unlocked
  // from an external (Hubtel) checkout inside an iOS app. The app must either
  // sell this tier through StoreKit or hide it on iOS. Web/Android are
  // unaffected, and a deployment holding Apple's external-purchase entitlement
  // can opt back in with IOS_EXTERNAL_DIGITAL_PURCHASES=true.
  if (
    shouldBlockIosDigitalPurchase({
      platform: payload.clientPlatform ?? "unknown",
      price: plan.price,
      tierCode: plan.code,
    })
  ) {
    return {
      success: false,
      code: IOS_IAP_REQUIRED_CODE,
      message: IOS_IAP_REQUIRED_MESSAGE,
    };
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
        checkoutUrl: null,
      },
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
    return {
      success: false,
      code: "PAYMENT_PROVIDER_ERROR",
      message: "Payment provider returned an error",
    };
  }

  if (!paymentResponse.success) {
    console.error("[MEMBERSHIP_CHECKOUT_FAILED]", {
      userId,
      planId: plan.id,
      planPrice: plan.price,
      planCurrency: plan.currency,
      providerMessage: paymentResponse.message,
    });
    return {
      success: false,
      code: "CHECKOUT_INITIALIZATION_FAILED",
      message: paymentResponse.message,
    };
  }

  const hubtelData = paymentResponse.data as HubtelCheckoutResponse | undefined;
  const rawUrl = hubtelData?.data?.checkoutUrl;

  // Checkout URL validation — reject anything that won't open in a browser
  if (!rawUrl || typeof rawUrl !== "string") {
    console.error("[MEMBERSHIP_CHECKOUT_NO_URL]", {
      userId,
      planId: plan.id,
      providerResponseCode: hubtelData?.responseCode,
    });
    return {
      success: false,
      code: "CHECKOUT_INITIALIZATION_FAILED",
      message: "Provider could not create checkout (missing URL)",
    };
  }

  if (
    rawUrl.includes("`") ||
    rawUrl.includes('"') ||
    rawUrl.includes("'") ||
    rawUrl.includes(" ") ||
    rawUrl.includes("{") ||
    rawUrl.includes("}") ||
    rawUrl.includes("[") ||
    rawUrl.includes("]") ||
    rawUrl.includes("\\") ||
    rawUrl.includes("\n") ||
    rawUrl.includes("\r") ||
    rawUrl.includes("\t")
  ) {
    console.error("[MEMBERSHIP_CHECKOUT_MALFORMED_URL]", {
      userId,
      planId: plan.id,
      urlLength: rawUrl.length,
    });
    return {
      success: false,
      code: "CHECKOUT_INITIALIZATION_FAILED",
      message: "Provider returned malformed URL",
    };
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
    return {
      success: false,
      code: "CHECKOUT_INITIALIZATION_FAILED",
      message: "Provider returned invalid URL format",
    };
  }

  if (process.env.NODE_ENV === "production" && parsedUrl.protocol !== "https:") {
    console.error("[MEMBERSHIP_CHECKOUT_HTTP_URL]", {
      userId,
      planId: plan.id,
      urlProtocol: parsedUrl.protocol,
    });
    return {
      success: false,
      code: "CHECKOUT_INITIALIZATION_FAILED",
      message: "Checkout URL must use HTTPS in production",
    };
  }

  if (!parsedUrl.hostname || parsedUrl.hostname === "localhost") {
    console.error("[MEMBERSHIP_CHECKOUT_BAD_HOSTNAME]", {
      userId,
      planId: plan.id,
      hostname: parsedUrl.hostname,
    });
    return {
      success: false,
      code: "CHECKOUT_INITIALIZATION_FAILED",
      message: "Checkout URL has invalid hostname",
    };
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
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    },
  };
}

// Cancels the authenticated user's active subscription.
// Only ACTIVE and PAYMENT_PENDING subscriptions can be cancelled.
// Returns an error object (mirroring subscribeToPlan's convention) for client-facing failure.
export async function cancelSubscription(userId: string) {
  const subscription = await prisma.userSubscription.findUnique({ where: { userId } });

  if (!subscription) {
    return {
      success: false,
      code: "NO_SUBSCRIPTION",
      message: "No subscription found for this user",
    };
  }

  if (
    subscription.status !== SubscriptionStatus.ACTIVE &&
    subscription.status !== SubscriptionStatus.PAYMENT_PENDING
  ) {
    return {
      success: false,
      code: "SUBSCRIPTION_NOT_CANCELLABLE",
      message: "Subscription is not in a cancellable state",
    };
  }

  const updated = await prisma.userSubscription.update({
    where: { id: subscription.id },
    data: { status: SubscriptionStatus.CANCELLED, endDate: new Date() },
  });

  return {
    success: true,
    message: "Subscription cancelled successfully.",
    data: {
      subscriptionId: updated.id,
      status: updated.status,
      cancelledAt: updated.endDate,
    },
  };
}

// Marks subscriptions whose endDate has passed as EXPIRED.
// Used by the subscription-expiry cron job; idempotent — only touches ACTIVE rows.
export async function expireExpiredSubscriptions(): Promise<number> {
  const now = new Date();

  const result = await prisma.userSubscription.updateMany({
    where: {
      status: SubscriptionStatus.ACTIVE,
      endDate: { lte: now },
    },
    data: { status: SubscriptionStatus.EXPIRED },
  });

  return result.count;
}

// Renews ACTIVE autoRenew subscriptions whose endDate has passed by rolling
// the endDate forward by one billing interval (no re-charge). True recurring
// billing is not possible without stored Hubtel payment credentials, so this
// is a grace/extension model for testing.
// Returns the number of renewals performed.
export async function renewSubscriptions(): Promise<number> {
  const now = new Date();

  const due = await prisma.userSubscription.findMany({
    where: {
      status: SubscriptionStatus.ACTIVE,
      autoRenew: true,
      endDate: { lte: now },
    },
    include: { plan: true },
  });

  let renewed = 0;

  for (const subscription of due) {
    if (!subscription.plan || !subscription.endDate) continue;

    const nextEndDate = computeEndDate(subscription.plan.interval, subscription.endDate);
    if (!nextEndDate) continue;

    if (nextEndDate.getTime() <= now.getTime()) continue;

    await prisma.userSubscription.update({
      where: { id: subscription.id },
      data: { endDate: nextEndDate },
    });
    renewed++;
  }

  return renewed;
}

// Returns the current user's subscription with the associated plan details
// If no subscription exists yet, returns a virtual FREE-tier response.
// An admin comp is surfaced here too (accessSource / accessGrant) so the
// subscription screen doesn't tell a comped user to go and pay.
export async function getUserSubscription(userId: string) {
  const access = await getEffectiveAccess(userId);
  const subscription = await prisma.userSubscription.findUnique({
    where: { userId },
    include: { plan: true },
  });

  if (!subscription) {
    // GRANT and FREE_MODE both resolve a tier the user has no subscription row
    // for, so the plan has to be looked up by that tier. Falling through to the
    // FREE plan here would report "GOLD_INVESTOR" alongside a plan named FREE.
    const freePlan =
      access.source === "GRANT" || access.source === "FREE_MODE"
        ? await prisma.membershipPlan.findUnique({
            where: { code: access.tierCode as MembershipTierCode },
          })
        : await prisma.membershipPlan.findUnique({ where: { code: "FREE" } });

    const governingGrant = access.grantId
      ? await prisma.subscriptionAccessGrant.findUnique({ where: { id: access.grantId } })
      : null;

    return {
      tierCode: access.tierCode,
      plan: freePlan || null,
      memberCode: null,
      activatedAt: governingGrant?.startDate ?? null,
      endDate: governingGrant?.endDate ?? null,
      status: "ACTIVE" as const,
      autoRenew: false,
      accessSource: access.source,
      waiveServiceFees: access.waiveServiceFees,
      accessGrant: governingGrant
        ? {
            id: governingGrant.id,
            tierCode: governingGrant.tierCode,
            reason: governingGrant.reason,
            includePaidPerks: governingGrant.includePaidPerks,
            waiveServiceFees: governingGrant.waiveServiceFees,
            startDate: governingGrant.startDate,
            endDate: governingGrant.endDate,
          }
        : null,
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
    accessSource: access.source,
    waiveServiceFees: access.waiveServiceFees,
    // Non-null when a comp outranks the user's own subscription, so the app can
    // explain why their tier looks higher than the plan they picked.
    accessGrantId: access.source === "GRANT" ? access.grantId : null,
  };
}

// Creates a priority support ticket for active paid-tier members.
// Access may come from a paid subscription or an admin comp that carries
// includePaidPerks; a comp without that flag waives the fee but not the perk.
export async function createPrioritySupportRequest(userId: string, payload: PrioritySupportSchema) {
  // Priority support is a paid perk, so it keys off the perks tier rather than
  // the entitlement tier: a comp granted with includePaidPerks=false waives the
  // fee but does not confer this privilege.
  const access = await getEffectiveAccess(userId);

  if (access.perksTierCode === "FREE") {
    throw new Error("Priority support is only available for paid tier members");
  }

  // Only a SUBSCRIPTION entitlement is backed by a subscription row, so only
  // that source looks one up or requires one. GRANT is a comp with no row, and
  // FREE_MODE is a resolution-time grant that deliberately writes nothing — so
  // demanding a row for either would deny exactly the users free mode exists to
  // serve. Both leave both attribution FKs null.
  const subscriptionId =
    access.source === "SUBSCRIPTION"
      ? ((await prisma.userSubscription.findUnique({ where: { userId }, select: { id: true } }))
          ?.id ?? null)
      : null;

  if (access.source === "SUBSCRIPTION" && !subscriptionId) {
    throw new Error("Your subscription is not active");
  }

  const request = await prisma.prioritySupportRequest.create({
    data: {
      // Attribute the ticket to whichever record actually authorised it: the
      // subscription, or the grant when the access came from a comp.
      subscriptionId: access.source === "SUBSCRIPTION" ? subscriptionId : null,
      accessGrantId: access.source === "GRANT" ? access.grantId : null,
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

// Shared helper used by the pending-payments cron.
// Idempotently marks a membership payment SUCCESS and activates the user's subscription.
// No-op (returns false) if the payment is not a success or not a membership payment.
export async function settleMembershipPayment(payment: {
  id: string;
  userId: string;
  targetType: string;
  targetId: string;
}): Promise<boolean> {
  if (payment.targetType !== PaymentTargetType.MEMBERSHIP_SUBSCRIPTION) {
    return false;
  }

  const plan = await prisma.membershipPlan.findUnique({ where: { id: payment.targetId } });
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

  return true;
}
