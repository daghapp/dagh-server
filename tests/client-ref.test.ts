import { describe, expect, it } from "vitest";
import {
  generateClientReference,
  generateClientReference_targetType,
} from "../src/helpers/client-ref.js";

// Hubtel rejects client references longer than 36 characters
const HUBTEL_MAX_LENGTH = 36;

describe("generateClientReference_targetType", () => {
  it("produces a reference within Hubtel's 36-char limit for long target types", () => {
    for (const targetType of [
      "MEMBERSHIP_SUBSCRIPTION",
      "TOUR_BOOKING",
      "TOUR_REQUEST",
      "VISA_ON_ARRIVAL",
    ]) {
      for (let i = 0; i < 20; i++) {
        const ref = generateClientReference_targetType(targetType);
        expect(ref.length).toBeLessThanOrEqual(HUBTEL_MAX_LENGTH);
        expect(ref.startsWith("TXN-")).toBe(true);
      }
    }
  });

  it("is unique across calls", () => {
    const refs = new Set(
      Array.from({ length: 50 }, () =>
        generateClientReference_targetType("MEMBERSHIP_SUBSCRIPTION"),
      ),
    );
    expect(refs.size).toBe(50);
  });
});

describe("generateClientReference", () => {
  it("produces a reference within Hubtel's 36-char limit", () => {
    const ref = generateClientReference();
    expect(ref.length).toBeLessThanOrEqual(HUBTEL_MAX_LENGTH);
  });
});
