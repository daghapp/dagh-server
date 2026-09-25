import { describe, expect, it } from "vitest";
import { deleteAccountSchema } from "../src/validator/account-profile-validator.js";

describe("deleteAccountSchema", () => {
  it("accepts a password (email/password accounts)", () => {
    const result = deleteAccountSchema.safeParse({ password: "supersecret" });
    expect(result.success).toBe(true);
  });

  it("accepts an empty body (OAuth-only accounts have no password)", () => {
    const result = deleteAccountSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects a blank password", () => {
    const result = deleteAccountSchema.safeParse({ password: " " });
    expect(result.success).toBe(false);
  });

  it("rejects a non-string password", () => {
    const result = deleteAccountSchema.safeParse({ password: 123 });
    expect(result.success).toBe(false);
  });
});
