import { describe, expect, it } from "vitest";
import { adminRegistrationSchema } from "../src/validator/admin-auth-validator.js";

const validPayload = {
  fullName: "Ama Mensah",
  email: "ama@dagh.app",
  password: "Password123!",
  department: "OPERATIONS_AND_MEMBERSHIP",
  role: "OPERATIONS",
};

describe("adminRegistrationSchema", () => {
  it("accepts a valid registration", () => {
    const result = adminRegistrationSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("accepts an optional phone number", () => {
    const result = adminRegistrationSchema.safeParse({
      ...validPayload,
      phoneNumber: "+233201234567",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const result = adminRegistrationSchema.safeParse({ ...validPayload, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid department", () => {
    const result = adminRegistrationSchema.safeParse({ ...validPayload, department: "SPACE" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid role", () => {
    const result = adminRegistrationSchema.safeParse({ ...validPayload, role: "KING" });
    expect(result.success).toBe(false);
  });

  it("rejects a role that does not belong to the department", () => {
    const result = adminRegistrationSchema.safeParse({
      ...validPayload,
      department: "FINANCE_AND_COMPLIANCE",
      role: "OPERATIONS",
    });
    expect(result.success).toBe(false);
  });

  it("accepts each role in its own department", () => {
    const cases: Array<{ department: string; role: string }> = [
      { department: "EXECUTIVE_MANAGEMENT", role: "SUPER_ADMIN" },
      { department: "OPERATIONS_AND_MEMBERSHIP", role: "OPERATIONS" },
      { department: "FINANCE_AND_COMPLIANCE", role: "FINANCE" },
      { department: "TECHNICAL_SUPPORT", role: "SUPPORT" },
    ];
    for (const c of cases) {
      const result = adminRegistrationSchema.safeParse({ ...validPayload, ...c });
      expect(result.success).toBe(true);
    }
  });

  it("rejects a short full name", () => {
    const result = adminRegistrationSchema.safeParse({ ...validPayload, fullName: "A" });
    expect(result.success).toBe(false);
  });

  it("rejects a weak password", () => {
    const result = adminRegistrationSchema.safeParse({ ...validPayload, password: "password" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed phone number", () => {
    const result = adminRegistrationSchema.safeParse({
      ...validPayload,
      phoneNumber: "12345",
    });
    expect(result.success).toBe(false);
  });
});
