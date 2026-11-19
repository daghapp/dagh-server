import crypto from "crypto";

/**
 * Default country code used to expand local phone numbers (e.g. Ghana's 024…
 * → 233…). Contacts are frequently stored locally while registration requires
 * E.164, so the same person hashes differently unless we consider both forms.
 */
const DEFAULT_COUNTRY_CODE = (process.env.DEFAULT_PHONE_COUNTRY_CODE || "233").replace(/\D/g, "");

export function normalizePhoneNumber(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, "");
  return digits;
}

export function hashPhoneNumber(phone: string | null | undefined): string {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return "";
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/**
 * Plausible stored digit forms for a phone number. A device contact may be
 * local (`0244000000`), international (`+233244000000`) or missing a leading
 * zero (`244000000`), while users' stored hashes come from E.164 input. We
 * return every variant so matching is format-independent.
 */
export function phoneDigitCandidates(phone: string | null | undefined): string[] {
  const raw = normalizePhoneNumber(phone);
  if (!raw) return [];

  const candidates = new Set<string>([raw]);
  const cc = DEFAULT_COUNTRY_CODE;

  if (cc) {
    if (raw.startsWith("0")) {
      candidates.add(cc + raw.slice(1));
    } else if (!raw.startsWith(cc) && raw.length <= 10) {
      candidates.add(cc + raw);
    }
    // Also cover legacy rows stored in local form when the input is E.164.
    if (raw.startsWith(cc) && raw.length > cc.length) {
      candidates.add("0" + raw.slice(cc.length));
    }
  }

  return [...candidates];
}

/** SHA-256 hashes for every plausible digit form of a phone number. */
export function hashPhoneCandidates(phone: string | null | undefined): string[] {
  return phoneDigitCandidates(phone)
    .map((digits) => crypto.createHash("sha256").update(digits).digest("hex"))
    .filter(Boolean);
}

export const hashPhone = hashPhoneNumber;
export const normalizePhone = normalizePhoneNumber;
