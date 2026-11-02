// ─────────────────────────────────────────
// Apple refresh-token retention & revocation
// ─────────────────────────────────────────
// Apple returns a refresh token on the authorization-code exchange. We keep it
// encrypted so self-service account deletion can revoke the Apple grant, as
// App Store Guideline 5.1.1(v) expects. Revocation is best-effort: an Apple
// outage must never block a user from deleting their account.

import { readFileSync } from "node:fs";
import axios from "axios";
import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma.js";
import { getAppleSignInConfig } from "../config/apple.js";
import { encryptSecret, decryptSecret } from "../helpers/encryption.js";

const TOKEN_CONTEXT = "apple:refreshToken";
const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";

let warnedMissingKey = false;

/** Persists the Apple refresh token (encrypted) for later revocation. */
export async function storeAppleRefreshToken(userId: string, refreshToken: string): Promise<void> {
  if (!process.env.PAYMENT_GATEWAY_ENCRYPTION_KEY) {
    if (!warnedMissingKey) {
      console.warn(
        "[apple] PAYMENT_GATEWAY_ENCRYPTION_KEY is not set; Apple refresh tokens will not be stored for revocation.",
      );
      warnedMissingKey = true;
    }
    return;
  }

  const encrypted = encryptSecret(refreshToken, TOKEN_CONTEXT);
  await prisma.user.update({
    where: { id: userId },
    data: { appleRefreshToken: encrypted },
  });
}

function appleClientSecret(): { clientSecret: string; clientID: string } | null {
  const config = getAppleSignInConfig();
  if (!config) return null;

  const privateKey = config.privateKeyString ?? readFileSync(config.privateKeyLocation!, "utf8");
  const now = Math.floor(Date.now() / 1000);

  const clientSecret = jwt.sign(
    {
      iss: config.teamID,
      iat: now,
      exp: now + 300,
      aud: "https://appleid.apple.com",
      sub: config.clientID,
    },
    privateKey,
    { algorithm: "ES256", keyid: config.keyID },
  );

  return { clientSecret, clientID: config.clientID };
}

/**
 * Revokes a stored Apple refresh token. Never throws: deletion must proceed
 * even when Apple or the encryption key is unavailable.
 */
export async function revokeAppleRefreshToken(user: {
  id: string;
  appleRefreshToken: string | null;
}): Promise<void> {
  if (!user.appleRefreshToken) return;

  let refreshToken: string;
  try {
    refreshToken = decryptSecret(user.appleRefreshToken, TOKEN_CONTEXT);
  } catch (error) {
    console.error(
      `[apple] could not decrypt refresh token for user ${user.id}; skipping revocation:`,
      error instanceof Error ? error.message : error,
    );
    return;
  }

  let credentials: { clientSecret: string; clientID: string } | null;
  try {
    credentials = appleClientSecret();
  } catch (error) {
    console.error(
      `[apple] could not build the revocation client secret for user ${user.id}; skipping revocation:`,
      error instanceof Error ? error.message : error,
    );
    return;
  }

  if (!credentials) {
    console.warn("[apple] Apple Sign In is not configured; skipping token revocation.");
    return;
  }

  try {
    await axios.post(
      APPLE_REVOKE_URL,
      new URLSearchParams({
        client_id: credentials.clientID,
        client_secret: credentials.clientSecret,
        token: refreshToken,
        token_type_hint: "refresh_token",
      }).toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 10_000,
      },
    );
  } catch (error) {
    console.error(
      `[apple] token revocation failed for user ${user.id}; account deletion will continue:`,
      error instanceof Error ? error.message : error,
    );
  }
}
