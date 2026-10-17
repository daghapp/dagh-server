import { prisma } from "../config/prisma.js";

/**
 * Platform settings backing store (§3.11).
 *
 * One `PlatformSetting` row per tab (`general`, `security`, `notifications`,
 * `membership`), each holding a JSON object merged over the defaults below.
 * Reads are cached for 60s; writes invalidate the cache. Falls back to the
 * defaults when the row is absent so the API works before anyone saves.
 */

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: unknown; expires: number }>();

export const SETTING_TABS = ["general", "security", "notifications", "membership"] as const;
export type SettingTab = (typeof SETTING_TABS)[number];

export const SETTING_DEFAULTS: Record<SettingTab, Record<string, unknown>> = {
  general: {
    platformName: "DAGH",
    supportEmail: "support@diaspora.gov.gh",
    officialWebsite: "https://diaspora.gov.gh",
    timezone: "Africa/Accra",
    dateFormat: "YYYY-MM-DD",
    defaultCurrency: "GHS",
    language: "en",
  },
  security: {
    sessionTimeoutMinutes: 60,
    maxLoginAttempts: 5,
    passwordExpiryDays: 90,
    require2FAForAdmins: false,
  },
  notifications: {
    email: true,
    sms: true,
    push: true,
    weeklyDigest: false,
  },
  membership: {
    trialPeriodDays: 0,
    gracePeriodDays: 7,
    autoRenew: true,
    requireNgoVerification: true,
    lifetimeAccessEligibility: "SUPER_ADMIN",
  },
};

export async function getSettingTab<T extends Record<string, unknown>>(
  tab: SettingTab,
): Promise<T> {
  const hit = cache.get(tab);
  if (hit && hit.expires > Date.now())
    return { ...SETTING_DEFAULTS[tab], ...(hit.value as object) } as T;
  let stored: Record<string, unknown> = {};
  try {
    const row = await prisma.platformSetting.findUnique({ where: { key: tab } });
    if (row?.value && typeof row.value === "object") stored = row.value as Record<string, unknown>;
  } catch (error) {
    console.error(`[settings] failed to read tab "${tab}":`, error);
  }
  cache.set(tab, { value: stored, expires: Date.now() + CACHE_TTL_MS });
  return { ...SETTING_DEFAULTS[tab], ...stored } as T;
}

export async function updateSettingTab(
  tab: SettingTab,
  patch: Record<string, unknown>,
  updatedBy?: string,
): Promise<Record<string, unknown>> {
  const current = await getSettingTab(tab);
  const merged = { ...current, ...patch };
  await prisma.platformSetting.upsert({
    where: { key: tab },
    create: { key: tab, value: merged as object, updatedBy: updatedBy ?? null },
    update: { value: merged as object, updatedBy: updatedBy ?? null },
  });
  cache.delete(tab);
  return merged;
}

export interface SecuritySettings {
  sessionTimeoutMinutes: number;
  maxLoginAttempts: number;
  passwordExpiryDays: number;
  require2FAForAdmins: boolean;
}

export async function getSecuritySettings(): Promise<SecuritySettings> {
  const tab = await getSettingTab<Record<string, unknown>>("security");
  return {
    sessionTimeoutMinutes: Number(tab.sessionTimeoutMinutes) || 60,
    maxLoginAttempts: Number(tab.maxLoginAttempts) || 5,
    passwordExpiryDays: Number(tab.passwordExpiryDays) || 90,
    require2FAForAdmins: tab.require2FAForAdmins === true,
  };
}

/** True when the user's password is older than the configured expiry window. */
export function isPasswordExpired(
  passwordLastChanged: Date | null | undefined,
  expiryDays: number,
): boolean {
  if (!passwordLastChanged || !(expiryDays > 0)) return false;
  return Date.now() - passwordLastChanged.getTime() > expiryDays * 24 * 60 * 60 * 1000;
}
