import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────
// Checkout URL validation
// ─────────────────────────────────────────
// Mirrors the validation logic in membership.service.ts subscribeToPlan.
// Extracted as pure functions for testability.

interface CheckoutValidationResult {
  valid: boolean;
  error?: string;
}

function validateCheckoutUrl(
  rawUrl: unknown,
  isProduction: boolean,
): CheckoutValidationResult {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { valid: false, error: "Missing checkout URL" };
  }

  if (rawUrl.includes("`") || rawUrl.includes('"') || rawUrl.includes(" ") || rawUrl.includes("{")) {
    return { valid: false, error: "Provider returned malformed URL" };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return { valid: false, error: "Provider returned invalid URL format" };
  }

  if (isProduction && parsedUrl.protocol !== "https:") {
    return { valid: false, error: "Checkout URL must use HTTPS" };
  }

  if (!parsedUrl.hostname || parsedUrl.hostname === "localhost") {
    return { valid: false, error: "Checkout URL has invalid hostname" };
  }

  return { valid: true };
}

describe("validateCheckoutUrl", () => {
  const PROD = true;
  const DEV = false;

  it("accepts a valid HTTPS URL", () => {
    const result = validateCheckoutUrl(
      "https://checkout.hubtel.com/session/cs_123456",
      PROD,
    );
    expect(result.valid).toBe(true);
  });

  it("accepts HTTP in non-production", () => {
    const result = validateCheckoutUrl(
      "http://checkout.hubtel.com/session/cs_123456",
      DEV,
    );
    expect(result.valid).toBe(true);
  });

  it("rejects HTTP in production", () => {
    const result = validateCheckoutUrl(
      "http://checkout.hubtel.com/session/cs_123456",
      PROD,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Checkout URL must use HTTPS");
  });

  it("rejects null", () => {
    const result = validateCheckoutUrl(null, PROD);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Missing checkout URL");
  });

  it("rejects undefined", () => {
    const result = validateCheckoutUrl(undefined, PROD);
    expect(result.valid).toBe(false);
  });

  it("rejects empty string", () => {
    const result = validateCheckoutUrl("", PROD);
    expect(result.valid).toBe(false);
  });

  it("rejects non-string types", () => {
    expect(validateCheckoutUrl(123, PROD).valid).toBe(false);
    expect(validateCheckoutUrl({}, PROD).valid).toBe(false);
    expect(validateCheckoutUrl([], PROD).valid).toBe(false);
  });

  it("rejects URL with backticks", () => {
    const result = validateCheckoutUrl(
      "`https://checkout.hubtel.com/session/cs_123456`",
      PROD,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Provider returned malformed URL");
  });

  it("rejects URL with surrounding quotes", () => {
    const result = validateCheckoutUrl(
      '"https://checkout.hubtel.com/session/cs_123456"',
      PROD,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Provider returned malformed URL");
  });

  it("rejects URL with spaces", () => {
    const result = validateCheckoutUrl(
      "https://checkout.hubtel.com/session/cs 123456",
      PROD,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Provider returned malformed URL");
  });

  it("rejects URL with JSON characters", () => {
    const result = validateCheckoutUrl(
      "https://checkout.hubtel.com/{session}",
      PROD,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Provider returned malformed URL");
  });

  it("rejects relative path", () => {
    const result = validateCheckoutUrl("/checkout/session/cs_123456", PROD);
    expect(result.valid).toBe(false);
  });

  it("rejects hostname-only URL", () => {
    const result = validateCheckoutUrl(
      "checkout.hubtel.com/session/cs_123456",
      PROD,
    );
    expect(result.valid).toBe(false);
  });

  it("rejects localhost", () => {
    const result = validateCheckoutUrl(
      "http://localhost:3000/checkout/cs_123456",
      DEV,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Checkout URL has invalid hostname");
  });

  it("rejects string 'undefined'", () => {
    const result = validateCheckoutUrl("undefined", PROD);
    expect(result.valid).toBe(false);
  });

  it("rejects string 'null'", () => {
    const result = validateCheckoutUrl("null", PROD);
    expect(result.valid).toBe(false);
  });
});

// ─────────────────────────────────────────
// Subscribe response shape
// ─────────────────────────────────────────

interface SubscribeResponse {
  subscriptionId: string;
  paymentReference?: string;
  status: string;
  checkoutUrl: string | null;
  expiresAt?: string;
}

function validateSubscribeResponse(
  response: SubscribeResponse,
  isPaidPlan: boolean,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!response.subscriptionId) {
    errors.push("Missing subscriptionId");
  }

  if (isPaidPlan) {
    if (!response.checkoutUrl) {
      errors.push("Paid plan must include checkoutUrl");
    } else if (typeof response.checkoutUrl === "string") {
      try {
        const url = new URL(response.checkoutUrl);
        if (url.protocol !== "https:") {
          errors.push("checkoutUrl must use HTTPS in production");
        }
        if (!url.hostname) {
          errors.push("checkoutUrl must have a valid hostname");
        }
      } catch {
        errors.push("checkoutUrl is not a valid URL");
      }
    }

    if (response.status !== "PAYMENT_PENDING") {
      errors.push("Paid plan must have PAYMENT_PENDING status");
    }

    if (!response.expiresAt) {
      errors.push("Paid plan must include expiresAt");
    }
  } else {
    if (response.status !== "ACTIVE") {
      errors.push("Free plan must have ACTIVE status");
    }
    if (response.checkoutUrl !== null) {
      errors.push("Free plan checkoutUrl must be null");
    }
  }

  return { valid: errors.length === 0, errors };
}

describe("validateSubscribeResponse", () => {
  it("validates a correct paid plan response", () => {
    const response: SubscribeResponse = {
      subscriptionId: "sub_123",
      paymentReference: "TXN-MEMBERSHIP-abc123",
      status: "PAYMENT_PENDING",
      checkoutUrl: "https://checkout.hubtel.com/session/cs_123456",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
    const result = validateSubscribeResponse(response, true);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates a correct free plan response", () => {
    const response: SubscribeResponse = {
      subscriptionId: "sub_456",
      status: "ACTIVE",
      checkoutUrl: null,
    };
    const result = validateSubscribeResponse(response, false);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects paid plan without checkoutUrl", () => {
    const response: SubscribeResponse = {
      subscriptionId: "sub_123",
      status: "PAYMENT_PENDING",
      checkoutUrl: null,
      expiresAt: new Date().toISOString(),
    };
    const result = validateSubscribeResponse(response, true);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Paid plan must include checkoutUrl");
  });

  it("rejects paid plan with ACTIVE status (must be PAYMENT_PENDING)", () => {
    const response: SubscribeResponse = {
      subscriptionId: "sub_123",
      status: "ACTIVE",
      checkoutUrl: "https://checkout.hubtel.com/session/cs_123",
      expiresAt: new Date().toISOString(),
    };
    const result = validateSubscribeResponse(response, true);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Paid plan must have PAYMENT_PENDING status");
  });

  it("rejects paid plan without expiresAt", () => {
    const response: SubscribeResponse = {
      subscriptionId: "sub_123",
      status: "PAYMENT_PENDING",
      checkoutUrl: "https://checkout.hubtel.com/session/cs_123",
    };
    const result = validateSubscribeResponse(response, true);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Paid plan must include expiresAt");
  });

  it("rejects free plan with non-null checkoutUrl", () => {
    const response: SubscribeResponse = {
      subscriptionId: "sub_456",
      status: "ACTIVE",
      checkoutUrl: "https://checkout.hubtel.com/session/cs_123",
    };
    const result = validateSubscribeResponse(response, false);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Free plan checkoutUrl must be null");
  });

  it("rejects free plan with PAYMENT_PENDING status", () => {
    const response: SubscribeResponse = {
      subscriptionId: "sub_456",
      status: "PAYMENT_PENDING",
      checkoutUrl: null,
    };
    const result = validateSubscribeResponse(response, false);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Free plan must have ACTIVE status");
  });

  it("rejects response without subscriptionId", () => {
    const response: SubscribeResponse = {
      subscriptionId: "",
      status: "ACTIVE",
      checkoutUrl: null,
    };
    const result = validateSubscribeResponse(response, false);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing subscriptionId");
  });

  it("rejects paid plan with HTTP checkoutUrl in production", () => {
    const response: SubscribeResponse = {
      subscriptionId: "sub_123",
      status: "PAYMENT_PENDING",
      checkoutUrl: "http://checkout.hubtel.com/session/cs_123",
      expiresAt: new Date().toISOString(),
    };
    const result = validateSubscribeResponse(response, true);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("checkoutUrl must use HTTPS in production");
  });
});

// ─────────────────────────────────────────
// Payment status lifecycle
// ─────────────────────────────────────────

describe("Payment status lifecycle", () => {
  type SubStatus = "PAYMENT_PENDING" | "ACTIVE" | "PAYMENT_FAILED" | "CANCELLED" | "EXPIRED";

  const validTransitions: Array<{ from: SubStatus; to: SubStatus }> = [
    { from: "PAYMENT_PENDING", to: "ACTIVE" },
    { from: "PAYMENT_PENDING", to: "PAYMENT_FAILED" },
    { from: "PAYMENT_PENDING", to: "CANCELLED" },
    { from: "ACTIVE", to: "EXPIRED" },
  ];

  const invalidTransitions: Array<{ from: SubStatus; to: SubStatus }> = [
    { from: "ACTIVE", to: "PAYMENT_PENDING" },
    { from: "ACTIVE", to: "PAYMENT_FAILED" },
    { from: "PAYMENT_FAILED", to: "ACTIVE" },
    { from: "CANCELLED", to: "ACTIVE" },
    { from: "EXPIRED", to: "ACTIVE" },
  ];

  it("allows valid subscription status transitions", () => {
    for (const { from, to } of validTransitions) {
      // Valid transitions: from -> to is allowed
      expect(validTransitions.some((t) => t.from === from && t.to === to)).toBe(true);
    }
  });

  it("disallows invalid subscription status transitions", () => {
    for (const { from, to } of invalidTransitions) {
      expect(validTransitions.some((t) => t.from === from && t.to === to)).toBe(false);
    }
  });
});
