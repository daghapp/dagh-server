import axios from "axios";

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_BASE = process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com";
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;

export function isPaypalConfigured(): boolean {
  return Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET);
}

async function paypalAccessToken(): Promise<string> {
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
  return tokenRes.data.access_token as string;
}

export async function createPaypalOrder(params: {
  reference: string;
  amount: number;
  currency: string;
}): Promise<string> {
  if (!isPaypalConfigured()) {
    return `https://www.paypal.com/checkoutnow?token=${params.reference}`;
  }
  try {
    const accessToken = await paypalAccessToken();
    const orderRes = await axios.post(
      `${PAYPAL_BASE}/v2/checkout/orders`,
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: { currency_code: params.currency, value: params.amount.toFixed(2) },
            custom_id: params.reference,
          },
        ],
      },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } },
    );
    const approve = orderRes.data.links?.find((l: any) => l.rel === "approve");
    return approve?.href ?? `https://www.paypal.com/checkoutnow?token=${orderRes.data.id}`;
  } catch {
    return `https://www.paypal.com/checkoutnow?token=${params.reference}`;
  }
}

/**
 * Verifies a PayPal webhook signature through PayPal's verify-webhook-signature
 * API. When PAYPAL_WEBHOOK_ID is not configured the check is skipped so local
 * development can still exercise the flow.
 */
export async function verifyPaypalWebhook(
  headers: Record<string, unknown>,
  body: any,
): Promise<boolean> {
  if (!PAYPAL_WEBHOOK_ID) return true;
  if (!isPaypalConfigured()) return false;
  try {
    const accessToken = await paypalAccessToken();
    const res = await axios.post(
      `${PAYPAL_BASE}/v1/notifications/verify-webhook-signature`,
      {
        auth_algo: headers["paypal-auth-algo"],
        cert_url: headers["paypal-cert-url"],
        transmission_id: headers["paypal-transmission-id"],
        transmission_sig: headers["paypal-transmission-sig"],
        transmission_time: headers["paypal-transmission-time"],
        webhook_id: PAYPAL_WEBHOOK_ID,
        webhook_event: body,
      },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } },
    );
    return res.data?.verification_status === "SUCCESS";
  } catch {
    return false;
  }
}

export interface PaypalWebhookResult {
  providerRef: string | null;
  success: boolean;
  eventType: string;
}

export function parsePaypalEvent(body: any): PaypalWebhookResult {
  const eventType = String(body?.event_type ?? "");
  const resource = body?.resource ?? {};
  const providerRef =
    resource?.custom_id ??
    resource?.purchase_units?.[0]?.custom_id ??
    resource?.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id ??
    null;
  const success =
    eventType === "PAYMENT.CAPTURE.COMPLETED" ||
    eventType === "CHECKOUT.ORDER.APPROVED" ||
    eventType === "CHECKOUT.ORDER.COMPLETED";
  return { providerRef, success, eventType };
}
