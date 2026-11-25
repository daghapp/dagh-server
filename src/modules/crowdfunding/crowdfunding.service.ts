import { prisma } from "../../config/index.js";
import axios from "axios";
import {
  CrowdfundingStatus as CS,
  PaymentStatus as PS,
  PaymentProviderExt as PPE,
} from "../../../generated/prisma/client.js";

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_BASE = process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com";

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
  // Create checkout URL
  let checkoutUrl: string;
  if (provider === PPE.STRIPE) {
    checkoutUrl = await stripeCheckout(
      providerRef,
      data.amount,
      data.currency ?? campaign.currency,
    );
  } else if (provider === PPE.PAYPAL) {
    checkoutUrl = await paypalCheckout(
      providerRef,
      data.amount,
      data.currency ?? campaign.currency,
    );
  } else {
    checkoutUrl = `/payment/processing?ref=${providerRef}`;
  }
  return { contribution, checkoutUrl };
}

async function stripeCheckout(ref: string, amount: number, currency: string) {
  if (!STRIPE_SECRET) return `https://checkout.stripe.com/mock?ref=${ref}`;
  try {
    const res = await axios.post(
      "https://api.stripe.com/v1/checkout/sessions",
      new URLSearchParams({
        mode: "payment",
        success_url: `${process.env.API_URL ?? "http://localhost:5000"}/payment/verify/${ref}`,
        cancel_url: `${process.env.API_URL ?? "http://localhost:5000"}/payment/processing`,
        "line_items[0][price_data][currency]": currency.toLowerCase(),
        "line_items[0][price_data][product_data][name]": "Campaign contribution",
        "line_items[0][price_data][unit_amount]": String(Math.round(amount * 100)),
        "line_items[0][quantity]": "1",
        client_reference_id: ref,
      }),
      {
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );
    return res.data.url;
  } catch {
    return `https://checkout.stripe.com/mock?ref=${ref}`;
  }
}

async function paypalCheckout(ref: string, amount: number, currency: string) {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET)
    return `https://www.paypal.com/checkoutnow?token=${ref}`;
  try {
    const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
    const tokenRes = await axios.post(
      `${PAYPAL_BASE}/v1/oauth2/token`,
      "grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );
    const accessToken = tokenRes.data.access_token;
    const orderRes = await axios.post(
      `${PAYPAL_BASE}/v2/checkout/orders`,
      {
        intent: "CAPTURE",
        purchase_units: [
          { amount: { currency_code: currency, value: amount.toFixed(2) }, custom_id: ref },
        ],
      },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } },
    );
    const approve = orderRes.data.links?.find((l: any) => l.rel === "approve");
    return approve?.href ?? `https://www.paypal.com/checkoutnow?token=${orderRes.data.id}`;
  } catch {
    return `https://www.paypal.com/checkoutnow?token=${ref}`;
  }
}

export async function handleWebhook(providerRef: string, success: boolean) {
  const contribution = await prisma.contribution.findUnique({ where: { providerRef } });
  if (!contribution) return null;
  if (success) {
    await prisma.contribution.update({ where: { providerRef }, data: { status: PS.SUCCESS } });
    await prisma.campaign.update({
      where: { id: contribution.campaignId },
      data: { raisedAmount: { increment: contribution.amount } },
    });
    // mark completed if goal reached
    const c = await prisma.campaign.findUnique({ where: { id: contribution.campaignId } });
    if (c && Number(c.raisedAmount) >= Number(c.goalAmount)) {
      await prisma.campaign.update({ where: { id: c.id }, data: { status: CS.COMPLETED } });
    }
  } else {
    await prisma.contribution.update({ where: { providerRef }, data: { status: PS.FAILED } });
  }
  return contribution;
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
