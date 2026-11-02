import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getClientPlatform,
  isIosExternalDigitalPurchaseAllowed,
  shouldBlockIosDigitalPurchase,
  IOS_IAP_REQUIRED_CODE,
} from "../src/helpers/client-platform.js";

describe("getClientPlatform", () => {
  const req = (headers: Record<string, string>, body: Record<string, unknown> = {}) =>
    ({ headers, body }) as never;

  it("detects iOS from the X-Client-Platform header", () => {
    expect(getClientPlatform(req({ "x-client-platform": "iOS" }))).toBe("ios");
  });

  it("detects iOS from the body fallback", () => {
    expect(getClientPlatform(req({}, { platform: "iphone" }))).toBe("ios");
  });

  it("detects Android and web", () => {
    expect(getClientPlatform(req({ "x-client-platform": "android" }))).toBe("android");
    expect(getClientPlatform(req({ "x-client-platform": "web" }))).toBe("web");
  });

  it("falls back to an iOS User-Agent when no platform is declared", () => {
    expect(getClientPlatform(req({ "user-agent": "DiasporaSync/1.0 (iPhone; iOS 18.0)" }))).toBe(
      "ios",
    );
  });

  it("does not misclassify an unknown client", () => {
    expect(getClientPlatform(req({ "user-agent": "curl/8.0" }))).toBe("unknown");
  });
});

describe("iOS digital-purchase policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires IAP for a paid tier on iOS when external purchases are off", () => {
    expect(
      shouldBlockIosDigitalPurchase({
        platform: "ios",
        price: 50,
        tierCode: "BASIC",
        externalPurchasesAllowed: false,
      }),
    ).toBe(true);
  });

  it("allows a paid tier on iOS when the entitlement is enabled", () => {
    expect(
      shouldBlockIosDigitalPurchase({
        platform: "ios",
        price: 50,
        tierCode: "BASIC",
        externalPurchasesAllowed: true,
      }),
    ).toBe(false);
  });

  it("never blocks free plans or other platforms", () => {
    expect(
      shouldBlockIosDigitalPurchase({
        platform: "ios",
        price: 0,
        tierCode: "FREE",
        externalPurchasesAllowed: false,
      }),
    ).toBe(false);

    for (const platform of ["android", "web", "unknown"] as const) {
      expect(
        shouldBlockIosDigitalPurchase({
          platform,
          price: 50,
          tierCode: "BASIC",
          externalPurchasesAllowed: false,
        }),
      ).toBe(false);
    }
  });

  it("reads the env opt-in", () => {
    vi.stubEnv("IOS_EXTERNAL_DIGITAL_PURCHASES", "true");
    expect(isIosExternalDigitalPurchaseAllowed()).toBe(true);
    vi.stubEnv("IOS_EXTERNAL_DIGITAL_PURCHASES", "false");
    expect(isIosExternalDigitalPurchaseAllowed()).toBe(false);
  });

  it("exposes a stable error code for clients", () => {
    expect(IOS_IAP_REQUIRED_CODE).toBe("DIGITAL_PURCHASE_REQUIRES_IAP");
  });
});
