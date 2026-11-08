import jwt from "jsonwebtoken";
import { prisma } from "../config/index.js";

// Boot-time validation is skipped in tests (NODE_ENV=test): CI has no .env,
// and the JWT helpers are never called there.
if (!process.env.JWT_ACCESS_SECRET && process.env.NODE_ENV !== "test") {
  throw new Error("Missing JWT_SECRET environment variable. Please set it in your environment.");
}

if (!process.env.JWT_REFRESH_SECRET && process.env.NODE_ENV !== "test") {
  throw new Error(
    "Missing JWT_REFRESH_SECRET environment variable. Please set it in your environment.",
  );
}
interface JwtPayload {
  id: string;
  email: string;
  accountType?: string;
}

const AccessTokenSecret = process.env.JWT_ACCESS_SECRET as string;
const RefreshTokenSecret = process.env.JWT_REFRESH_SECRET as string;

/**
 * Secret for the pre-2FA `mfaToken` an admin login hands back instead of a
 * session.
 *
 * It is deliberately NOT the access-token secret. `protectedRoute` accepts
 * anything signed with `JWT_ACCESS_SECRET`, so an mfaToken signed with that key
 * would be a working session token that had skipped the second factor — the
 * exact thing two-factor auth exists to prevent.
 */
if (!process.env.JWT_MFA_SECRET && process.env.NODE_ENV !== "test") {
  throw new Error("Missing JWT_MFA_SECRET environment variable. Please set it in your environment.");
}

const MfaTokenSecret = process.env.JWT_MFA_SECRET ?? `${AccessTokenSecret}:admin-mfa`;

/** Options for the non-session token types minted from this module. */
export interface ScopedTokenOptions {
  /** Extra claims. `kind` marks the token as something other than a session. */
  claims?: Record<string, unknown>;
  expiresIn?: jwt.SignOptions["expiresIn"];
}

/**
 * Generate Access Token (shorter life)
 *
 * `options.kind` stamps the token as a non-session credential. `protectedRoute`
 * rejects any token carrying that marker, so a token minted here for an
 * intermediate step (MFA challenge, password reset) can never be replayed as a
 * session even though it is signed by the same helper.
 */
export function generateAccessToken(user: JwtPayload, options: ScopedTokenOptions = {}) {
  const token = jwt.sign(
    { id: user.id, email: user.email, accountType: user.accountType, ...options.claims },
    AccessTokenSecret,
    { expiresIn: options.expiresIn ?? "1d" },
  );

  return token;
}

/** The short-lived, session-less token returned by an admin login with 2FA on. */
export function generateMfaToken(
  user: JwtPayload,
  options: Omit<ScopedTokenOptions, "claims"> = {},
): string {
  const token = jwt.sign(
    { id: user.id, email: user.email, accountType: user.accountType, kind: "admin_mfa" },
    MfaTokenSecret,
    { expiresIn: options.expiresIn ?? "5m" },
  );

  return token;
}

/** Verifies a token minted by {@link generateMfaToken}. */
export function verifyMfaToken(token: string): (JwtPayload & { kind: string }) | null {
  try {
    const decoded = jwt.verify(token, MfaTokenSecret) as JwtPayload & { kind: string };
    return decoded.kind === "admin_mfa" ? decoded : null;
  } catch {
    return null;
  }
}

// Generate Refresh Token (stored in DB)
export async function generateRefreshToken(user: JwtPayload, options: { days?: number } = {}) {
  const days = options.days ?? 7;
  //check if a refresh token already exists for the user
  const existingToken = await prisma.deviceToken.findFirst({
    where: { userId: user.id },
  });

  if (existingToken && existingToken.expiredAt! > new Date()) return existingToken.token;
  const refreshToken = jwt.sign(
    { id: user.id, email: user.email, accountType: user.accountType },
    RefreshTokenSecret,
    { expiresIn: days * 24 * 60 * 60 },
  );

  await prisma.deviceToken.create({
    data: {
      userId: user.id,
      token: refreshToken,
      platform: "WEB",
      expiredAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    },
  });

  return refreshToken;
}

/**
 * Helper for routes that must accept a pre-2FA `mfaToken` as an alternative
 * to a session (e.g. `totp/setup` + `totp/verify` for admins who have not
 * finished 2FA setup and therefore hold no session yet).
 *
 * The owner of `admin-mfa.controller.ts` can use this to resolve the admin
 * identity: pass `req.body.mfaToken` (or a `Bearer` header carrying one) and
 * get back the verified payload, or `null` when it is missing/invalid.
 * `verifyMfaToken` remains the primitive; this just standardises extraction.
 */
export function resolveMfaIdentity(mfaToken: unknown): (JwtPayload & { kind: string }) | null {
  if (typeof mfaToken !== "string" || mfaToken.length === 0) return null;
  return verifyMfaToken(mfaToken);
}
