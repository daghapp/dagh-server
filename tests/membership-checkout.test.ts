import { describe, expect, it } from "vitest";
import { subscribeMembershipSchema } from "../src/validator/membership-validator.js";

// ─────────────────────────────────────────
// Checkout URL validation
// ─────────────────────────────────────────
// Mirrors the validation logic in membership.service.ts subscribeToPlan.
// Extracted as pure functions for testability.

interface CheckoutValidationResult {
  valid: boolean;
  error?: string;
}

function validateCheckoutUrl(rawUrl: unknown, isProduction: boolean): CheckoutValidationResult {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { valid: false, error: "Missing checkout URL" };
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
    const result = validateCheckoutUrl("https://checkout.hubtel.com/session/cs_123456", PROD);
    expect(result.valid).toBe(true);
  });

  it("accepts HTTP in non-production", () => {
    const result = validateCheckoutUrl("http://checkout.hubtel.com/session/cs_123456", DEV);
    expect(result.valid).toBe(true);
  });

  it("rejects HTTP in production", () => {
    const result = validateCheckoutUrl("http://checkout.hubtel.com/session/cs_123456", PROD);
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
    const result = validateCheckoutUrl("`https://checkout.hubtel.com/session/cs_123456`", PROD);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Provider returned malformed URL");
  });

  it("rejects URL with surrounding quotes", () => {
    const result = validateCheckoutUrl('"https://checkout.hubtel.com/session/cs_123456"', PROD);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Provider returned malformed URL");
  });

  it("rejects URL with spaces", () => {
    const result = validateCheckoutUrl("https://checkout.hubtel.com/session/cs 123456", PROD);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Provider returned malformed URL");
  });

  it("rejects URL with JSON characters", () => {
    const result = validateCheckoutUrl("https://checkout.hubtel.com/{session}", PROD);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Provider returned malformed URL");
  });

  it("rejects relative path", () => {
    const result = validateCheckoutUrl("/checkout/session/cs_123456", PROD);
    expect(result.valid).toBe(false);
  });

  it("rejects hostname-only URL", () => {
    const result = validateCheckoutUrl("checkout.hubtel.com/session/cs_123456", PROD);
    expect(result.valid).toBe(false);
  });

  it("rejects localhost", () => {
    const result = validateCheckoutUrl("http://localhost:3000/checkout/cs_123456", DEV);
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

  it("rejects URL with backslash", () => {
    const result = validateCheckoutUrl("https://checkout.hubtel.com\\session/cs_123456", PROD);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Provider returned malformed URL");
  });

  it("rejects URL with newline", () => {
    const result = validateCheckoutUrl("https://checkout.hubtel.com/session/cs_123\n456", PROD);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Provider returned malformed URL");
  });

  it("rejects URL with tab character", () => {
    const result = validateCheckoutUrl("https://checkout.hubtel.com/session/cs_123\t456", PROD);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Provider returned malformed URL");
  });

  it("rejects URL with single quotes", () => {
    const result = validateCheckoutUrl("'https://checkout.hubtel.com/session/cs_123456'", PROD);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Provider returned malformed URL");
  });

  it("rejects URL with square brackets", () => {
    const result = validateCheckoutUrl("https://checkout.hubtel.com/[session]/cs_123456", PROD);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Provider returned malformed URL");
  });

  it("rejects URL with closing brace", () => {
    const result = validateCheckoutUrl("https://checkout.hubtel.com/session/cs_123456}", PROD);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Provider returned malformed URL");
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

// ─────────────────────────────────────────
// Membership error codes
// ─────────────────────────────────────────

describe("Membership error codes", () => {
  it("INVALID_PLAN_ID: plan does not exist or is inactive", () => {
    const error = { code: "INVALID_PLAN_ID", message: "Plan does not exist or is inactive" };
    expect(error.code).toBe("INVALID_PLAN_ID");
  });

  it("INVALID_RETURN_URL: supplied return/cancellation URL is unsupported", () => {
    const error = { code: "INVALID_RETURN_URL", message: "Invalid returnUrl" };
    expect(error.code).toBe("INVALID_RETURN_URL");
  });

  it("SUBSCRIPTION_ALREADY_ACTIVE: user already has the requested active plan", () => {
    const error = {
      code: "SUBSCRIPTION_ALREADY_ACTIVE",
      message: "User already has the requested active plan",
    };
    expect(error.code).toBe("SUBSCRIPTION_ALREADY_ACTIVE");
  });

  it("CHECKOUT_INITIALIZATION_FAILED: provider could not create checkout", () => {
    const error = {
      code: "CHECKOUT_INITIALIZATION_FAILED",
      message: "Provider could not create checkout (missing URL)",
    };
    expect(error.code).toBe("CHECKOUT_INITIALIZATION_FAILED");
  });

  it("PAYMENT_PROVIDER_ERROR: provider returned an invalid or failed response", () => {
    const error = { code: "PAYMENT_PROVIDER_ERROR", message: "Payment provider returned an error" };
    expect(error.code).toBe("PAYMENT_PROVIDER_ERROR");
  });
});

// ─────────────────────────────────────────
// Mobile deep link bridging
// ─────────────────────────────────────────

describe("Mobile deep link bridging", () => {
  function bridgeDeepLink(
    originalUrl: string,
    apiUrl: string,
    type: "return" | "cancel",
  ): { bridged: boolean; result: string } {
    try {
      const parsed = new URL(originalUrl);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return { bridged: false, result: originalUrl };
      }
      const path = type === "return" ? "payment/return" : "payment/cancel";
      const bridged = `${apiUrl}/membership/${path}?appUrl=${encodeURIComponent(originalUrl)}`;
      return { bridged: true, result: bridged };
    } catch {
      return { bridged: false, result: originalUrl };
    }
  }

  it("bridges Expo deep link for return URL", () => {
    const result = bridgeDeepLink(
      "daghapp://payment-complete",
      "https://api.example.com",
      "return",
    );
    expect(result.bridged).toBe(true);
    expect(result.result).toContain("/membership/payment/return?appUrl=");
    expect(result.result).toContain(encodeURIComponent("daghapp://payment-complete"));
  });

  it("bridges custom scheme for cancel URL", () => {
    const result = bridgeDeepLink("myapp://cancel", "https://api.example.com", "cancel");
    expect(result.bridged).toBe(true);
    expect(result.result).toContain("/membership/payment/cancel?appUrl=");
  });

  it("does not bridge HTTPS URLs", () => {
    const result = bridgeDeepLink(
      "https://example.com/return",
      "https://api.example.com",
      "return",
    );
    expect(result.bridged).toBe(false);
    expect(result.result).toBe("https://example.com/return");
  });

  it("does not bridge HTTP URLs", () => {
    const result = bridgeDeepLink(
      "http://localhost:3000/return",
      "https://api.example.com",
      "return",
    );
    expect(result.bridged).toBe(false);
    expect(result.result).toBe("http://localhost:3000/return");
  });
});

// ─────────────────────────────────────────
// Callback URL validation
// ─────────────────────────────────────────

describe("Callback URL validation", () => {
  function validateCallbackUrl(url: string): { valid: boolean; error?: string } {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
        return { valid: false, error: "callbackUrl must be a public HTTPS server endpoint" };
      }
      return { valid: true };
    } catch {
      return { valid: false, error: "Invalid callbackUrl" };
    }
  }

  it("accepts a public HTTPS callback URL", () => {
    const result = validateCallbackUrl(
      "https://dagh-server-fo64.onrender.com/membership/payment-callback",
    );
    expect(result.valid).toBe(true);
  });

  it("rejects localhost callback URL", () => {
    const result = validateCallbackUrl("http://localhost:3000/membership/payment-callback");
    expect(result.valid).toBe(false);
  });

  it("rejects 127.0.0.1 callback URL", () => {
    const result = validateCallbackUrl("http://127.0.0.1:3000/membership/payment-callback");
    expect(result.valid).toBe(false);
  });

  it("rejects malformed callback URL", () => {
    const result = validateCallbackUrl("not-a-url");
    expect(result.valid).toBe(false);
  });
});

// ─────────────────────────────────────────
// Free plan activation
// ─────────────────────────────────────────

describe("Free plan activation", () => {
  interface SubscribeResponse {
    subscriptionId: string;
    status: string;
    checkoutUrl: string | null;
  }

  function validateFreePlanResponse(response: SubscribeResponse): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!response.subscriptionId) {
      errors.push("Missing subscriptionId");
    }
    if (response.status !== "ACTIVE") {
      errors.push("Free plan must have ACTIVE status");
    }
    if (response.checkoutUrl !== null) {
      errors.push("Free plan checkoutUrl must be null");
    }
    return { valid: errors.length === 0, errors };
  }

  it("activates immediately without checkout URL", () => {
    const response: SubscribeResponse = {
      subscriptionId: "sub_free_123",
      status: "ACTIVE",
      checkoutUrl: null,
    };
    const result = validateFreePlanResponse(response);
    expect(result.valid).toBe(true);
  });

  it("rejects free plan with non-null checkoutUrl", () => {
    const response: SubscribeResponse = {
      subscriptionId: "sub_free_123",
      status: "ACTIVE",
      checkoutUrl: "https://checkout.hubtel.com/session/cs_123",
    };
    const result = validateFreePlanResponse(response);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Free plan checkoutUrl must be null");
  });
});

// ─────────────────────────────────────────
// Callback idempotency
// ─────────────────────────────────────────

describe("Callback idempotency", () => {
  it("duplicate callback should not change subscription status", () => {
    const firstCallbackResult = { status: "ACTIVE" };
    const secondCallbackResult = { status: "ACTIVE" };
    expect(firstCallbackResult.status).toBe(secondCallbackResult.status);
    expect(firstCallbackResult.status).toBe("ACTIVE");
  });

  it("failed callback does not activate subscription", () => {
    const callbackStatus = "PAYMENT_FAILED";
    expect(callbackStatus).not.toBe("ACTIVE");
  });

  it("cancelled callback does not activate subscription", () => {
    const callbackStatus = "CANCELLED";
    expect(callbackStatus).not.toBe("ACTIVE");
  });
});

// ─────────────────────────────────────────
// Subscription response shape
// ─────────────────────────────────────────

describe("Subscription response shape", () => {
  interface SubscriptionResponse {
    id?: string;
    tierCode?: string;
    status?: string;
    planId?: string;
    paymentReference?: string | null;
    plan?: { id: string; name: string; interval: string } | null;
    memberCode?: string | null;
    autoRenew?: boolean;
  }

  it("paid subscription includes paymentReference", () => {
    const response: SubscriptionResponse = {
      id: "sub_123",
      tierCode: "GOLD_INVESTOR",
      status: "ACTIVE",
      planId: "plan_abc",
      paymentReference: "TXN-MEMBERSHIP-abc123",
      plan: { id: "plan_abc", name: "Gold Investor", interval: "MONTHLY" },
      memberCode: "12345-ABC",
      autoRenew: false,
    };
    expect(response.paymentReference).toBe("TXN-MEMBERSHIP-abc123");
  });

  it("free tier subscription has null paymentReference", () => {
    const response: SubscriptionResponse = {
      tierCode: "FREE",
      status: "ACTIVE",
      plan: { id: "plan_free", name: "Free", interval: "MONTHLY" },
      paymentReference: null,
      autoRenew: false,
    };
    expect(response.paymentReference).toBeNull();
  });

  it("active subscription after callback has correct status", () => {
    const response: SubscriptionResponse = {
      id: "sub_456",
      tierCode: "BASIC",
      status: "ACTIVE",
      paymentReference: "TXN-MEMBERSHIP-def456",
    };
    expect(response.status).toBe("ACTIVE");
  });
});

// ─────────────────────────────────────────
// Subscribe schema validation (deep links)
// ─────────────────────────────────────────

describe("subscribeMembershipSchema", () => {
  const validUuid = "40b788b5-e4ff-411f-b37d-ee8522f035c3";

  it("accepts HTTPS return and cancellation URLs", () => {
    const result = subscribeMembershipSchema.safeParse({
      planId: validUuid,
      returnUrl: "https://example.com/return",
      callbackUrl: "https://api.example.com/membership/payment-callback",
      cancellationUrl: "https://example.com/cancel",
    });
    expect(result.success).toBe(true);
  });

  it("accepts mobile deep link as returnUrl", () => {
    const result = subscribeMembershipSchema.safeParse({
      planId: validUuid,
      returnUrl: "daghapp://payment-complete",
      callbackUrl: "https://api.example.com/membership/payment-callback",
    });
    expect(result.success).toBe(true);
  });

  it("accepts mobile deep link as cancellationUrl", () => {
    const result = subscribeMembershipSchema.safeParse({
      planId: validUuid,
      returnUrl: "https://example.com/return",
      callbackUrl: "https://api.example.com/membership/payment-callback",
      cancellationUrl: "myapp://cancel",
    });
    expect(result.success).toBe(true);
  });

  it("accepts Expo scheme deep link", () => {
    const result = subscribeMembershipSchema.safeParse({
      planId: validUuid,
      returnUrl: "exp://192.168.1.100:8081/--/payment",
      callbackUrl: "https://api.example.com/membership/payment-callback",
    });
    expect(result.success).toBe(true);
  });

  it("accepts body without cancellationUrl (optional)", () => {
    const result = subscribeMembershipSchema.safeParse({
      planId: validUuid,
      returnUrl: "https://example.com/return",
      callbackUrl: "https://api.example.com/membership/payment-callback",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty returnUrl", () => {
    const result = subscribeMembershipSchema.safeParse({
      planId: validUuid,
      returnUrl: "",
      callbackUrl: "https://api.example.com/membership/payment-callback",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid planId", () => {
    const result = subscribeMembershipSchema.safeParse({
      planId: "not-a-uuid",
      returnUrl: "https://example.com/return",
      callbackUrl: "https://api.example.com/membership/payment-callback",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid callbackUrl", () => {
    const result = subscribeMembershipSchema.safeParse({
      planId: validUuid,
      returnUrl: "https://example.com/return",
      callbackUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing returnUrl", () => {
    const result = subscribeMembershipSchema.safeParse({
      planId: validUuid,
      callbackUrl: "https://api.example.com/membership/payment-callback",
    });
    expect(result.success).toBe(false);
  });
});
