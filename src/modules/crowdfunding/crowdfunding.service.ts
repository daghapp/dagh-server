import { prisma } from "../../config/index.js";
import {
  CrowdfundingStatus as CS,
  PaymentStatus as PS,
  PaymentProviderExt as PPE,
  PaymentTargetType,
  PaymentProvider,
} from "../../../generated/prisma/client.js";
import { logAdminActivity, AdminEntityType } from "../../helpers/admin-activity.js";
import { getAccountId } from "../../helpers/ledger.js";
import { isStripeConfigured, createStripeCheckout } from "../../services/stripe.service.js";
import { createPaypalOrder } from "../../services/paypal.service.js";

export async function createCampaign(creatorId: string, data: any) {
  return prisma.campaign.create({
    data: {
      creatorId,
      title: data.title,
      description: data.description,
      goalAmount: data.goalAmount,
      currency: data.currency ?? "GHS",
      status: CS.DRAFT,
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
    },
  });
}

export async function publishCampaign(id: string, creatorId: string) {
  const row = await prisma.campaign.findUnique({ where: { id } });
  if (!row || row.creatorId !== creatorId) throw new Error("Not found");
  return prisma.campaign.update({ where: { id }, data: { status: CS.LIVE } });
}

export async function listCampaigns(status?: string, limit = 20, offset = 0) {
  const where = status ? { status: status as CS } : {};
  const [rows, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: { creator: { select: { id: true, fullName: true } } },
    }),
    prisma.campaign.count({ where }),
  ]);
  return { rows, total };
}

export async function getCampaign(id: string) {
  return prisma.campaign.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, fullName: true } },
      contributions: { where: { status: PS.SUCCESS }, orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
}

// Fraud check: velocity + amount sanity
export async function fraudCheck(contributorId: string | null, amount: number, campaignId: string) {
  const flags: string[] = [];
  if (amount <= 0) flags.push("non_positive_amount");
  if (amount > 100000) flags.push("large_amount");
  if (contributorId) {
    const recent = await prisma.contribution.count({
      where: { contributorId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    if (recent > 10) flags.push("velocity_exceeded");
  }
  return { ok: flags.length === 0, flags };
}

async function recordRisk(paymentId: string, flags: string[], amount: number) {
  const score = Math.min(100, flags.length * 25 + (amount > 50000 ? 20 : 0));
  const riskLevel = score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW";
  await prisma.paymentRisk.upsert({
    where: { paymentId },
    update: { score, riskLevel, reasons: flags },
    create: { paymentId, score, riskLevel, reasons: flags },
  });
  for (const reason of flags) {
    await prisma.transactionFlag.create({
      data: { paymentId, flaggedBy: "system", reason },
    });
  }
}

async function recordLedger(paymentId: string, amount: number, currency: string) {
  const rate = Number(process.env.PLATFORM_COMMISSION_RATE ?? 0);
  if (!rate || rate <= 0) return;
  try {
    const accountId = await getAccountId("Account_DAGh_Revenue");
    await prisma.ledgerTransaction.create({
      data: {
        accountId,
        paymentId,
        amount: Number((amount * rate).toFixed(2)),
        currency,
        type: "CREDIT",
        description: "Platform commission on crowdfunding contribution",
      },
    });
  } catch {
    // Ledger account not configured; commission accounting is best-effort.
  }
}

async function recordSuccessfulContribution(contribution: {
  id: string;
  campaignId: string;
  contributorId: string | null;
  amount: unknown;
  currency: string;
  provider: PPE;
  providerRef: string;
}) {
  const campaign = await prisma.campaign.findUnique({ where: { id: contribution.campaignId } });
  if (!campaign) return;
  const payerId = contribution.contributorId ?? campaign.creatorId;
  const providerMap: Partial<Record<PPE, PaymentProvider>> = {
    [PPE.STRIPE]: PaymentProvider.STRIPE,
    [PPE.HUBTEL_MOMO]: PaymentProvider.HUBTEL,
  };
  const payment = await prisma.payment.upsert({
    where: { reference: contribution.providerRef },
    update: { status: PS.SUCCESS, paidAt: new Date() },
    create: {
      reference: contribution.providerRef,
      userId: payerId,
      description: `Contribution to ${campaign.title}`,
      targetType: PaymentTargetType.CROWDFUNDING,
      targetId: contribution.campaignId,
      amount: Number(contribution.amount),
      currency: contribution.currency,
      status: PS.SUCCESS,
      method: "CARD",
      provider: providerMap[contribution.provider] ?? null,
      providerReference: contribution.providerRef,
      paidAt: new Date(),
    },
  });

  const flags = await fraudCheck(
    contribution.contributorId,
    Number(contribution.amount),
    contribution.campaignId,
  );
  if (flags.flags.length > 0) {
    await recordRisk(payment.id, flags.flags, Number(contribution.amount));
  }
  await recordLedger(payment.id, Number(contribution.amount), contribution.currency);
}

export async function initiateContribution(
  campaignId: string,
  contributorId: string | null,
  data: { amount: number; currency: string; provider: string; anonymous?: boolean },
) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status !== CS.LIVE) throw new Error("Campaign not live");
  const fc = await fraudCheck(contributorId, data.amount, campaignId);
  if (!fc.ok) throw new Error("Fraud check failed: " + fc.flags.join(","));
  const provider = data.provider as PPE;
  const providerRef = `${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const contribution = await prisma.contribution.create({
    data: {
      campaignId,
      contributorId,
      amount: data.amount,
      currency: data.currency ?? campaign.currency,
      provider,
      providerRef,
      status: PS.PENDING,
      anonymous: !!data.anonymous,
    },
  });

  let checkoutUrl: string;
  if (provider === PPE.STRIPE) {
    checkoutUrl = await createStripeCheckout({
      reference: providerRef,
      amount: data.amount,
      currency: data.currency ?? campaign.currency,
      description: `Contribution to ${campaign.title}`,
    });
  } else if (provider === PPE.PAYPAL) {
    checkoutUrl = await createPaypalOrder({
      reference: providerRef,
      amount: data.amount,
      currency: data.currency ?? campaign.currency,
    });
  } else {
    checkoutUrl = `/payment/processing?ref=${providerRef}`;
  }
  return { contribution, checkoutUrl, stripeConfigured: isStripeConfigured() };
}

export async function handleWebhook(providerRef: string, success: boolean) {
  const contribution = await prisma.contribution.findUnique({ where: { providerRef } });
  if (!contribution) return null;

  // Idempotent: a repeated webhook must not increment the campaign twice.
  if (contribution.status === PS.SUCCESS || contribution.status === PS.FAILED) {
    return contribution;
  }

  if (success) {
    const updated = await prisma.contribution.update({
      where: { providerRef },
      data: { status: PS.SUCCESS },
    });
    await prisma.campaign.update({
      where: { id: contribution.campaignId },
      data: { raisedAmount: { increment: contribution.amount } },
    });
    const c = await prisma.campaign.findUnique({ where: { id: contribution.campaignId } });
    if (c && Number(c.raisedAmount) >= Number(c.goalAmount)) {
      await prisma.campaign.update({ where: { id: c.id }, data: { status: CS.COMPLETED } });
    }
    try {
      await recordSuccessfulContribution(updated);
    } catch (error) {
      // Accounting/risk bookkeeping must not fail the provider webhook — the
      // contribution is already recorded and the campaign total is correct.
      console.error("[crowdfunding] post-payment bookkeeping failed", error);
    }
    return updated;
  }

  return prisma.contribution.update({ where: { providerRef }, data: { status: PS.FAILED } });
}

export async function listContributions(campaignId: string, limit = 50, offset = 0) {
  const [rows, total] = await Promise.all([
    prisma.contribution.findMany({
      where: { campaignId },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.contribution.count({ where: { campaignId } }),
  ]);
  return { rows, total };
}

// ── Admin oversight ────────────────────────────────────────────────────────

export async function adminUpdateStatus(
  id: string,
  adminId: string,
  status: string,
  note?: string,
) {
  const updated = await prisma.campaign.update({
    where: { id },
    data: { status: status as CS },
  });
  await logAdminActivity({
    actorId: adminId,
    entityType: AdminEntityType.CAMPAIGN,
    entityId: id,
    action: "STATUS_CHANGED",
    note,
    metadata: { status },
  });
  return updated;
}

export async function adminListContributions(limit = 50, offset = 0, status?: string) {
  const where = status ? { status: status as PS } : {};
  const [rows, total] = await Promise.all([
    prisma.contribution.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.contribution.count({ where }),
  ]);
  return { rows, total };
}
