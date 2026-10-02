import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { envNumber } from "../src/helpers/env-number.js";

/**
 * `Number(process.env.X || fallback)` silently yields NaN for any non-numeric
 * value, and NaN then propagates into a Redis `PX` argument, a `new Date(now -
 * NaN)` predicate, or a loop deadline — where `Date.now() >= NaN` is always
 * false and the loop never exits. These tests pin that a typo degrades to the
 * default instead.
 */

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("envNumber", () => {
  it("reads a valid value", () => {
    vi.stubEnv("SOME_MS", "5000");
    expect(envNumber("SOME_MS", 1000)).toBe(5000);
  });

  it("falls back when absent, blank, or whitespace", () => {
    expect(envNumber("SOME_MS", 1000)).toBe(1000);
    vi.stubEnv("SOME_MS", "");
    expect(envNumber("SOME_MS", 1000)).toBe(1000);
    vi.stubEnv("SOME_MS", "   ");
    expect(envNumber("SOME_MS", 1000)).toBe(1000);
  });

  it("falls back on a non-numeric value instead of returning NaN", () => {
    vi.stubEnv("SOME_MS", "abc");
    expect(envNumber("SOME_MS", 1000)).toBe(1000);
  });

  it("falls back on a partially numeric value like '60000ms'", () => {
    vi.stubEnv("SOME_MS", "60000ms");
    expect(envNumber("SOME_MS", 1000)).toBe(1000);
  });

  it("falls back on Infinity, which Number() would happily accept", () => {
    vi.stubEnv("SOME_MS", "Infinity");
    expect(envNumber("SOME_MS", 1000)).toBe(1000);
  });

  it("clamps to the range rather than propagating an out-of-bounds value", () => {
    vi.stubEnv("SOME_MS", "0");
    expect(envNumber("SOME_MS", 1000, 60_000, 600_000)).toBe(1000);
    vi.stubEnv("SOME_MS", "999999999");
    expect(envNumber("SOME_MS", 1000, 60_000, 600_000)).toBe(1000);
  });

  it("leaves the bound open when no max is given", () => {
    vi.stubEnv("SOME_MS", "999999999");
    expect(envNumber("SOME_MS", 1000, 60_000)).toBe(999999999);
  });

  it("accepts a value at the boundary", () => {
    vi.stubEnv("SOME_MS", "60000");
    expect(envNumber("SOME_MS", 1000, 60_000, 60_000)).toBe(60_000);
  });

  it("warns on a value it had to reject, so a typo is visible in the logs", () => {
    vi.stubEnv("SOME_MS", "abc");
    envNumber("SOME_MS", 1000);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("SOME_MS"));
  });

  it("stays silent for a valid value", () => {
    vi.stubEnv("SOME_MS", "5000");
    envNumber("SOME_MS", 1000);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
