import { describe, expect, it } from "vitest";
import { accountProfileSchema } from "../src/validator/account-profile-validator.js";

describe("accountProfileSchema", () => {
  it("accepts an empty update", () => {
    const result = accountProfileSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts all fields", () => {
    const result = accountProfileSchema.safeParse({
      username: "ama_mensah",
      firstName: "Ama",
      lastName: "Mensah",
      profileImageUrl: "https://res.cloudinary.com/demo/image/upload/ava.jpg",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null profileImageUrl to remove the picture", () => {
    const result = accountProfileSchema.safeParse({ profileImageUrl: null });
    expect(result.success).toBe(true);
    expect(result.data?.profileImageUrl).toBeNull();
  });

  it("normalizes username to trimmed lowercase", () => {
    const result = accountProfileSchema.safeParse({ username: "  Ama_Mensah " });
    expect(result.success).toBe(true);
    expect(result.data?.username).toBe("ama_mensah");
  });

  it("rejects a username that is too short", () => {
    const result = accountProfileSchema.safeParse({ username: "ab" });
    expect(result.success).toBe(false);
  });

  it("rejects a username with illegal characters", () => {
    const result = accountProfileSchema.safeParse({ username: "ama mensah" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid profile image URL", () => {
    const result = accountProfileSchema.safeParse({ profileImageUrl: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty firstName", () => {
    const result = accountProfileSchema.safeParse({ firstName: " " });
    expect(result.success).toBe(false);
  });
});
