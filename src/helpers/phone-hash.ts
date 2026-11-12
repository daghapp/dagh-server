import crypto from "crypto";

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

export const hashPhone = hashPhoneNumber;
export const normalizePhone = normalizePhoneNumber;
