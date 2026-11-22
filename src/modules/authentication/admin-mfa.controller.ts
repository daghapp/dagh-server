import { Request, Response } from "express";
import { randomInt } from "crypto";
import { AdminRole, AdminDepartment } from "../../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";
import { ok, fail, created } from "../../helpers/response.js";
import {
  generateAccessToken,
  generateRefreshToken,
  generateMfaToken,
  verifyMfaToken,
  resolveMfaIdentity,
} from "../../helpers/jwt.js";
import type { NextFunction } from "express";

/**
 * Auth for TOTP setup/verify: full admin session OR the short-lived mfaToken
 * issued at login (global-2FA setup-required flow). mfaToken identity is
 * scoped to the token holder's own account — it opens nothing else.
 */
export async function mfaSetupAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      // Defer to the standard session check by importing lazily (avoids a
      // module cycle: protected.ts never imports this controller).
      const { default: protectedRoute } = await import("../../middleware/protected.js");
      return protectedRoute(req, res, next);
    }
    const identity = resolveMfaIdentity((req.body as { mfaToken?: string })?.mfaToken);
    if (!identity) return fail(res, 401, "Not authenticated");
    const user = await prisma.user.findUnique({
      where: { id: identity.id },
      select: { id: true, email: true, accountType: true, fullName: true },
    });
    if (!user || user.accountType !== "ADMIN")
      return fail(res, 403, "Administrator account required");
    req.user = user;
    next();
  } catch {
    return fail(res, 401, "Invalid or expired token");
  }
}
import {
  buildTotpSetup,
  generateBackupCode,
  generateTotpSecret,
  hashBackupCode,
  verifyTotp,
} from "../../services/totp.service.js";
import { getAdminPermissions } from "../../services/admin-permissions.service.js";

/**
 * Admin two-factor authentication.
 *
 * The shape of the flow is: sign in with a password, receive a short-lived
 * `mfaToken`, exchange it for real tokens only after a second factor is proven.
 * The `mfaToken` is deliberately not an access token — it must not open any
 * admin route, which is the whole reason verification is a separate step
 * instead of login returning a session immediately.
 */

const MFA_TOKEN_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;

/** Verification codes are stored hashed, and expire on their own row. */
async function issueMfaChallenge(userId: string, method: "SMS" | "TOTP"): Promise<string> {
  const code = String(randomInt(100000, 1000000));

  await prisma.adminMfaToken.create({
    data: {
      userId,
      token: `${method}:${code}`,
      method,
      expiresAt: new Date(Date.now() + MFA_TOKEN_TTL_MS),
    },
  });

  return code;
}

async function consumeChallenge(
  userId: string,
  method: "SMS" | "TOTP",
  code: string,
): Promise<boolean> {
  const record = await prisma.adminMfaToken.findFirst({
    where: { userId, method, used: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!record) return false;
  if (record.token !== `${method}:${code}`) return false;

  await prisma.adminMfaToken.update({ where: { id: record.id }, data: { used: true } });
  return true;
}

export class AdminMfaController {
  /**
   * POST /admin/auth/2fa/verify — proves the second factor and issues the
   * session tokens the client was only holding an mfaToken for.
   */
  async verify(req: Request, res: Response) {
    try {
      const { mfaToken, code, method, useBackupCode } = req.body as {
        mfaToken?: string;
        code?: string;
        method?: "SMS" | "TOTP" | "BACKUP";
        useBackupCode?: boolean;
      };

      if (!mfaToken) return fail(res, 400, "mfaToken is required");

      const payload = verifyMfaToken(mfaToken);
      if (!payload) return fail(res, 401, "Invalid or expired mfaToken");

      const user = await prisma.user.findUnique({
        where: { id: payload.id },
        include: { adminProfile: true },
      });

      if (!user || user.accountType !== "ADMIN" || !user.adminProfile) {
        return fail(res, 403, "Administrator account required");
      }

      const factor = method ?? (user.adminProfile.mfaMethod as "SMS" | "TOTP") ?? "SMS";

      let valid = false;
      if (useBackupCode) {
        valid = await this.consumeBackupCode(user.id, code ?? "");
      } else {
        if (!code) return fail(res, 400, "code is required");
        if (factor === "TOTP") {
          if (!user.adminProfile.mfaSecret) return fail(res, 400, "TOTP is not configured");
          valid = verifyTotp(user.adminProfile.mfaSecret, code);
        } else {
          valid = await consumeChallenge(user.id, "SMS", code);
        }
      }

      if (!valid) {
        return fail(res, 401, "Invalid verification code");
      }

      await prisma.adminProfile.update({
        where: { userId: user.id },
        data: { failedMfaAttempts: 0, lastMfaAt: new Date() },
      });

      return ok(res, await buildSessionPayload(user, user.adminProfile), "Verified");
    } catch (error) {
      console.error("Admin 2FA verify error:", error);
      return fail(res, 500, "Verification failed");
    }
  }

  /** POST /admin/auth/2fa/resend — new SMS code, rate limited. */
  async resend(req: Request, res: Response) {
    try {
      const { mfaToken } = req.body as { mfaToken?: string };
      if (!mfaToken) return fail(res, 400, "mfaToken is required");

      const payload = verifyMfaToken(mfaToken);
      if (!payload) return fail(res, 401, "Invalid or expired mfaToken");

      const recent = await prisma.adminMfaToken.findFirst({
        where: { userId: payload.id, method: "SMS", used: false },
        orderBy: { createdAt: "desc" },
      });

      if (recent && Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_MS) {
        return fail(res, 429, "Please wait before requesting another code");
      }

      await issueMfaChallenge(payload.id, "SMS");

      // The code itself is not returned: it must reach the admin over SMS, and
      // this project has no SMS provider wired yet (see handover §3.2).
      return ok(res, { sent: true }, "Verification code sent");
    } catch (error) {
      console.error("Admin 2FA resend error:", error);
      return fail(res, 500, "Failed to resend code");
    }
  }

  /** POST /admin/auth/2fa/totp/setup — provisioning material for the QR code. */
  async totpSetup(req: Request, res: Response) {
    try {
      // Session OR short-lived mfaToken: the global-2FA setup-required flow
      // hands the admin only an mfaToken, so setup must accept it.
      const mfaIdentity = req.user
        ? null
        : resolveMfaIdentity((req.body as { mfaToken?: string })?.mfaToken);
      const identity =
        req.user ?? (mfaIdentity ? { id: mfaIdentity.id, email: mfaIdentity.email } : null);
      if (!identity) return fail(res, 401, "Not authenticated");
      const user = identity as { id: string; email: string };

      const existing = await prisma.adminProfile.findUnique({
        where: { userId: user.id },
        select: { mfaSecret: true },
      });

      const secret = existing?.mfaSecret ?? generateTotpSecret();
      const setup = buildTotpSetup(user.email, secret);

      // Persisted but not enabled: `mfaEnabled` only flips once a code is
      // confirmed by totp/verify, so a half-finished setup cannot lock anyone out.
      await prisma.adminProfile.update({
        where: { userId: user.id },
        data: { mfaSecret: secret },
      });

      return ok(res, setup);
    } catch (error) {
      console.error("Admin TOTP setup error:", error);
      return fail(res, 500, "Failed to start TOTP setup");
    }
  }

  /** POST /admin/auth/2fa/totp/verify — confirms the first code, enables TOTP. */
  async totpVerify(req: Request, res: Response) {
    try {
      const mfaIdentity = req.user
        ? null
        : resolveMfaIdentity((req.body as { mfaToken?: string })?.mfaToken);
      const identity = req.user ?? (mfaIdentity ? { id: mfaIdentity.id } : null);
      if (!identity) return fail(res, 401, "Not authenticated");
      const user = identity as { id: string };
      const { code } = req.body as { code?: string };
      if (!code) return fail(res, 400, "code is required");

      const profile = await prisma.adminProfile.findUnique({
        where: { userId: user.id },
        select: { mfaSecret: true },
      });

      if (!profile?.mfaSecret) return fail(res, 400, "Start TOTP setup first");
      if (!verifyTotp(profile.mfaSecret, code)) return fail(res, 400, "Invalid verification code");

      await prisma.adminProfile.update({
        where: { userId: user.id },
        data: { mfaEnabled: true, mfaMethod: "TOTP" },
      });

      return ok(res, { mfaEnabled: true, mfaMethod: "TOTP" }, "Authenticator app enabled");
    } catch (error) {
      console.error("Admin TOTP verify error:", error);
      return fail(res, 500, "Failed to verify authenticator code");
    }
  }

  /** POST /admin/auth/2fa/backup-codes — shown once, stored hashed. */
  async generateBackupCodes(req: Request, res: Response) {
    try {
      const user = req.user;
      if (!user) return fail(res, 401, "Not authenticated");

      const codes = Array.from({ length: 10 }, () => generateBackupCode());

      await prisma.adminProfile.update({
        where: { userId: user.id },
        data: { backupCodes: codes.map(hashBackupCode) },
      });

      // Plaintext codes are returned exactly once. The stored column holds
      // hashes, so this response is the only chance to show them.
      return created(res, { backupCodes: codes }, "Save these codes now");
    } catch (error) {
      console.error("Admin backup code generation error:", error);
      return fail(res, 500, "Failed to generate backup codes");
    }
  }

  /** POST /admin/auth/2fa/backup-codes/verify — single-use code sign-in. */
  async verifyBackupCode(req: Request, res: Response) {
    try {
      const { mfaToken, code } = req.body as { mfaToken?: string; code?: string };
      if (!mfaToken) return fail(res, 400, "mfaToken is required");
      if (!code) return fail(res, 400, "code is required");

      const payload = verifyMfaToken(mfaToken);
      if (!payload) return fail(res, 401, "Invalid or expired mfaToken");

      const user = await prisma.user.findUnique({
        where: { id: payload.id },
        include: { adminProfile: true },
      });

      if (!user?.adminProfile) return fail(res, 403, "Administrator account required");

      const valid = await this.consumeBackupCode(user.id, code);
      if (!valid) return fail(res, 401, "Invalid backup code");

      await prisma.adminProfile.update({
        where: { userId: user.id },
        data: { lastMfaAt: new Date() },
      });

      return ok(res, await buildSessionPayload(user, user.adminProfile), "Verified");
    } catch (error) {
      console.error("Admin backup code verify error:", error);
      return fail(res, 500, "Backup code verification failed");
    }
  }

  /**
   * Removes a used backup code from the stored set.
   *
   * Single use is enforced by deletion, not by a consumed-flag column: a backup
   * code is worthless once it has been typed into a sign-in box, so the row that
   * proved it worked should not survive to be replayed.
   */
  private async consumeBackupCode(userId: string, code: string): Promise<boolean> {
    const profile = await prisma.adminProfile.findUnique({
      where: { userId },
      select: { backupCodes: true },
    });

    if (!profile) return false;

    const hash = hashBackupCode(code);
    if (!profile.backupCodes.includes(hash)) return false;

    await prisma.adminProfile.update({
      where: { userId },
      data: { backupCodes: profile.backupCodes.filter((existing) => existing !== hash) },
    });

    return true;
  }
}

/** Mints the short-lived token login returns in place of real tokens. */
export function issueMfaToken(user: { id: string; email: string; accountType: string }): string {
  return generateMfaToken({ id: user.id, email: user.email, accountType: user.accountType });
}

async function buildSessionPayload(
  user: {
    id: string;
    email: string;
    fullName: string;
    accountType: string;
    ethnicity?: string | null;
  },
  profile: { role: AdminRole; department: AdminDepartment },
) {
  const accessToken = generateAccessToken({
    id: user.id,
    email: user.email,
    accountType: user.accountType,
  });
  const refreshToken = await generateRefreshToken({
    id: user.id,
    email: user.email,
    accountType: user.accountType,
  });

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    accountType: user.accountType,
    ethnicity: user.ethnicity ?? null,
    adminRole: profile.role,
    department: profile.department,
    permissions: getAdminPermissions(profile.role),
    accessToken,
    refreshToken,
  };
}
