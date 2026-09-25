import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  _resetEncryptionKeyCache,
  decryptSecret,
  encryptSecret,
  isEncryptedPayload,
  SecretDecryptionError,
} from "../src/helpers/encryption.js";

const CONTEXT = "hubtel:clientSecret";
const OTHER_CONTEXT = "hubtel:clientId";

describe("encryption", () => {
  const originalKey = process.env.PAYMENT_GATEWAY_ENCRYPTION_KEY;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    _resetEncryptionKeyCache();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.PAYMENT_GATEWAY_ENCRYPTION_KEY;
    else process.env.PAYMENT_GATEWAY_ENCRYPTION_KEY = originalKey;
    process.env.NODE_ENV = originalNodeEnv;
    _resetEncryptionKeyCache();
  });

  it("round-trips a secret", () => {
    const ciphertext = encryptSecret("super-secret-value", CONTEXT);
    expect(decryptSecret(ciphertext, CONTEXT)).toBe("super-secret-value");
  });

  it("round-trips unicode and empty strings", () => {
    for (const value of ["", "pässwörd-🔐", "a".repeat(1000)]) {
      expect(decryptSecret(encryptSecret(value, CONTEXT), CONTEXT)).toBe(value);
    }
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptSecret("same", CONTEXT);
    const b = encryptSecret("same", CONTEXT);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, CONTEXT)).toBe(decryptSecret(b, CONTEXT));
  });

  it("never stores the plaintext in the payload", () => {
    const ciphertext = encryptSecret("super-secret-value", CONTEXT);
    expect(ciphertext).not.toContain("super-secret-value");
    expect(isEncryptedPayload(ciphertext)).toBe(true);
  });

  it("refuses to decrypt under a different context (AAD binding)", () => {
    const ciphertext = encryptSecret("super-secret-value", CONTEXT);
    // Guards against ciphertext being moved between the clientId and
    // clientSecret columns.
    expect(() => decryptSecret(ciphertext, OTHER_CONTEXT)).toThrow(SecretDecryptionError);
  });

  it("detects tampering with the ciphertext", () => {
    const ciphertext = encryptSecret("super-secret-value", CONTEXT);
    const parts = ciphertext.split(":");
    const data = Buffer.from(parts[3], "base64");
    data[0] ^= 0xff;
    parts[3] = data.toString("base64");

    expect(() => decryptSecret(parts.join(":"), CONTEXT)).toThrow(SecretDecryptionError);
  });

  it("rejects a malformed payload", () => {
    for (const bad of ["", "not-encrypted", "v1:only:three", "v2:a:b:c", "v1:a:b:c:d"]) {
      expect(() => decryptSecret(bad, CONTEXT)).toThrow(SecretDecryptionError);
    }
  });

  it("fails to decrypt under a different key", () => {
    process.env.PAYMENT_GATEWAY_ENCRYPTION_KEY = "a".repeat(64);
    _resetEncryptionKeyCache();
    const ciphertext = encryptSecret("super-secret-value", CONTEXT);

    process.env.PAYMENT_GATEWAY_ENCRYPTION_KEY = "b".repeat(64);
    _resetEncryptionKeyCache();

    expect(() => decryptSecret(ciphertext, CONTEXT)).toThrow(SecretDecryptionError);
  });

  it("accepts hex and base64 keys interchangeably", () => {
    process.env.PAYMENT_GATEWAY_ENCRYPTION_KEY = "c".repeat(64);
    _resetEncryptionKeyCache();
    const withHex = encryptSecret("value", CONTEXT);

    process.env.PAYMENT_GATEWAY_ENCRYPTION_KEY = Buffer.from("c".repeat(64), "hex").toString(
      "base64",
    );
    _resetEncryptionKeyCache();

    expect(decryptSecret(withHex, CONTEXT)).toBe("value");
  });

  it("rejects a key that is not 32 bytes", () => {
    process.env.PAYMENT_GATEWAY_ENCRYPTION_KEY = "too-short";
    _resetEncryptionKeyCache();
    expect(() => encryptSecret("value", CONTEXT)).toThrow(/exactly 32 bytes/);
  });

  it("rejects a missing key outside test mode", () => {
    process.env.NODE_ENV = "production";
    delete process.env.PAYMENT_GATEWAY_ENCRYPTION_KEY;
    _resetEncryptionKeyCache();
    expect(() => encryptSecret("value", CONTEXT)).toThrow(/PAYMENT_GATEWAY_ENCRYPTION_KEY/);
  });

  it("does not report plaintext as an encrypted payload", () => {
    expect(isEncryptedPayload("plaintext-secret")).toBe(false);
  });
});
