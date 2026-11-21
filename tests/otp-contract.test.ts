import { describe, expect, it } from "vitest";
import { normalizePhone, maskPhone } from "../src/helpers/otp.js";
import {
  sendPhoneOtpSchema,
  verifyPhoneOtpSchema,
} from "../src/validator/profile-phone-verification-validator.js";

// ─────────────────────────────────────────
// Phone normalization
// ─────────────────────────────────────────

describe("normalizePhone", () => {
  it("strips leading + from E.164 format", () => {
    expect(normalizePhone("+233501234567")).toBe("233501234567");
  });

  it("normalizes Ghanaian local format to E.164", () => {
    expect(normalizePhone("0501234567")).toBe("233501234567");
  });

  it("strips spaces and dashes", () => {
    expect(normalizePhone("+233 501 234 567")).toBe("233501234567");
    expect(normalizePhone("233-501-234-567")).toBe("233501234567");
  });

  it("strips parentheses", () => {
    expect(normalizePhone("(233) 501 234 567")).toBe("233501234567");
  });

  it("returns null for too-short numbers", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("+123456789")).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(normalizePhone("abcdefghij")).toBeNull();
    expect(normalizePhone("+233ABC1234")).toBeNull();
  });

  it("converts 10-digit Ghana local number to E.164", () => {
    expect(normalizePhone("0501234567")).toBe("233501234567");
  });

  it("accepts 15-digit international numbers", () => {
    expect(normalizePhone("123456789012345")).toBe("123456789012345");
  });

  it("returns null for numbers over 15 digits", () => {
    expect(normalizePhone("1234567890123456")).toBeNull();
  });
});

// ─────────────────────────────────────────
// Phone masking
// ─────────────────────────────────────────

describe("maskPhone", () => {
  it("masks middle digits", () => {
    // 12 chars: 3 prefix + 7 stars + 2 suffix = 12
    expect(maskPhone("233501234567")).toBe("233*******67");
  });

  it("masks short phone numbers", () => {
    // 7 chars: 3 prefix + 2 stars + 2 suffix = 7
    expect(maskPhone("0501234")).toBe("050**34");
  });

  it("returns *** for very short strings", () => {
    expect(maskPhone("12345")).toBe("***");
    expect(maskPhone("abc")).toBe("***");
  });

  it("never exposes the full phone number", () => {
    const phone = "233501234567";
    const masked = maskPhone(phone);
    expect(masked).not.toBe(phone);
    // Stars replace middle digits; at least 2 chars differ
    const differences = phone.split("").filter((c, i) => c !== masked[i]).length;
    expect(differences).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────
// OTP validator schemas
// ─────────────────────────────────────────

describe("sendPhoneOtpSchema", () => {
  it("accepts empty body (all fields optional)", () => {
    const result = sendPhoneOtpSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts phoneNumber only", () => {
    const result = sendPhoneOtpSchema.safeParse({ phoneNumber: "+233501234567" });
    expect(result.success).toBe(true);
  });

  it("defaults to empty object when input is undefined", () => {
    const result = sendPhoneOtpSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({});
    }
  });

  it("strips unknown fields", () => {
    const result = sendPhoneOtpSchema.safeParse({
      phoneNumber: "+233501234567",
      deliveryMethod: "SMS",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ phoneNumber: "+233501234567" });
    }
  });
});

describe("verifyPhoneOtpSchema", () => {
  it("accepts valid challengeId and 6-digit code", () => {
    const result = verifyPhoneOtpSchema.safeParse({
      challengeId: "550e8400-e29b-41d4-a716-446655440000",
      code: "123456",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing challengeId", () => {
    const result = verifyPhoneOtpSchema.safeParse({ code: "123456" });
    expect(result.success).toBe(false);
  });

  it("rejects non-UUID challengeId", () => {
    const result = verifyPhoneOtpSchema.safeParse({
      challengeId: "not-a-uuid",
      code: "123456",
    });
    expect(result.success).toBe(false);
  });

  it("rejects code shorter than 6 digits", () => {
    const result = verifyPhoneOtpSchema.safeParse({
      challengeId: "550e8400-e29b-41d4-a716-446655440000",
      code: "12345",
    });
    expect(result.success).toBe(false);
  });

  it("rejects code longer than 6 digits", () => {
    const result = verifyPhoneOtpSchema.safeParse({
      challengeId: "550e8400-e29b-41d4-a716-446655440000",
      code: "1234567",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric code", () => {
    const result = verifyPhoneOtpSchema.safeParse({
      challengeId: "550e8400-e29b-41d4-a716-446655440000",
      code: "abcdef",
    });
    expect(result.success).toBe(false);
  });

  it("rejects code with mixed alphanumeric", () => {
    const result = verifyPhoneOtpSchema.safeParse({
      challengeId: "550e8400-e29b-41d4-a716-446655440000",
      code: "12ab56",
    });
    expect(result.success).toBe(false);
  });
});
