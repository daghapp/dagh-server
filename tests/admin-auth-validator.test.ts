import { describe, expect, it } from "vitest";
import { adminRegistrationSchema } from "../src/validator/admin-auth-validator.js";

const validPayload = {
  fullName: "Ama Mensah",
  email: "ama@dagh.app",
  password: "Password123!",
  department: "DIASPORA_AFFAIRS",
  role: "ADMIN",
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
