import { createHmac, randomBytes, randomInt, timingSafeEqual, createHash } from "crypto";

const ISSUER = "DAGH Admin Console";
const PERIOD_SECONDS = 30;
const DIGITS = 6;
const ALGORITHM = "sha1";

/**
 * RFC 4226 HOTP over RFC 6238 TOTP, SHA-1 / 6 digits / 30s.
 *
 * Implemented against node:crypto rather than an OTP library because the spec
 * pins the parameters exactly (SHA-1, 30 s) and the accepted authenticator apps
 * are already fixed by the QR standard, not by us.
 */

/** Base32 (RFC 4648) without padding — the encoding authenticator apps expect. */
function base32Encode(buffer: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }

  return output;
}

/** Generates a new shared secret, base32 encoded. */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export interface TotpSetup {
  secret: string;
  /** The full otpauth:// URI to encode as a QR code. */
  otpauthUri: string;
  /** Grouped manual-entry key, e.g. `DAGH ABCD EFGH IJKL MNOP`. */
  manualKey: string;
}

/**
 * Builds the provisioning material for an authenticator app.
 *
 * `issuer` is included both in the URI path and the `issuer` query parameter
 * because Google Authenticator (and its forks) key the label off the path while
 * some other apps read the query parameter, and a mismatch shows the app as two
 * separate entries.
 */
export function buildTotpSetup(accountEmail: string, secret: string): TotpSetup {
  const label = `${ISSUER}:${accountEmail}`;
  const otpauthUri =
    `otpauth://totp/${encodeURIComponent(label)}` +
    `?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}` +
    `&algorithm=${ALGORITHM.toUpperCase()}&digits=${DIGITS}&period=${PERIOD_SECONDS}`;

  return { secret, otpauthUri, manualKey: formatManualKey(secret) };
}

/** `DAGH XXXX XXXX XXXX XXXX` — readable over the phone, unambiguous to type. */
export function formatManualKey(secret: string): string {
  const groups = secret.match(/.{1,4}/g) ?? [secret];
  return `${ISSUER.split(" ")[0]} ${groups.join(" ")}`;
}

/** The HOTP value for one counter (time step). */
export function hotp(secret: string, counter: number): string {
  const key = decodeBase32(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac(ALGORITHM, key).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;

  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/** The current TOTP code for a secret. Exposed for tests only. */
export function currentTotp(secret: string, atMs = Date.now()): string {
  return hotp(secret, Math.floor(atMs / 1000 / PERIOD_SECONDS));
}

/**
 * Verifies a submitted code.
 *
 * `window` accepts the neighbouring time steps, which is what makes a code
 * accepted for a few seconds either side of the boundary. That tolerance is
 * required for the mobile web client, where the device clock can be slightly
 * off; it is one step either side, not more, so a leaked code is not valid for
 * minutes.
 */
export function verifyTotp(secret: string, code: string, window = 1): boolean {
  const cleaned = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;

  const currentCounter = Math.floor(Date.now() / 1000 / PERIOD_SECONDS);

  for (let offset = -window; offset <= window; offset += 1) {
    const expected = hotp(secret, currentCounter + offset);
    if (safeEqual(expected, cleaned)) return true;
  }

  return false;
}

/** Constant-time comparison of two same-length digit strings. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function decodeBase32(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");

  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of cleaned) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

/** `DAGH-XXXX-XXXX` backup code. */
export function generateBackupCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = (n: number) =>
    Array.from({ length: n }, () => alphabet[randomInt(0, alphabet.length)]).join("");
  return `DAGH-${pick(4)}-${pick(4)}`;
}

/** Derives the stored form of a backup code; the plaintext is never persisted. */
export function hashBackupCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export { PERIOD_SECONDS as TOTP_PERIOD_SECONDS, ISSUER as TOTP_ISSUER };
