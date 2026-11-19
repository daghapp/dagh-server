import { describe, expect, it } from "vitest";
import {
  hashPhoneCandidates,
  hashPhoneNumber,
  phoneDigitCandidates,
} from "../src/helpers/phoneHash.js";

describe("phone digit candidates", () => {
  it("expands a local Ghana number to its E.164 digit form", () => {
    expect(phoneDigitCandidates("0244000000")).toEqual(
      expect.arrayContaining(["0244000000", "233244000000"]),
    );
  });

  it("adds the legacy local form for an E.164 number", () => {
    expect(phoneDigitCandidates("+233244000000")).toEqual(
      expect.arrayContaining(["233244000000", "0244000000"]),
    );
  });
});

describe("hashPhoneCandidates", () => {
  it("matches a locally-stored contact against an E.164 registration hash", () => {
    const registeredHash = hashPhoneNumber("+233244000000");
    expect(hashPhoneCandidates("0244000000")).toContain(registeredHash);
    expect(hashPhoneCandidates("244000000")).toContain(registeredHash);
  });

  it("matches an E.164 contact against a legacy local registration hash", () => {
    const legacyHash = hashPhoneNumber("0244000000");
    expect(hashPhoneCandidates("+233244000000")).toContain(legacyHash);
  });

  it("does not invent country-code variants for an already-international number", () => {
    const uk = phoneDigitCandidates("+447911123456");
    expect(uk).toEqual(["447911123456"]);
  });
});
