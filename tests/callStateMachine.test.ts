import { describe, it, expect } from "vitest";
import { canTransition, isTerminal } from "../src/helpers/callTransitions.js";

describe("call state machine transitions", () => {
  it("allows the spec-compliant happy path RINGING -> ANSWERED -> ENDED", () => {
    expect(canTransition("RINGING", "ANSWERED")).toBe(true);
    expect(canTransition("ANSWERED", "ENDED")).toBe(true);
  });

  it("allows RINGING to be declined, cancelled, or missed", () => {
    expect(canTransition("RINGING", "DECLINED")).toBe(true);
    expect(canTransition("RINGING", "CANCELLED")).toBe(true);
    expect(canTransition("RINGING", "MISSED")).toBe(true);
    expect(canTransition("RINGING", "FAILED")).toBe(true);
  });

  it("allows ANSWERED to fail", () => {
    expect(canTransition("ANSWERED", "FAILED")).toBe(true);
  });

  it("rejects answer after a terminal state", () => {
    expect(canTransition("DECLINED", "ANSWERED")).toBe(false);
    expect(canTransition("CANCELLED", "ANSWERED")).toBe(false);
    expect(canTransition("MISSED", "ANSWERED")).toBe(false);
    expect(canTransition("ENDED", "ANSWERED")).toBe(false);
    expect(canTransition("FAILED", "ANSWERED")).toBe(false);
  });

  it("rejects cancel/decline after the call was answered", () => {
    expect(canTransition("ANSWERED", "DECLINED")).toBe(false);
    expect(canTransition("ANSWERED", "CANCELLED")).toBe(false);
  });

  it("rejects transitions out of INITIATING except RINGING/FAILED", () => {
    expect(canTransition("INITIATING", "RINGING")).toBe(true);
    expect(canTransition("INITIATING", "ANSWERED")).toBe(false);
    expect(canTransition("INITIATING", "CANCELLED")).toBe(false);
  });
});

describe("isTerminal", () => {
  it("treats DECLINED/CANCELLED/MISSED/ENDED/FAILED as terminal", () => {
    for (const status of ["DECLINED", "CANCELLED", "MISSED", "ENDED", "FAILED"] as const) {
      expect(isTerminal(status)).toBe(true);
    }
  });

  it("treats RINGING and ANSWERED as non-terminal", () => {
    expect(isTerminal("RINGING")).toBe(false);
    expect(isTerminal("ANSWERED")).toBe(false);
    expect(isTerminal("INITIATING")).toBe(false);
  });
});
