import { Request, Response } from "express";
import * as bcrypt from "bcrypt";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";
import { revokeAppleRefreshToken } from "../../services/apple-token.service.js";
import { indexDatingProfile } from "../../services/dating-search.service.js";

const ACCOUNT_PROFILE_SELECT = {
  id: true,
  email: true,
  username: true,
  firstName: true,
  lastName: true,
  fullName: true,
  profileImageUrl: true,
  phoneNumber: true,
  gender: true,
  dateOfBirth: true,
  ethnicity: true,
  authProvider: true,
  accountStatus: true,
  createdAt: true,
} as const;

interface AccountProfileUpdate {
  username?: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string | null;
}

/**
 * GET /profile/account — the authenticated user's login profile
 * (username, first/last name, names, and profile image). This is the account
 * users see in the login/profile settings screen, distinct from the dating profile.
 */
export async function getAccountProfile(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;
    if (!userId) {
      return fail(res, 401, "Unauthorized");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: ACCOUNT_PROFILE_SELECT,
    });

    if (!user) {
      return fail(res, 404, "User not found");
    }

    return ok(res, user);
  } catch (error) {
    console.error("[getAccountProfile]", error);
    return fail(res, 500, "Failed to fetch profile.");
  }
}

/**
 * PATCH /profile/account — update the authenticated user's login profile:
 * username, firstName, lastName, profileImageUrl.
 *
 * Any provided name component(s) are also written to the existing required
 * `fullName` column so existing consumers (dating payloads, admin console,
 * push notifications) keep receiving a correct full name. `profileImageUrl`
 * can be sent as `null` to remove the current profile picture.
 */
export async function updateAccountProfile(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;
    if (!userId) {
      return fail(res, 401, "Unauthorized");
    }

    const { username, firstName, lastName, profileImageUrl } = req.body as AccountProfileUpdate;

    // Username is globally unique (backed by a unique index); check the
    // pre-existing users table first so we can return a clear 409.
    if (username !== undefined) {
      const existingUsername = await prisma.user.findUnique({
        where: { username },
        select: { id: true },
      });
      if (existingUsername && existingUsername.id !== userId) {
        return fail(res, 409, "Username is already taken");
      }
    }

    // If a name component is being changed, keep fullName in sync.
    let fullName: string | undefined;
    if (firstName !== undefined || lastName !== undefined) {
      const currentUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { fullName: true },
      });
      if (!currentUser) {
        return fail(res, 404, "User not found");
      }
      const nextFirst = firstName !== undefined ? firstName : currentUser.fullName.split(" ")[0];
      const nextLast =
        lastName !== undefined ? lastName : currentUser.fullName.split(" ").slice(1).join(" ");
      fullName = [nextFirst, nextLast].filter((part) => part?.trim()).join(" ");
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        username: username ?? undefined,
        firstName: firstName ?? undefined,
        lastName: lastName ?? undefined,
        ...(profileImageUrl !== undefined ? { profileImageUrl } : {}),
        ...(fullName !== undefined ? { fullName } : {}),
      },
      select: ACCOUNT_PROFILE_SELECT,
    });

    void indexDatingProfile(userId);

    return ok(res, updated, "Profile updated successfully.");
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code === "P2002") {
      return fail(res, 409, "Username is already taken");
    }
    console.error("[updateAccountProfile]", error);
    return fail(res, 500, "Failed to update profile.");
  }
}

/**
 * DELETE /profile/account — permanently deletes the authenticated user's
 * account and all owned data. The current password must be supplied when the
 * account was registered with email/password; OAuth-only accounts (no
 * passwordHash) are deleted on authentication alone.
 *
 * `AdminActivityLog.actor` has an `onDelete: Restrict` FK, so the user's audit
 * rows are purged before the user row itself (every other owned row cascades).
 * This is the only restrict left on users — `SubscriptionAccessGrant.grantedBy`
 * nulls out, so issuing a comp no longer blocks the issuer from deleting their
 * own account, and the comps they issued stay in force for their recipients.
 */
export async function deleteAccount(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;
    if (!userId) {
      return fail(res, 401, "Unauthorized");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true, authProvider: true, appleRefreshToken: true },
    });

    if (!user) {
      return fail(res, 404, "User not found");
    }

    if (user.passwordHash) {
      const { password } = req.body as { password?: string };
      if (!password) {
        return fail(res, 400, "Password is required to delete your account");
      }
      const passwordMatch = await bcrypt.compare(password, user.passwordHash);
      if (!passwordMatch) {
        return fail(res, 400, "Incorrect password");
      }
    }

    // Revoke the Sign in with Apple grant before the token row disappears.
    // Best-effort: an Apple outage must not block account deletion. Revocation
    // applies to any account that holds an Apple refresh token, including one
    // that was originally created through Google/Facebook and later linked to
    // Apple, not only native Apple (ICLOUD) accounts.
    if (user.appleRefreshToken) {
      await revokeAppleRefreshToken({ id: user.id, appleRefreshToken: user.appleRefreshToken });
    }

    await prisma.$transaction([
      prisma.adminActivityLog.deleteMany({ where: { actorId: userId } }),
      prisma.user.delete({ where: { id: userId } }),
    ]);

    return ok(res, null as never, "Account deleted successfully");
  } catch (error) {
    console.error("[deleteAccount]", error);
    return fail(res, 500, "Failed to delete account.");
  }
}
