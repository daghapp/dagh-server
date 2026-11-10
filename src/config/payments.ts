/**
 * Payment availability control.
 *
 * Source of truth is the `PaymentGatewayConfig` row for the payment provider
 * (`paymentProcessingEnabled`), managed through Admin > Settings > Payment
 * Gateway. That replaced the original standalone `PAYMENTS_ENABLED` system
 * setting, which is now a legacy fallback: it is still honoured when no gateway
 * config row exists at all, so a deployment that has never opened the settings
 * screen keeps its current behaviour.
 *
 * Reads are cached in memory for a short TTL to keep this off the hot path;
 * writes refresh the cache synchronously.
 *
 * When disabled, checkout / MOMO initialization endpoints reject with a 503
 * and PAYMENTS_DISABLED_MESSAGE. Callbacks and status verification for
 * already-initiated payments continue working.
 */
import { prisma } from "./prisma.js";
import { setProcessingEnabled } from "../services/payment-gateway-config.service.js";
import { getRedisClient } from "./redis.js";

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
  const redis = getRedisClient();
  if (redis) {
    try {
      const cachedRaw = await redis.get("payment:control");
      if (cachedRaw) {
        const parsed = JSON.parse(cachedRaw) as PaymentControlCache;
        if (now - parsed.cachedAt < CACHE_TTL_MS) {
          paymentsEnabled = parsed.enabled;
          return {
            enabled: parsed.enabled,
            reason: parsed.reason,
            updatedAt: parsed.updatedAt,
            updatedBy: parsed.updatedBy,
          };
        }
      }
    } catch (e) {
      console.error("Redis payment cache read failed:", e);
    }
  }

  if (cache && now - cache.cachedAt < CACHE_TTL_MS) {
    return {
      enabled: cache.enabled,
      reason: cache.reason,
      updatedAt: cache.updatedAt,
      updatedBy: cache.updatedBy,
    };
  }

  try {
    const gateway = await prisma.paymentGatewayConfig.findUnique({
      where: { provider: "HUBTEL" },
      select: {
        paymentProcessingEnabled: true,
        processingDisabledReason: true,
        updatedAt: true,
        updatedBy: true,
      },
    });

    if (gateway) {
      const details: PaymentControlDetails = {
        enabled: gateway.paymentProcessingEnabled,
        reason: gateway.processingDisabledReason,
        updatedAt: gateway.updatedAt,
        updatedBy: gateway.updatedBy,
      };
      cache = { ...details, cachedAt: now };
      paymentsEnabled = details.enabled;
      const r = getRedisClient();
      if (r) {
        try {
          await r.set("payment:control", JSON.stringify(cache), {
            EX: Math.ceil(CACHE_TTL_MS / 1000),
          });
        } catch (e) {
          console.error("Redis payment cache write failed:", e);
        }
      }
      return details;
    }
  } catch (error) {
    console.error("Failed to fetch payment gateway config, using legacy setting:", error);
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
      const r2 = getRedisClient();
      if (r2) {
        try {
          await r2.set("payment:control", JSON.stringify(cache), {
            EX: Math.ceil(CACHE_TTL_MS / 1000),
          });
        } catch (e) {
          console.error("Redis payment cache write failed:", e);
        }
      }
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
  const r3 = getRedisClient();
  if (r3) {
    try {
      await r3.set("payment:control", JSON.stringify(cache), {
        EX: Math.ceil(CACHE_TTL_MS / 1000),
      });
    } catch (e) {
      console.error("Redis payment cache write failed:", e);
    }
  }
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
 * Updates the payment system status and updates cache immediately.
 *
 * Writes through to the gateway config row so this stays a single switch. The
 * `PAYMENTS_ENABLED` system setting is left untouched rather than deleted: it is
 * only consulted when no gateway row exists, and removing it would silently
 * change behaviour for any deployment still on the legacy path.
 */
export async function setPaymentControlStatus(input: {
  enabled: boolean;
  reason?: string | null;
  updatedBy?: string | null;
}): Promise<PaymentControlDetails> {
  const gateway = await prisma.paymentGatewayConfig.findUnique({
    where: { provider: "HUBTEL" },
    select: { id: true },
  });

  if (gateway) {
    const outcome = await setProcessingEnabled({
      enabled: input.enabled,
      reason: input.reason ?? undefined,
      actorId: input.updatedBy ?? null,
    });
    const r = getRedisClient();
    if (r) {
      try {
        await r.del("payment:control");
      } catch (e) {
        console.error("Redis payment cache invalidate failed:", e);
      }
    }
    return {
      enabled: outcome.paymentProcessingEnabled,
      reason: outcome.config.processingDisabledReason,
      updatedAt: outcome.effectiveAt,
      updatedBy: outcome.config.updatedBy,
    };
  }

  const payloadValue = JSON.stringify({
    enabled: input.enabled,
    reason: input.reason ?? null,
  });

  const record = await prisma.systemSetting.upsert({
    where: { key: PAYMENT_SETTING_KEY },
    create: {
      key: PAYMENT_SETTING_KEY,
      value: payloadValue,
      description:
        "Controls whether payments (Hubtel checkout & MOMO) are enabled across the system",
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

  const r2 = getRedisClient();
  if (r2) {
    try {
      await r2.del("payment:control");
    } catch (e) {
      console.error("Redis payment cache invalidate failed:", e);
    }
  }

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
