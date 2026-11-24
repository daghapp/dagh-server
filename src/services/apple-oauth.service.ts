import axios from "axios";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { getAppleSignInConfig } from "../config/apple.js";
import { isAppleIdTokenPayloadValid } from "../modules/authentication/apple-identity.js";
import { createAppleClientSecret } from "./apple-token.service.js";

const APPLE_AUTHORIZE_URL = "https://appleid.apple.com/auth/authorize";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const JWKS_TTL_MS = 60 * 60 * 1000;

type AppleJwk = crypto.webcrypto.JsonWebKey & { kid?: string };

let cachedKeys: AppleJwk[] = [];
let cachedAt = 0;

export interface AppleExchangeResult {
  appleId: string;
  email?: string;
  refreshToken?: string;
  idTokenClaims: Record<string, unknown>;
}

export function buildAppleAuthorizeUrl(state: string, nonceHash: string): string {
  const config = getAppleSignInConfig();
  if (!config) throw new Error("APPLE_NOT_CONFIGURED");

  const params = new URLSearchParams({
    client_id: config.clientID,
    redirect_uri: config.callbackURL,
    response_type: "code",
    response_mode: "form_post",
    scope: "name email",
    state,
    nonce: nonceHash,
  });
  return `${APPLE_AUTHORIZE_URL}?${params.toString()}`;
}

async function appleJwks(force = false): Promise<AppleJwk[]> {
  if (!force && cachedKeys.length > 0 && Date.now() - cachedAt < JWKS_TTL_MS) return cachedKeys;

  const response = await axios.get<{ keys: AppleJwk[] }>(APPLE_JWKS_URL, { timeout: 10_000 });
  if (!Array.isArray(response.data?.keys)) throw new Error("Invalid Apple JWKS response");
  cachedKeys = response.data.keys;
  cachedAt = Date.now();
  return cachedKeys;
}

function verifyWithAppleKey(
  idToken: string,
  key: crypto.KeyObject,
  clientID: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      idToken,
      key,
      { algorithms: ["RS256"], audience: clientID, issuer: "https://appleid.apple.com" },
      (error, decoded) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(decoded as Record<string, unknown>);
      },
    );
  });
}

async function verifyAppleIdToken(
  idToken: string,
  expectedNonce: string,
): Promise<Record<string, unknown>> {
  const config = getAppleSignInConfig();
  if (!config) throw new Error("APPLE_NOT_CONFIGURED");

  const kid = jwt.decode(idToken, { complete: true })?.header?.kid;
  if (!kid) throw new Error("Apple id_token is missing kid");

  let keys = await appleJwks();
  let jwk = keys.find((key) => key.kid === kid);
  if (!jwk) {
    keys = await appleJwks(true);
    jwk = keys.find((key) => key.kid === kid);
  }
  if (!jwk) throw new Error("No matching Apple signing key");

  const payload = await verifyWithAppleKey(
    idToken,
    crypto.createPublicKey({ key: jwk, format: "jwk" }),
    config.clientID,
  );
  if (!isAppleIdTokenPayloadValid(payload, config.clientID)) {
    throw new Error("Invalid Apple id_token claims");
  }
  if (payload.nonce !== expectedNonce) throw new Error("Apple nonce mismatch");
  return payload;
}

export async function exchangeAppleAuthorizationCode(
  code: string,
  expectedNonce: string,
): Promise<AppleExchangeResult> {
  const config = getAppleSignInConfig();
  if (!config) throw new Error("APPLE_NOT_CONFIGURED");
  const credentials = createAppleClientSecret();
  if (!credentials) throw new Error("APPLE_NOT_CONFIGURED");

  const response = await axios.post(
    APPLE_TOKEN_URL,
    new URLSearchParams({
      client_id: credentials.clientID,
      client_secret: credentials.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.callbackURL,
    }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15_000,
    },
  );

  const idToken = response.data?.id_token;
  if (typeof idToken !== "string") throw new Error("Apple did not return an id_token");
  const idTokenClaims = await verifyAppleIdToken(idToken, expectedNonce);
  if (typeof idTokenClaims.sub !== "string") throw new Error("Apple id_token is missing sub");

  return {
    appleId: idTokenClaims.sub,
    email: typeof idTokenClaims.email === "string" ? idTokenClaims.email : undefined,
    refreshToken:
      typeof response.data?.refresh_token === "string" ? response.data.refresh_token : undefined,
    idTokenClaims,
  };
}
