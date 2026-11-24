// ─────────────────────────────────────────
// Apple Sign In configuration
// ─────────────────────────────────────────
// The manual Apple OAuth flow accepts either a path to the .p8 key or the key
// string itself. Render (and most container hosts) make it easier to paste the
// key as a secret env var than to mount a file, so support both. An inline
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
  // A path that does not exist would fail only when signing the client secret.
  // Treat it as unconfigured so /auth/apple honestly returns 503.
  return path && existsSync(path) ? path : undefined;
}

export const DEFAULT_APPLE_CALLBACK_URL =
  "https://dagh-server-fo64.onrender.com/auth/apple/callback";

let warnedInvalidCallback = false;

function callbackURL(): string {
  const raw = clean(process.env.APPLE_CALLBACK_URL);
  if (!raw || /^https:\/\//i.test(raw))
    return raw?.replace(/\/+$/, "") ?? DEFAULT_APPLE_CALLBACK_URL;

  if (!warnedInvalidCallback) {
    console.warn(
      "[apple] APPLE_CALLBACK_URL must be an https:// URL; using",
      DEFAULT_APPLE_CALLBACK_URL,
    );
    warnedInvalidCallback = true;
  }
  return DEFAULT_APPLE_CALLBACK_URL;
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
  const resolvedCallbackURL = callbackURL();

  if (!clientID || !teamID || !keyID) return null;

  const privateKeyString = inlinePrivateKey();
  if (privateKeyString) {
    return { clientID, teamID, keyID, callbackURL: resolvedCallbackURL, privateKeyString };
  }

  const privateKeyLocation = privateKeyPath();
  if (privateKeyLocation) {
    return { clientID, teamID, keyID, callbackURL: resolvedCallbackURL, privateKeyLocation };
  }

  return null;
}

export function isAppleSignInConfigured(): boolean {
  return getAppleSignInConfig() !== null;
}
