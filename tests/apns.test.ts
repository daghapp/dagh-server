import { describe, it, expect } from "vitest";
import { createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { derToRawSignature } from "../src/config/apns.js";

/**
 * APNs provider-token signing uses ES256 (P-256) JWTs. The JWT spec requires
 * the signature as a raw r||s concatenation, but Node's `createSign` emits
 * ASN.1/DER — we must convert. These tests verify the conversion is correct by
 * (1) round-tripping a freshly parsed DER and (2) verifying the produced raw
 * signature against the public key using ieee-p1363 (raw) encoding.
 */
describe("derToRawSignature", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

  function signingInput(): Buffer {
    const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: "ABC123DEF4" })).toString(
      "base64url",
    );
    const claims = Buffer.from(
      JSON.stringify({ iss: "TEAMID", iat: Math.floor(Date.now() / 1000) }),
    ).toString("base64url");
    return Buffer.from(`${header}.${claims}`);
  }

  function signDer(data: Buffer): Buffer {
    return createSign("SHA256").update(data).sign({ key: privateKey, dsaEncoding: "der" });
  }

  function verifyRaw(data: Buffer, rawSignature: Buffer): boolean {
    return createVerify("SHA256")
      .update(data)
      .verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, rawSignature);
  }

  it("converts DER signatures to a 64-byte raw r||s that verifies", () => {
    const data = signingInput();
    const der = signDer(data);
    const actualRaw = derToRawSignature(der, 32);

    expect(actualRaw.length).toBe(64);
    expect(verifyRaw(data, actualRaw)).toBe(true);
  });

  it("round-trips through a JWT-shape signing input whenever high bit is set", () => {
    const data = signingInput();
    let foundHigh = false;

    // ECDSA is randomized; try a few signatures until one yields an integer
    // with the high bit set (DER pads it with a leading 0x00).
    for (let i = 0; i < 64 && !foundHigh; i++) {
      const der = signDer(data);
      const raw = derToRawSignature(der, 32);
      foundHigh = raw[0] >= 0x80;
      if (foundHigh) {
        expect(raw.length).toBe(64);
        expect(verifyRaw(data, raw)).toBe(true);
      }
    }
  });

  it("throws on malformed DER", () => {
    expect(() => derToRawSignature(Buffer.from("not-a-signature"), 32)).toThrow();
    expect(() => derToRawSignature(Buffer.from([0x30, 0x02]), 32)).toThrow();
  });
});
