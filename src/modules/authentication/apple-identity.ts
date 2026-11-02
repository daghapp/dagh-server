// ─────────────────────────────────────────
// Apple identity resolution
// ─────────────────────────────────────────
// Apple's `sub` claim is the only stable account identifier. Email is optional
// and may be a private-relay address, so it is used to link an existing account
// on first Apple login — never as a fallback that could resolve to "some Apple
// user" when the email is missing.

import { prisma } from "../../config/prisma.js";
import { AuthProvider, type User } from "../../../generated/prisma/client.js";

export interface AppleIdentity {
  appleId: string;
  email?: string;
  fullName?: string;
}

export class AppleIdentityConflictError extends Error {
  constructor(message = "This email is already linked to another Apple account") {
    super(message);
    this.name = "AppleIdentityConflictError";
  }
}

export class AppleEmailRequiredError extends Error {
  constructor(message = "Apple did not provide an email for this new account") {
    super(message);
    this.name = "AppleEmailRequiredError";
  }
}

/**
 * Validates the claim set of Apple's id_token. The token is fetched directly
 * from Apple's token endpoint over TLS, so this is defense-in-depth against a
 * malformed or unexpected response rather than an untrusted-token boundary.
 */
export function isAppleIdTokenPayloadValid(
  payload: Record<string, unknown>,
  expectedAudience: string,
): boolean {
  return (
    payload.iss === "https://appleid.apple.com" &&
    payload.aud === expectedAudience &&
    typeof payload.exp === "number" &&
    payload.exp * 1000 > Date.now()
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2002";
}

/**
 * Resolves the local user for an Apple identity:
 *  1. by `appleId` (normal case);
 *  2. by verified email, linking `appleId` to that account;
 *  3. create a new account — only when Apple supplied an email.
 *
 * A second Apple identity cannot claim an email already linked to another
 * `appleId`; that would let two Apple accounts share one local user.
 */
export async function resolveAppleUser(identity: AppleIdentity): Promise<User> {
  const byAppleId = await prisma.user.findUnique({ where: { appleId: identity.appleId } });
  if (byAppleId) return byAppleId;

  if (identity.email) {
    const byEmail = await prisma.user.findUnique({ where: { email: identity.email } });
    if (byEmail) {
      if (byEmail.appleId && byEmail.appleId !== identity.appleId) {
        throw new AppleIdentityConflictError();
      }
      return prisma.user.update({
        where: { id: byEmail.id },
        data: {
          appleId: identity.appleId,
          // Preserve the account; only relabel a password account. Google and
          // Facebook accounts keep their provider and gain the Apple link.
          ...(byEmail.authProvider === AuthProvider.PASSWORD
            ? { authProvider: AuthProvider.ICLOUD }
            : {}),
        },
      });
    }
  }

  if (!identity.email) {
    throw new AppleEmailRequiredError();
  }

  try {
    return await prisma.user.create({
      data: {
        fullName: identity.fullName || identity.email.split("@")[0],
        email: identity.email,
        authProvider: AuthProvider.ICLOUD,
        appleId: identity.appleId,
      },
    });
  } catch (error) {
    // Two first-time logins can race between the lookups above. The unique
    // index is the source of truth; return the winner instead of a 500.
    if (isUniqueViolation(error)) {
      const raced = await prisma.user.findUnique({ where: { appleId: identity.appleId } });
      if (raced) return raced;
    }
    throw error;
  }
}
