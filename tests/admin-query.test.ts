import { describe, expect, it } from "vitest";
import {
  parsePagination,
  parseSearch,
  parseEnum,
  parseDateRange,
} from "../src/helpers/admin-query.js";

describe("parsePagination", () => {
  it("defaults to page 1 / limit 20", () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it("parses explicit page and limit", () => {
    expect(parsePagination({ page: "3", limit: "10" })).toEqual({
      page: 3,
      limit: 10,
      skip: 20,
    });
  });

  it("clamps page to >= 1", () => {
    expect(parsePagination({ page: "0" }).page).toBe(1);
    expect(parsePagination({ page: "-4" }).page).toBe(1);
    expect(parsePagination({ page: "abc" }).page).toBe(1);
  });

  it("clamps limit to [1, 100]", () => {
    expect(parsePagination({ limit: "500" }).limit).toBe(100);
    expect(parsePagination({ limit: "0" }).limit).toBe(1);
    expect(parsePagination({ limit: "nope" }).limit).toBe(20);
  });

  it("ignores array-valued query params and uses the first element", () => {
    expect(parsePagination({ page: ["2", "5"], limit: ["50"] })).toEqual({
      page: 2,
      limit: 50,
      skip: 50,
    });
  });
});

describe("parseSearch", () => {
  it("returns trimmed search term", () => {
    expect(parseSearch({ q: "  akwaaba  " })).toBe("akwaaba");
  });

  it("returns undefined when absent or blank", () => {
    expect(parseSearch({})).toBeUndefined();
    expect(parseSearch({ q: "" })).toBeUndefined();
    expect(parseSearch({ q: "   " })).toBeUndefined();
  });
});

describe("parseEnum", () => {
  const allowed = ["APPROVED", "REJECTED", "PENDING"] as const;

  it("normalises to uppercase", () => {
    expect(parseEnum({ status: "approved" }, "status", allowed)).toBe("APPROVED");
  });

  it("returns undefined for ALL or missing", () => {
    expect(parseEnum({ status: "ALL" }, "status", allowed)).toBeUndefined();
    expect(parseEnum({}, "status", allowed)).toBeUndefined();
  });

  it("returns undefined for invalid values instead of throwing", () => {
    expect(parseEnum({ status: "BOGUS" }, "status", allowed)).toBeUndefined();
  });
});

describe("parseDateRange", () => {
  it("returns an empty predicate when no dates are given", () => {
    expect(parseDateRange({})).toEqual({});
  });

  it("parses `from` as inclusive start", () => {
    const range = parseDateRange({ from: "2026-08-01" });
    expect(range.gte?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(range.lte).toBeUndefined();
  });

  it("treats `to` as end-of-day inclusive", () => {
    const range = parseDateRange({ to: "2026-08-13" });
    expect(range.gte).toBeUndefined();
    expect(range.lte?.toISOString()).toBe("2026-08-13T23:59:59.999Z");
  });

  it("ignores invalid date strings", () => {
    expect(parseDateRange({ from: "not-a-date", to: "also-bad" })).toEqual({});
  });
});
