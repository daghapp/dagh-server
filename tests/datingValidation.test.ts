import { describe, expect, it } from "vitest";
import {
  datingProfileSchema,
  discoveryPreferenceSchema,
  swipeSchema,
} from "../src/validator/datingValidation.js";

describe("datingProfileSchema", () => {
  it("accepts a minimal update", () => {
    const result = datingProfileSchema.safeParse({ headline: "Adventurer" });
    expect(result.success).toBe(true);
  });

  it("rejects photos over the 9-photo limit", () => {
    const photos = Array.from({ length: 10 }, (_, i) => `https://img.example.com/${i}.jpg`);
    const result = datingProfileSchema.safeParse({ photos });
    expect(result.success).toBe(false);
  });

  it("rejects invalid photo URLs", () => {
    const result = datingProfileSchema.safeParse({ photos: ["not-a-url"] });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid lookingFor value", () => {
    const result = datingProfileSchema.safeParse({ lookingFor: "BOGUS" });
    expect(result.success).toBe(false);
  });

  it("accepts the full profile-settings payload", () => {
    const result = datingProfileSchema.safeParse({
      location: "Accra, Ghana",
      degree: "BSc Computer Science",
      university: "University of Ghana",
      profession: "Software Engineer",
      industry: "Technology",
      workLocation: "Accra",
      languages: ["English", "Twi"],
      religion: "Christianity",
      hometown: "Kumasi",
      lookingFor: "LONG_TERM_PARTNER",
      interests: ["Cooking", "Photography", "Tech"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-string location", () => {
    const result = datingProfileSchema.safeParse({ location: 123 });
    expect(result.success).toBe(false);
  });

  it("rejects non-string entries in languages", () => {
    const result = datingProfileSchema.safeParse({ languages: ["English", 42] });
    expect(result.success).toBe(false);
  });

  it("rejects an over-long religion value", () => {
    const result = datingProfileSchema.safeParse({ religion: "x".repeat(61) });
    expect(result.success).toBe(false);
  });

  it("accepts account-level fields from the creation form", () => {
    const result = datingProfileSchema.safeParse({
      fullName: "Ama Mensah",
      gender: "FEMALE",
      dateOfBirth: "1995-06-15",
      ethnicity: "African",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid account gender", () => {
    const result = datingProfileSchema.safeParse({ gender: "UNKNOWN" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid account ethnicity", () => {
    const result = datingProfileSchema.safeParse({ ethnicity: "Martian" });
    expect(result.success).toBe(false);
  });

  it("rejects an account date of birth in the future", () => {
    const result = datingProfileSchema.safeParse({ dateOfBirth: "2099-01-01" });
    expect(result.success).toBe(false);
  });
});

describe("discoveryPreferenceSchema", () => {
  it("accepts valid preferences", () => {
    const result = discoveryPreferenceSchema.safeParse({
      genderPreference: ["MALE", "FEMALE"],
      minAge: 25,
      maxAge: 35,
      maxDistanceKm: 100,
      showProfile: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects minAge below 18", () => {
    const result = discoveryPreferenceSchema.safeParse({ minAge: 16 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid gender preference", () => {
    const result = discoveryPreferenceSchema.safeParse({ genderPreference: ["UNKNOWN"] });
    expect(result.success).toBe(false);
  });
});

describe("swipeSchema", () => {
  it("accepts a valid swipe", () => {
    const result = swipeSchema.safeParse({
      targetId: "5b4e8a1c-7f9d-4e2b-9c3a-1f6d0e5a2b8c",
      direction: "LIKE",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid direction", () => {
    const result = swipeSchema.safeParse({
      targetId: "5b4e8a1c-7f9d-4e2b-9c3a-1f6d0e5a2b8c",
      direction: "MAYBE",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID target", () => {
    const result = swipeSchema.safeParse({ targetId: "abc", direction: "PASS" });
    expect(result.success).toBe(false);
  });
});
