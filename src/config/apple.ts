// ─────────────────────────────────────────
// Apple Sign In configuration
// ─────────────────────────────────────────
// `passport-apple` accepts either a path to the .p8 key or the key string
// itself. Render (and most container hosts) make it easier to paste the key as
// a secret env var than to mount a file, so support both. An inline
// APPLE_PRIVATE_KEY wins over APPLE_PRIVATE_KEY_PATH.

import { existsSync } from "node:fs";

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function inlinePrivateKey(): string | undefined {
  const raw = clean(process.env.APPLE_PRIVATE_KEY);
  return raw ? raw.replace(/\\n/g, "\n") : undefined;
}

function privateKeyPath(): string | undefined {
  const path = clean(process.env.APPLE_PRIVATE_KEY_PATH);
  // A path that does not exist would register a strategy that fails only at
  // callback time. Treat it as unconfigured so /auth/apple honestly returns 503.
  return path && existsSync(path) ? path : undefined;
}

export interface AppleSignInConfig {
  clientID: string;
  teamID: string;
  keyID: string;
  callbackURL: string;
  privateKeyString?: string;
  privateKeyLocation?: string;
}

export function getAppleSignInConfig(): AppleSignInConfig | null {
  const clientID = clean(process.env.APPLE_CLIENT_ID);
  const teamID = clean(process.env.APPLE_TEAM_ID);
  const keyID = clean(process.env.APPLE_KEY_ID);
  const callbackURL = clean(process.env.APPLE_CALLBACK_URL);

  if (!clientID || !teamID || !keyID || !callbackURL) return null;

  const privateKeyString = inlinePrivateKey();
  if (privateKeyString) {
    return { clientID, teamID, keyID, callbackURL, privateKeyString };
  }

  const privateKeyLocation = privateKeyPath();
  if (privateKeyLocation) {
    return { clientID, teamID, keyID, callbackURL, privateKeyLocation };
  }

  return null;
}

export function isAppleSignInConfigured(): boolean {
  return getAppleSignInConfig() !== null;
}
