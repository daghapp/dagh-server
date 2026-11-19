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
      // Local with leading zero (e.g. 0244000000): also store the national
      // form without the zero and the E.164 form with the country code.
      const national = raw.slice(1);
      candidates.add(national);
      candidates.add(cc + national);
    } else if (raw.startsWith(cc) && raw.length > cc.length) {
      // E.164 (e.g. 233244000000): also store the local forms.
      const national = raw.slice(cc.length);
      candidates.add("0" + national);
      candidates.add(national);
    } else if (raw.length <= 10 && !raw.startsWith(cc)) {
      // Local without leading zero (e.g. 244000000).
      candidates.add("0" + raw);
      candidates.add(cc + raw);
    }
    // International prefix form (e.g. 00233244000000).
    if (raw.startsWith("00") && raw.length > 2 + cc.length && raw.slice(2).startsWith(cc)) {
      candidates.add(raw.slice(2));
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

/**
 * Values a client may hash before sending a contact. Some apps hash the raw
 * device value (`+233 24 400 0000`) instead of digits only, so lookups must
 * cover both raw strings and digit variants.
 */
export function phoneHashCandidateStrings(phone: string | null | undefined): string[] {
  if (phone === null || phone === undefined) return [];
  const original = String(phone).trim();
  if (!original) return [];

  const digits = normalizePhoneNumber(original);
  const values = new Set<string>([original]);
  if (!digits) return [...values];

  const digitForms = phoneDigitCandidates(digits);
  for (const value of digitForms) {
    values.add(value);
    values.add(`+${value}`);
    if (!value.startsWith("00")) values.add(`00${value}`);
  }

  return [...values];
}

/** SHA-256 hashes for raw and digit forms of a phone number. */
export function hashPhoneLookupCandidates(phone: string | null | undefined): string[] {
  const hashes = phoneHashCandidateStrings(phone).map((value) =>
    crypto.createHash("sha256").update(value).digest("hex"),
  );
  return [...new Set(hashes)];
}

export const hashPhone = hashPhoneNumber;
export const normalizePhone = normalizePhoneNumber;
