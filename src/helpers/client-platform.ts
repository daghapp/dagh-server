// ─────────────────────────────────────────
// Client platform detection & iOS purchase policy
// ─────────────────────────────────────────
// Apple Guideline 3.1.1 requires digital goods and subscriptions consumed in
// the app to be sold through In-App Purchase. The API sells memberships through
// Hubtel's hosted checkout, which is fine for Android/web and for physical or
// person-to-person services under 3.1.3(e) — but a paid digital membership
// cannot be unlocked from an external checkout on iOS.
//
// The app declares its platform on every request (`X-Client-Platform`), with a
// body `platform` fallback and a User-Agent fallback so an iOS client cannot
// accidentally bypass the gate. Set IOS_EXTERNAL_DIGITAL_PURCHASES=true only if
// the build ships Apple's External Purchase Link entitlement and the reviewer
// instructions cover that region.

import type { Request } from "express";

export type ClientPlatform = "ios" | "android" | "web" | "unknown";

export const IOS_IAP_REQUIRED_CODE = "DIGITAL_PURCHASE_REQUIRES_IAP";

export const IOS_IAP_REQUIRED_MESSAGE =
  "Digital memberships on iOS must be purchased through Apple In-App Purchase.";

const IOS_VALUES = new Set(["ios", "iphone", "ipad", "ipados"]);
const ANDROID_VALUES = new Set(["android"]);
const WEB_VALUES = new Set(["web", "browser"]);

function normalize(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

/**
 * Resolves the calling client's platform. Header first (explicit contract),
 * then the validated request body, then a conservative User-Agent fallback.
 */
export function getClientPlatform(req: Pick<Request, "headers" | "body">): ClientPlatform {
  const header = normalize(req.headers["x-client-platform"]);
  const body = normalize((req.body as Record<string, unknown> | undefined)?.platform);
  const declared = header ?? body;

  if (declared) {
    if (IOS_VALUES.has(declared)) return "ios";
    if (ANDROID_VALUES.has(declared)) return "android";
    if (WEB_VALUES.has(declared)) return "web";
  }

  const userAgent = normalize(req.headers["user-agent"]);
  if (userAgent) {
    if (/iphone|ipad|ipod|\bios\b/.test(userAgent)) return "ios";
    if (/android/.test(userAgent)) return "android";
  }

  return "unknown";
}

/** True only when the deployment has Apple's external-purchase entitlement. */
export function isIosExternalDigitalPurchaseAllowed(): boolean {
  return process.env.IOS_EXTERNAL_DIGITAL_PURCHASES === "true";
}

/**
 * Pure policy decision used by the membership checkout path. It only blocks
 * paid digital tiers on iOS when external purchase links are not allowed.
 */
export function shouldBlockIosDigitalPurchase(input: {
  platform: ClientPlatform;
  price: number;
  tierCode: string;
  externalPurchasesAllowed?: boolean;
}): boolean {
  if (input.platform !== "ios") return false;
  if (input.tierCode === "FREE" || input.price <= 0) return false;
  const allowed = input.externalPurchasesAllowed ?? isIosExternalDigitalPurchaseAllowed();
  return !allowed;
}
