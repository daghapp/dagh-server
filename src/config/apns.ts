import { connect, type ClientHttp2Session, type IncomingHttpHeaders } from "node:http2";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import type { VoipPushMessage } from "../helpers/pushPayload.js";

/**
 * Direct APNs (Apple Push Notification service) HTTP/2 client used to deliver
 * PushKit VoIP pushes to iOS devices. Triggered from the device's `voipPushToken`.
 *
 * VoIP pushes are the only way to reliably launch a terminated app so it can
 * present an incoming-call screen. They require a .p8 provider key, the .voip
 * topic (`<bundle-id>.voip`), and a signed JWT on every request.
 *
 * No third-party dependency: uses Node's built-in HTTP/2 + ES256 JWT signing.
 */

const PRODUCTION_HOST = "https://api.push.apple.com";
const SANDBOX_HOST = "https://api.sandbox.push.apple.com";
const TOKEN_TTL_MS = 50 * 60 * 1000; // provider tokens live 1h; refresh early
const MAX_SESSION_AGE_MS = 30 * 60 * 1000; // recycle HTTP/2 connections periodically
const REQUEST_TIMEOUT_MS = 10_000;

let session: ClientHttp2Session | null = null;
let sessionCreatedAt = 0;
let cachedJwt: string | null = null;
let cachedJwtAt = 0;

export function initApns(): void {
  if (isApnsConfigured()) {
    console.log("[push] APNs initialized (iOS VoIP calls)");
  } else {
    console.warn("[push] APNs not configured — iOS VoIP call pushes disabled");
  }
}

export function isApnsConfigured(): boolean {
  return Boolean(
    process.env.APPLE_APNS_KEY_ID &&
    process.env.APPLE_APNS_TEAM_ID &&
    process.env.APPLE_BUNDLE_ID &&
    (process.env.APPLE_APNS_P8_KEY || process.env.APPLE_APNS_KEY_PATH),
  );
}

/**
 * PushKit topics are always the app bundle ID suffixed with `.voip`.
 */
export function getApnTopic(): string {
  const bundleId = process.env.APPLE_BUNDLE_ID;
  return bundleId ? `${bundleId}.voip` : "voip";
}

function apnsHost(): string {
  return process.env.APPLE_APNS_PRODUCTION === "true" ? PRODUCTION_HOST : SANDBOX_HOST;
}

function apnsPrivateKey(): string {
  if (process.env.APPLE_APNS_P8_KEY) return process.env.APPLE_APNS_P8_KEY.replace(/\\n/g, "\n");
  if (!process.env.APPLE_APNS_KEY_PATH) throw new Error("APNs key path not configured");
  return readFileSync(process.env.APPLE_APNS_KEY_PATH, "utf8");
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlEncodeBuffer(input: Buffer): string {
  return input.toString("base64url");
}

/**
 * Convert a DER-encoded ECDSA signature into the raw (r || s) concatenation the
 * JWT spec requires for ES256. Each component is left-padded to 32 bytes.
 *
 * Exported for unit testing — not part of the public consumer API.
 */
export function derToRawSignature(der: Buffer, sizeInBytes: number): Buffer {
  let offset = 0;
  if (der[offset] !== 0x30) throw new Error("invalid DER signature");
  offset += 2;

  const integers: Buffer[] = [];
  while (offset < der.length && integers.length < 2) {
    if (der[offset] !== 0x02) throw new Error("invalid DER signature integer");
    const len = der[offset + 1];
    let int = der.subarray(offset + 2, offset + 2 + len);
    offset += 2 + len;

    if (int.length > sizeInBytes + 1) throw new Error("DER signature integer too large");
    if (int.length === sizeInBytes + 1) {
      if (int[0] !== 0) throw new Error("DER signature integer overflow");
      int = int.subarray(1);
    }
    integers.push(int);
  }

  if (integers.length !== 2) throw new Error("incomplete DER signature");

  return Buffer.concat(
    integers.map((int) => {
      const padded = Buffer.alloc(sizeInBytes);
      int.copy(padded, sizeInBytes - int.length);
      return padded;
    }),
  );
}

/**
 * Sign an ES256 JWT for APNs provider-token authentication. Cached for the
 * lifetime of the token (Apple allows up to 1 hour).
 */
function signProviderToken(): string {
  const header = {
    alg: "ES256",
    kid: process.env.APPLE_APNS_KEY_ID,
  };
  const claims = {
    iss: process.env.APPLE_APNS_TEAM_ID,
    iat: Math.floor(Date.now() / 1000),
  };

  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;

  const signer = createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  const derSignature = signer.sign(apnsPrivateKey());
  const rawSignature = derToRawSignature(derSignature, 32);

  return `${signingInput}.${base64UrlEncodeBuffer(rawSignature)}`;
}

/**
 * Cached ES256 provider-token JWT used in the `authorization: bearer <jwt>`
 * header of every APNs request.
 */
function getProviderToken(): string {
  if (cachedJwt && Date.now() - cachedJwtAt < TOKEN_TTL_MS) return cachedJwt;
  cachedJwt = signProviderToken();
  cachedJwtAt = Date.now();
  return cachedJwt;
}

function getSession(): ClientHttp2Session {
  const stale =
    session &&
    (session.closed || session.destroyed || Date.now() - sessionCreatedAt > MAX_SESSION_AGE_MS);
  if (!session || stale) {
    if (session && !session.destroyed) session.destroy();
    session = connect(apnsHost());
    sessionCreatedAt = Date.now();
  }
  return session;
}

export interface VoipSendResponse {
  statusCode: number | null;
  body: string;
  apnsId?: string;
}

function errorMessage(error: unknown): string {
  return (error as { message?: string })?.message ?? String(error);
}

/**
 * Deliver a VoIP push over the shared HTTP/2 session. APNs answers every
 * request with an HTTP status: 200 means delivered, a non-200 carries a JSON
 * `reason` in the body. A network failure surfaces as `statusCode: null`.
 */
export function sendVoip(message: VoipPushMessage): Promise<VoipSendResponse> {
  const body = JSON.stringify(message.body);
  const contentLength = Buffer.byteLength(body);

  return new Promise((resolve) => {
    let settled = false;
    const settle = (response: VoipSendResponse): void => {
      if (settled) return;
      settled = true;
      resolve(response);
    };

    let activeSession: ClientHttp2Session;
    try {
      activeSession = getSession();
    } catch (error) {
      settle({ statusCode: null, body: errorMessage(error) });
      return;
    }

    const req = activeSession.request({
      ":method": "POST",
      ":path": `/3/device/${message.to}`,
      authorization: `bearer ${getProviderToken()}`,
      "apns-topic": message.topic,
      "apns-push-type": "voip",
      "apns-priority": "10",
      "content-type": "application/json",
      "content-length": String(contentLength),
    });

    let statusCode: number | null = null;
    let apnsId: string | undefined;
    let data = "";

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("APNs request timeout"));
    });

    req.on("response", (headers: IncomingHttpHeaders) => {
      const status = headers[":status"];
      statusCode = status !== undefined ? Number(status) : null;
      const id = headers["apns-id"];
      if (typeof id === "string") apnsId = id;
    });

    req.on("data", (chunk) => {
      data += chunk;
    });

    req.on("end", () => settle({ statusCode, body: data, apnsId }));

    req.on("error", (error) => settle({ statusCode: null, body: errorMessage(error) }));

    req.end(body);
  });
}
