import { describe, expect, it } from "vitest";
import { verifiedHubtelStatus } from "../src/helpers/hubtel-status.js";

describe("Hubtel collection verification", () => {
  const payment = { reference: "ORDER-1", amount: 50, currency: "GHS" };
  const data = { clientReference: "ORDER-1", amount: 50, status: "Paid" };
  const payload = { responseCode: "0000", data };

  it("accepts only the matching paid collection", () => {
    expect(verifiedHubtelStatus(payload, payment)).toBe("SUCCESS");
    expect(
      verifiedHubtelStatus({ ...payload, data: { ...data, amount: 49 } }, payment),
    ).toBeNull();
    expect(
      verifiedHubtelStatus({ ...payload, data: { ...data, clientReference: "OTHER" } }, payment),
    ).toBeNull();
  });

  it("does not interpret successful API responses as successful payments", () => {
    expect(
      verifiedHubtelStatus({ ...payload, data: { ...data, status: "Unpaid" } }, payment),
    ).toBe("PENDING");
    expect(
      verifiedHubtelStatus({ ...payload, data: { ...data, status: "Refunded" } }, payment),
    ).toBeNull();
    expect(verifiedHubtelStatus({ responseCode: "0000" }, payment)).toBeNull();
  });

  it("rejects invalid amounts and unsupported currencies", () => {
    expect(
      verifiedHubtelStatus({ ...payload, data: { ...data, amount: NaN } }, payment),
    ).toBeNull();
    expect(verifiedHubtelStatus(payload, { ...payment, currency: "USD" })).toBeNull();
  });
});
