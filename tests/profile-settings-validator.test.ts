import { describe, expect, it } from "vitest";
import { profileSettingsSchema } from "../src/validator/profile-settings-validator.js";

describe("profileSettingsSchema", () => {
  it("accepts an empty update", () => {
    const result = profileSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts all fields", () => {
    const result = profileSettingsSchema.safeParse({
      fullName: "Ama Mensah",
      gender: "FEMALE",
      dateOfBirth: "1995-06-15",
      ethnicity: "African",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid gender", () => {
    const result = profileSettingsSchema.safeParse({ gender: "UNKNOWN" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid ethnicity", () => {
    const result = profileSettingsSchema.safeParse({ ethnicity: "Martian" });
    expect(result.success).toBe(false);
  });

  it("rejects a date of birth in the future", () => {
    const result = profileSettingsSchema.safeParse({ dateOfBirth: "2099-01-01" });
    expect(result.success).toBe(false);
  });

  it("rejects a short fullName", () => {
    const result = profileSettingsSchema.safeParse({ fullName: "A" });
    expect(result.success).toBe(false);
  });
});
