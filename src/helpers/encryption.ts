// ─────────────────────────────────────────
// Symmetric Encryption for Stored Secrets
// ─────────────────────────────────────────
// AES-256-GCM with a fresh random IV per encryption and a 16-byte auth tag, so
// tampering with a stored ciphertext is detected on decrypt rather than silently
// yielding garbage credentials.
//
// The key lives in PAYMENT_GATEWAY_ENCRYPTION_KEY and is never logged. Every
// ciphertext is bound to a context string via GCM additional-authenticated-data
// (AAD): a value encrypted for `hubtel:clientSecret` cannot be decrypted as
// `hubtel:clientId`, so a row cannot be tampered with by moving ciphertext
// between columns.
//
// Wire format (all segments base64):
//   v1:<iv>:<authTag>:<ciphertext>
//
// Decryption failures raise a generic SecretDecryptionError on purpose — the
// underlying OpenSSL error can leak whether the key or the ciphertext was the
// wrong one, which is not something a caller (or a log line) should learn.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const VERSION = "v1";

// Deterministic key so the test suite can exercise real encrypt/decrypt without
// a .env file. Never reachable outside NODE_ENV=test.
const TEST_FALLBACK_KEY = Buffer.alloc(KEY_BYTES, 7).toString("hex");

export class SecretDecryptionError extends Error {
  constructor(message = "Unable to decrypt stored secret") {
    super(message);
    this.name = "SecretDecryptionError";
  }
}

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  const raw = process.env.PAYMENT_GATEWAY_ENCRYPTION_KEY;

  if (!raw) {
    if (process.env.NODE_ENV === "test") return Buffer.from(TEST_FALLBACK_KEY, "hex");
    throw new Error("PAYMENT_GATEWAY_ENCRYPTION_KEY is not set");
  }

  const key = /^[0-9a-fA-F]{64}$/.test(raw.trim())
    ? Buffer.from(raw.trim(), "hex")
    : Buffer.from(raw.trim(), "base64");

  if (key.length !== KEY_BYTES) {
    throw new Error(
      "PAYMENT_GATEWAY_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars)",
    );
  }

  return key;
}

function getKey(): Buffer {
  if (!cachedKey) cachedKey = loadKey();
  return cachedKey;
}

/**
 * Encrypts a secret for storage.
 *
 * @param plaintext the secret in the clear
 * @param context   binding label, e.g. "hubtel:clientSecret"
 */
export function encryptSecret(plaintext: string, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return [
    VERSION,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypts a stored secret.
 *
 * @throws {SecretDecryptionError} on malformed payloads, tampering, a wrong key,
 *         or a context/AAD mismatch.
 */
export function decryptSecret(payload: string, context: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretDecryptionError("Malformed encrypted payload");
  }

  const [, ivPart, tagPart, dataPart] = parts;

  try {
    const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivPart, "base64"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SecretDecryptionError();
  }
}

/**
 * Reports whether a value looks like output of {@link encryptSecret}, without
 * attempting decryption. Useful for detecting legacy plaintext rows.
 */
export function isEncryptedPayload(value: string): boolean {
  const parts = value.split(":");
  return parts.length === 4 && parts[0] === VERSION;
}

/** Test helper: drops the memoized key so env changes take effect. */
export function _resetEncryptionKeyCache(): void {
  cachedKey = null;
}
