import crypto from "crypto";
import type { Session, SessionData } from "express-session";

declare module "express-session" {
  interface SessionData {
    oauthState?: { token: string; redirect: string | null } | null;
  }
}

type OAuthSession = Session & Partial<SessionData>;

// Exact approved mobile return destinations. The app registers `diasporansync://`
// and opens `<scheme>:///oauth`; base64-encoding a redirect in the OAuth `state`
// is NOT CSRF protection, so a redirect is only ever honored here and only when
// it exactly matches one of these destinations.
export const DEFAULT_APP_RETURN_DESTINATION = "diasporansync:///oauth";
export const ALLOWED_APP_RETURN_DESTINATIONS = [DEFAULT_APP_RETURN_DESTINATION] as const;

export type OAuthProvider = "google" | "facebook" | "apple";

export function isAllowedAppReturnDestination(uri: string): boolean {
  const configured = (process.env.APP_OAUTH_REDIRECTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...ALLOWED_APP_RETURN_DESTINATIONS, ...configured].includes(uri);
}

// Generate an unpredictable, single-use state token, bind it to the requested
// app return destination, and persist both in the session so the provider's
// round-trip can be verified on the callback. Non-allowlisted redirects are
// discarded so the session never carries an untrusted destination.
export function createOAuthState(
  session: OAuthSession,
  requestedRedirect: string | undefined,
): string {
  const token = crypto.randomBytes(32).toString("base64url");
  const redirect =
    requestedRedirect && isAllowedAppReturnDestination(requestedRedirect)
      ? requestedRedirect
      : null;
  session.oauthState = { token, redirect };
  return token;
}

// Verify the caller-supplied state against the one issued at initiation. The
// entry is consumed on a match so replaying the same state cannot redirect
// again or mint another session.
export function verifyOAuthState(
  session: OAuthSession,
  providedToken: string | undefined,
): { valid: boolean; redirect: string | null } {
  const entry = session.oauthState;
  if (!entry || !providedToken || entry.token !== providedToken) {
    return { valid: false, redirect: null };
  }
  delete session.oauthState;
  return { valid: true, redirect: entry.redirect };
}

// Return (and consume) the stored app return destination without requiring a
// token match — used when the provider itself denies authorization and never
// echoes the state back.
export function takeOAuthRedirect(session: OAuthSession): string | null {
  const redirect = session.oauthState?.redirect ?? null;
  delete session.oauthState;
  return redirect;
}

// Build the deep link the browser is redirected to after a successful (or
// failed) exchange. The destination is always one of the allowlisted values
// from the session, never attacker-controlled query input.
export function buildAppCallbackUrl(
  destination: string,
  params: Record<string, string | null | undefined>,
): string {
  const url = new URL(destination);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  return url.toString();
}

export function buildAppCallbackUrlWithFragment(
  destination: string,
  params: Record<string, string | null | undefined>,
): string {
  const url = new URL(destination);
  const fragment = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) fragment.set(key, value);
  }
  url.hash = fragment.toString();
  return url.toString();
}
