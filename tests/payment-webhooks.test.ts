import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyStripeSignature, parseStripeEvent } from "../src/services/stripe.service.js";
import { parsePaypalEvent } from "../src/services/paypal.service.js";

describe("provider webhook helpers", () => {
  it("verifies a Stripe signature against the exact raw payload", () => {
    const secret = "whsec_test";
    const raw = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
    const timestamp = "1700000000";
    const sig = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
    expect(verifyStripeSignature(raw, `t=${timestamp},v1=${sig}`, secret)).toBe(true);
    expect(verifyStripeSignature(`${raw} `, `t=${timestamp},v1=${sig}`, secret)).toBe(false);
    expect(verifyStripeSignature(raw, undefined, secret)).toBe(false);
    expect(verifyStripeSignature(raw, undefined, undefined)).toBe(true);
  });

  it("extracts provider references and success from Stripe events", () => {
    const result = parseStripeEvent({
      type: "checkout.session.completed",
      data: { object: { client_reference_id: "STRIPE-123" } },
    });
    expect(result).toEqual({
      providerRef: "STRIPE-123",
      success: true,
      eventType: "checkout.session.completed",
    });
    expect(parseStripeEvent({ type: "checkout.session.expired", data: {} }).success).toBe(false);
  });

  it("extracts provider references and success from PayPal events", () => {
    const result = parsePaypalEvent({
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { custom_id: "PAYPAL-456" },
    });
    expect(result).toEqual({
      providerRef: "PAYPAL-456",
      success: true,
      eventType: "PAYMENT.CAPTURE.COMPLETED",
    });
  });
});
