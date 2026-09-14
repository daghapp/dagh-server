/**
 * Payment availability control.
 *
 * Persisted in the database via SystemSetting (key: "PAYMENTS_ENABLED")
 * with in-memory caching for minimal latency overhead.
 * Falls back to process.env.PAYMENTS_ENABLED === "true" if no database setting is recorded.
 *
 * When disabled, checkout / MOMO initialization endpoints reject with a 503
 * and PAYMENTS_DISABLED_MESSAGE. Callbacks and status verification for
 * already-initiated payments continue working.
 */
import { prisma } from "./prisma.js";

export const PAYMENT_SETTING_KEY = "PAYMENTS_ENABLED";

export const PAYMENTS_DISABLED_MESSAGE =
  "Payments are temporarily disabled. Please try again later.";

export interface PaymentControlDetails {
  enabled: boolean;
  reason: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

interface PaymentControlCache {
  enabled: boolean;
  reason: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  cachedAt: number;
}

let cache: PaymentControlCache | null = null;
const CACHE_TTL_MS = 10_000;

export let paymentsEnabled = process.env.PAYMENTS_ENABLED === "true";

function parseSettingValue(raw: string): { enabled: boolean; reason: string | null } {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "boolean") {
      return { enabled: parsed, reason: null };
    }
    if (parsed && typeof parsed === "object") {
      return {
        enabled: Boolean(parsed.enabled),
        reason: typeof parsed.reason === "string" ? parsed.reason : null,
      };
    }
  } catch {
    if (raw === "true") return { enabled: true, reason: null };
    if (raw === "false") return { enabled: false, reason: null };
  }
  return { enabled: process.env.PAYMENTS_ENABLED === "true", reason: null };
}

/**
 * Returns full payment control details, checking cache first then DB.
 */
export async function getPaymentControlDetails(): Promise<PaymentControlDetails> {
  const now = Date.now();
  if (cache && now - cache.cachedAt < CACHE_TTL_MS) {
    return {
      enabled: cache.enabled,
      reason: cache.reason,
      updatedAt: cache.updatedAt,
      updatedBy: cache.updatedBy,
    };
  }

  try {
    const record = await prisma.systemSetting.findUnique({
      where: { key: PAYMENT_SETTING_KEY },
    });

    if (record) {
      const { enabled, reason } = parseSettingValue(record.value);
      cache = {
        enabled,
        reason,
        updatedAt: record.updatedAt,
        updatedBy: record.updatedBy,
        cachedAt: now,
      };
      paymentsEnabled = enabled;
      return {
        enabled,
        reason,
        updatedAt: record.updatedAt,
        updatedBy: record.updatedBy,
      };
    }
  } catch (error) {
    console.error("Failed to fetch payment control setting from DB, using fallback:", error);
  }

  const defaultEnabled = process.env.PAYMENTS_ENABLED === "true";
  paymentsEnabled = defaultEnabled;
  const fallback = {
    enabled: defaultEnabled,
    reason: null,
    updatedAt: new Date(),
    updatedBy: null,
  };
  cache = { ...fallback, cachedAt: now };
  return fallback;
}

/**
 * Quick boolean check if payments are enabled.
 */
export async function isPaymentsEnabled(): Promise<boolean> {
  const details = await getPaymentControlDetails();
  return details.enabled;
}

/**
 * Updates the payment system status in the database and updates cache immediately.
 */
export async function setPaymentControlStatus(input: {
  enabled: boolean;
  reason?: string | null;
  updatedBy?: string | null;
}): Promise<PaymentControlDetails> {
  const payloadValue = JSON.stringify({
    enabled: input.enabled,
    reason: input.reason ?? null,
  });

  const record = await prisma.systemSetting.upsert({
    where: { key: PAYMENT_SETTING_KEY },
    create: {
      key: PAYMENT_SETTING_KEY,
      value: payloadValue,
      description: "Controls whether payments (Hubtel checkout & MOMO) are enabled across the system",
      updatedBy: input.updatedBy ?? null,
    },
    update: {
      value: payloadValue,
      updatedBy: input.updatedBy ?? null,
    },
  });

  const { enabled, reason } = parseSettingValue(record.value);
  cache = {
    enabled,
    reason,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
    cachedAt: Date.now(),
  };
  paymentsEnabled = enabled;

  return {
    enabled,
    reason,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  };
}

/**
 * Test helper to clear in-memory cache.
 */
export function _resetPaymentControlCache(): void {
  cache = null;
  paymentsEnabled = process.env.PAYMENTS_ENABLED === "true";
}