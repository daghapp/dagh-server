import axios from "axios";
import { createHmac, timingSafeEqual } from "node:crypto";

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

export function isStripeConfigured(): boolean {
  return Boolean(STRIPE_SECRET);
}

export async function createStripeCheckout(params: {
  reference: string;
  amount: number;
  currency: string;
  description?: string;
  successUrl?: string;
  cancelUrl?: string;
}): Promise<string> {
  if (!STRIPE_SECRET) return `https://checkout.stripe.com/mock?ref=${params.reference}`;
  const apiUrl = process.env.API_URL ?? "http://localhost:5000";
  try {
    const res = await axios.post(
      "https://api.stripe.com/v1/checkout/sessions",
      new URLSearchParams({
        mode: "payment",
        success_url: params.successUrl ?? `${apiUrl}/payment/verify/${params.reference}`,
        cancel_url: params.cancelUrl ?? `${apiUrl}/payment/processing`,
        "line_items[0][price_data][currency]": params.currency.toLowerCase(),
        "line_items[0][price_data][product_data][name]":
          params.description ?? "Campaign contribution",
        "line_items[0][price_data][unit_amount]": String(Math.round(params.amount * 100)),
        "line_items[0][quantity]": "1",
        client_reference_id: params.reference,
      }),
      {
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );
    return res.data.url as string;
  } catch {
    return `https://checkout.stripe.com/mock?ref=${params.reference}`;
  }
}

/**
 * Verifies a Stripe `Stripe-Signature` header. `rawBody` must be the exact
 * request body bytes; JSON re-serialization is not byte-identical.
 */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string | undefined = STRIPE_WEBHOOK_SECRET,
): boolean {
  if (!secret) return true;
  if (!signatureHeader) return false;

  const parts = signatureHeader.split(",").reduce<Record<string, string[]>>((acc, part) => {
    const [key, value] = part.split("=");
    if (!key || value === undefined) return acc;
    (acc[key] ??= []).push(value);
    return acc;
  }, {});

  const timestamp = parts.t?.[0];
  const signatures = parts.v1 ?? [];
  if (!timestamp || signatures.length === 0) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected);
  return signatures.some((sig) => {
    const actualBuf = Buffer.from(sig);
    return actualBuf.length === expectedBuf.length && timingSafeEqual(actualBuf, expectedBuf);
  });
}

export interface StripeWebhookResult {
  providerRef: string | null;
  success: boolean;
  eventType: string;
}

export function parseStripeEvent(body: any): StripeWebhookResult {
  const eventType = String(body?.type ?? "");
  const object = body?.data?.object ?? {};
  const providerRef =
    object?.client_reference_id ??
    object?.metadata?.providerRef ??
    object?.metadata?.reference ??
    null;
  const success =
    eventType === "checkout.session.completed" ||
    eventType === "checkout.session.async_payment_succeeded" ||
    eventType === "payment_intent.succeeded";
  return { providerRef, success, eventType };
}
