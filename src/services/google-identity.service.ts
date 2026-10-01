// ─────────────────────────────────────────
// Google identity claims
// ─────────────────────────────────────────
// The subscription check has to answer a question email cannot: "is the
// YouTube/Google identity that authorized us subscribed to this channel?"
// subscriptions.list has no email parameter — it answers for the bearer token's
// own account, and only that. So the identity has to be established first, and
// it has to be established for the *Google* account, not the app one.
//
// Two things make that safe to act on:
//
//   1. The id_token is verified against Google's published JWKS, not decoded.
//      A self-asserted `email` in a query parameter is not evidence of anything,
//      and an unverified token would let anyone claim any address.
//   2. The `sub` claim is what gets stored as the durable identity. An email is
//      not: a Google address can be renamed, and the app email is not
//      authoritative about which Google account a person subscribes with.
//
// The email claim is then compared to the app account's own verified email, and
// a mismatch is refused rather than normalised. Gmail dot-folding and plus-suffix
// stripping would both manufacture a match out of two different mailboxes
// (dots are ignored by Gmail, and a +suffix is a real alias) — so the comparison
// is exact, and a user who genuinely cannot use the same address with Google
// cannot complete the link. That is a product decision, not a bug to paper over.

import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { JwtPayload } from "jsonwebtoken";

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const JWKS_TTL_MS = 60 * 60 * 1000; // Google's signing keys rotate rarely
const REQUEST_TIMEOUT_MS = 10_000;

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"] as const;

/**
 * A JWK from Google's JWKS endpoint. The DOM `JsonWebKey` type has no `kid`,
 * which is the field the whole key-selection scheme depends on, so the shape is
 * spelled out here rather than reaching for a cast at each use.
 */
type GoogleJwk = {
  kid?: string;
  alg?: string;
  use?: string;
  kty?: string;
  n?: string;
  e?: string;
};

export class GoogleIdentityError extends Error {}

export interface GoogleIdentity {
  /** Stable per-Google-account identifier. The durable identity. */
  subject: string;
  email: string;
  /** Google's own assertion that the address was verified at Google's end. */
  emailVerified: boolean;
}

let cachedJwks: { keys: JsonWebKey[]; fetchedAt: number } | null = null;

async function getJwksKeys(): Promise<JsonWebKey[]> {
  if (cachedJwks && Date.now() - cachedJwks.fetchedAt < JWKS_TTL_MS) {
    return cachedJwks.keys;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(JWKS_URL, { signal: controller.signal });
    if (!res.ok) {
      throw new GoogleIdentityError(`Could not fetch Google signing keys (HTTP ${res.status})`);
    }
    const body = (await res.json()) as { keys?: GoogleJwk[] };
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      throw new GoogleIdentityError("Google returned no signing keys");
    }
    cachedJwks = { keys: body.keys, fetchedAt: Date.now() };
    return body.keys;
  } finally {
    clearTimeout(timer);
  }
}

function publicKeyFor(kid: string, keys: GoogleJwk[]): crypto.KeyObject {
  const jwk = keys.find((k) => k.kid === kid);
  if (!jwk) throw new GoogleIdentityError("Unknown Google signing key");
  try {
    return crypto.createPublicKey({
      key: jwk as Parameters<typeof crypto.createPublicKey>[0] extends { key: infer K } ? K : never,
      format: "jwk",
    });
  } catch {
    throw new GoogleIdentityError("Malformed Google signing key");
  }
}

/**
 * Verifies a Google id_token and returns the identity it asserts.
 *
 * Checks the signature against Google's JWKS, the audience against our own OAuth
 * client, the issuer against Google's two accepted spellings, and the nonce
 * against the value minted for this round-trip. Expiry is enforced by the
 * verifier.
 *
 * @throws {GoogleIdentityError} on any failure. The caller must treat that as
 *         "no identity was established" and grant nothing.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  options: { clientId: string; nonce: string },
): Promise<GoogleIdentity> {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded) throw new GoogleIdentityError("Malformed id_token");

  const keys = await getJwksKeys();
  const kid = decoded.header.kid;
  if (!kid) throw new GoogleIdentityError("id_token has no key id");

  let payload: string | JwtPayload;
  try {
    payload = jwt.verify(idToken, publicKeyFor(kid, keys), {
      audience: options.clientId,
      // Google has historically issued both spellings; a token from either is
      // legitimate, so the check accepts both rather than rejecting one.
      issuer: [...GOOGLE_ISSUERS],
    });
  } catch (error) {
    throw new GoogleIdentityError(
      `id_token verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof payload === "string") throw new GoogleIdentityError("Unexpected id_token payload");

  // The nonce is the binding between this token and the round-trip we started.
  // Without it a token obtained in some other flow — even one this user
  // legitimately completed — would satisfy the check at this callback.
  if (payload.nonce !== options.nonce) {
    throw new GoogleIdentityError("id_token nonce does not match this verification attempt");
  }

  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new GoogleIdentityError("id_token has no subject");
  }
  if (typeof payload.email !== "string" || !payload.email) {
    throw new GoogleIdentityError("id_token has no email claim");
  }

  return {
    subject: payload.sub,
    email: payload.email.toLowerCase(),
    // Google's `email_verified` is sometimes a boolean and sometimes the string
    // "true". Anything else — including absence — is treated as unverified,
    // because the same-email rule is only as strong as the claim behind it.
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
  };
}

/**
 * Exact-match comparison between the app account's email and the Google one.
 *
 * Deliberately not normalised. Gmail ignores dots in the local part and treats
 * `a+tag@` as an alias of `a@`; both are distinct mailboxes, and folding them
 * would link a subscription held by one to an app account owned by another. An
 * address that cannot be used with a Google account is a dead end this reports
 * as such rather than routing around.
 */
export function googleEmailMatchesAppEmail(googleEmail: string, appEmail: string): boolean {
  return googleEmail.trim().toLowerCase() === appEmail.trim().toLowerCase();
}

/** Test helper: drops the memoized JWKS so cases do not share cached keys. */
export function _resetJwksCache(): void {
  cachedJwks = null;
}
