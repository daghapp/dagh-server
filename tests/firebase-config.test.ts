import { describe, it, expect } from "vitest";
import { normalizePrivateKey } from "../src/config/firebase.js";

const BEGIN = "-----BEGIN PRIVATE KEY-----";
const END = "-----END PRIVATE KEY-----";
const BODY_64 =
  "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDQrLOoQzGaLqxG\n" +
  "Y2vfmFCKm5LKA6x9YbLrRQMNGpkHkVAjrDBi9lKpR4tF9zH0BQuFG8hS7p8qL0iN";

describe("normalizePrivateKey", () => {
  it("passes through a well-formed multi-line PEM unchanged (modulo trim)", () => {
    const input = `${BEGIN}\n${BODY_64}\n${END}\n`;
    const out = normalizePrivateKey(input);
    expect(out).toBe(`${BEGIN}\n${BODY_64}\n${END}`);
  });

  it("converts JSON-escaped \\n newlines to real newlines", () => {
    const escaped = `${BEGIN}\\n${BODY_64.replace(/\n/g, "\\n")}\\n${END}\\n`;
    const out = normalizePrivateKey(escaped);
    expect(out).toBe(`${BEGIN}\n${BODY_64}\n${END}`);
  });

  it("strips surrounding JSON quotes (pasted value from service-account JSON)", () => {
    const input = `"${BEGIN}\n${BODY_64}\n${END}\n"`;
    const out = normalizePrivateKey(input);
    expect(out.startsWith('"')).toBe(false);
    expect(out.endsWith('"')).toBe(false);
    expect(out.startsWith(BEGIN)).toBe(true);
    expect(out.endsWith(END)).toBe(true);
  });

  it("re-wraps a single-line body to 64-char lines", () => {
    const singleLine = `${BEGIN}${BODY_64.replace(/\n/g, "")}${END}`;
    const out = normalizePrivateKey(singleLine);
    const lines = out.split("\n");
    expect(lines[0]).toBe(BEGIN);
    expect(lines[lines.length - 1]).toBe(END);
    expect(lines.slice(1, -1).every((l) => l.length <= 64)).toBe(true);
  });

  it("handles a quoted, escaped, single-line key (worst case)", () => {
    const singleLine = `${BEGIN}${BODY_64.replace(/\n/g, "")}${END}`;
    const escaped = singleLine.replace(/\n/g, "\\n");
    const input = `"${escaped}"`;
    const out = normalizePrivateKey(input);
    expect(out.startsWith(BEGIN)).toBe(true);
    expect(out.endsWith(END)).toBe(true);
    const lines = out.split("\n");
    expect(lines.slice(1, -1).every((l) => l.length <= 64)).toBe(true);
  });

  it("does not choke when the marker is an RSA private key", () => {
    const input = `-----BEGIN RSA PRIVATE KEY-----\n${BODY_64}\n-----END RSA PRIVATE KEY-----`;
    const out = normalizePrivateKey(input);
    expect(out.startsWith("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
    expect(out.endsWith("-----END RSA PRIVATE KEY-----")).toBe(true);
  });
});