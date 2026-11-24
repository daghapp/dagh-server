import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { DEFAULT_APP_RETURN_DESTINATION, isAllowedAppReturnDestination } from "./oauth-state.js";

const ISSUER = "dagh-server-apple-oauth";
const AUDIENCE = "dagh-mobile-app";
const TTL_SECONDS = 10 * 60;

export interface AppleOAuthStatePayload {
  appRedirect: string;
  nonceHash: string;
  jti?: string;
  iat?: number;
  exp?: number;
}

function stateSecret(): string {
  const secret = process.env.APPLE_OAUTH_STATE_SECRET || process.env.JWT_ACCESS_SECRET;
  if (!secret && process.env.NODE_ENV !== "test") {
    throw new Error("Missing APPLE_OAUTH_STATE_SECRET environment variable");
  }
  return secret || "test-apple-oauth-state-secret";
}

export function createAppleOAuthState(requestedRedirect?: string): {
  state: string;
  nonceHash: string;
} {
  const appRedirect =
    requestedRedirect && isAllowedAppReturnDestination(requestedRedirect)
      ? requestedRedirect
      : DEFAULT_APP_RETURN_DESTINATION;
  const nonceHash = crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex");
  const state = jwt.sign({ appRedirect, nonceHash, jti: crypto.randomUUID() }, stateSecret(), {
    algorithm: "HS256",
    expiresIn: TTL_SECONDS,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  return { state, nonceHash };
}

export function verifyAppleOAuthState(state: string | undefined): AppleOAuthStatePayload {
  if (!state) throw new Error("INVALID_APPLE_OAUTH_STATE");
  try {
    const payload = jwt.verify(state, stateSecret(), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as AppleOAuthStatePayload;
    if (
      typeof payload.appRedirect !== "string" ||
      !isAllowedAppReturnDestination(payload.appRedirect) ||
      typeof payload.nonceHash !== "string"
    ) {
      throw new Error("invalid claims");
    }
    return payload;
  } catch {
    throw new Error("INVALID_APPLE_OAUTH_STATE");
  }
}
