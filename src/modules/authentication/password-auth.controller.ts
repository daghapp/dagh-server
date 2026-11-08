import { Response, Request } from "express";
import {
  RegistrationSchema,
  LoginSchema,
  VerifyOtpSchema,
  ResendOtpSchema,
  RefreshTokenSchema,
  ResetPasswordSchema,
} from "../../validator/index.js";
import { prisma } from "../../config/index.js";
import * as bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import {
  sendOtp,
  verifyOtp,
  generateAccessToken,
  generateRefreshToken,
} from "../../helpers/index.js";
import { ok, created, fail } from "../../helpers/response.js";
import { toAuthUser } from "../../helpers/auth-user.js";
import { getAllPermissionsForRole } from "../../middleware/permissions.js";
import { generateMfaToken } from "../../helpers/jwt.js";
import { getSecuritySettings, isPasswordExpired } from "../../helpers/settings.js";
import { notifyAdmins } from "../../helpers/notify-admins.js";
import { disableAllUserDevices } from "../devices/devices.controller.js";
import {
  resolveChannelAccessForLogin,
  resolveChannelAccessForRead,
} from "../../services/community.service.js";
import { isAllowedAppReturnDestination } from "./oauth-state.js";

export class PasswordAuthController {
  async register(req: Request, res: Response) {
    try {
      const userData = req.body as RegistrationSchema;

      const userExists = await prisma.user.findUnique({
        where: { email: userData.email },
      });

      if (userExists) {
        return fail(res, 400, "User already exists");
      }

      // phoneNumber is unique too
      if (userData.phoneNumber) {
        const phoneExists = await prisma.user.findUnique({
          where: { phoneNumber: userData.phoneNumber },
        });
        if (phoneExists) {
          return fail(res, 400, "Phone number already in use");
        }
      }

      const hashedPassword = await bcrypt.hash(userData.password, 10);
      const newUser = await prisma.user.create({
        data: {
          authProvider: "PASSWORD",
          fullName: userData.fullName,
          email: userData.email,
          phoneNumber: userData.phoneNumber,
          dateOfBirth: userData.dateOfBirth ? new Date(userData.dateOfBirth) : undefined,
          gender: userData.gender,
          ethnicity: (userData.ethnicity ?? undefined) as
            | "African"
            | "Asian"
            | "Black_African_American"
            | "Caribbean"
            | "Caucassian_White"
            | "Hispanic_Latino"
            | "Middle_Eastern"
            | "Mixed"
            | "Native_American_Indigenous"
            | "Pacific_Islander"
            | "Other"
            | undefined,

          passwordHash: hashedPassword,
          passwordLastChanged: new Date(),
        },
      });

      // Phase 1.1 — Strip passwordHash from response before sending to client
      const { passwordHash: _removed, ...safeUser } = newUser;

      // Send OTP email — non-fatal if it fails (user can retry via resend-otp)
      try {
        await sendOtp({
          email: newUser.email,
          subject: "Verify Your Email",
          purpose: "EMAIL_VERIFICATION",
        });
      } catch (otpError) {
        console.error("Failed to send verification email:", otpError);
      }

      await notifyAdmins({ category: "users", message: `New user registration: ${newUser.email}` });

      return created(res, safeUser);
    } catch (error) {
      console.error("Registration error:", error);
      return fail(res, 500, "Registration failed");
    }
  }

  //log in new user
  async login(req: Request, res: Response) {
    try {
      const loginData = req.body as LoginSchema;

      const user = await prisma.user.findUnique({
        where: {
          email: loginData.email,
        },
      });

      if (!user || !user.passwordHash) {
        return fail(res, 400, "Invalid email or password");
      }

      if (user.isDeleted) {
        return fail(res, 403, "Account is not active");
      }

      // Active lockout blocks the attempt before any credential check.
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        return fail(res, 423, {
          code: "ACCOUNT_LOCKED",
          message: "Account is temporarily locked. Please try again later",
        });
      }

      // An expired lockout is cleared so a past incident stops punishing logins.
      if (user.lockedUntil && user.lockedUntil <= new Date()) {
        await prisma.user.update({
          where: { id: user.id },
          data: { failedLoginAttempts: 0, lockedUntil: null },
        });
        user.failedLoginAttempts = 0;
        user.lockedUntil = null;
      }

      if (user.accountStatus !== "ACTIVE") {
        return fail(res, 403, "Please verify your email before logging in");
      }

      const security = await getSecuritySettings();

      const passwordMatch = await bcrypt.compare(loginData.password, user.passwordHash);
      if (!passwordMatch) {
        const attempts = (user.failedLoginAttempts ?? 0) + 1;
        const maxAttempts = security.maxLoginAttempts || 5;
        if (attempts >= maxAttempts) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts: attempts,
              lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
            },
          });
          await notifyAdmins({
            category: "security",
            message: `Admin/customer account locked: ${user.email}`,
            actionUrl: "/admin/users",
          });
          return fail(res, 423, {
            code: "ACCOUNT_LOCKED",
            message: "Too many failed login attempts. Account is temporarily locked",
          });
        }
        await prisma.user.update({
          where: { id: user.id },
          data: { failedLoginAttempts: attempts },
        });
        return fail(res, 400, "Invalid email or password");
      }

      // Password expiry is checked AFTER the credential check so a wrong
      // password never reveals whether the account's password is stale.
      if (isPasswordExpired(user.passwordLastChanged, security.passwordExpiryDays)) {
        return fail(res, 403, {
          code: "PASSWORD_EXPIRED",
          message: "Password expired, please reset it",
        });
      }

      // Success clears any prior failed-attempt history.
      if ((user.failedLoginAttempts ?? 0) > 0 || user.lockedUntil) {
        await prisma.user.update({
          where: { id: user.id },
          data: { failedLoginAttempts: 0, lockedUntil: null },
        });
      }

      const rememberMe = loginData.rememberMe === true;

      const accessToken =
        user.accountType === "ADMIN"
          ? generateAccessToken(
              {
                id: user.id,
                email: user.email,
                accountType: user.accountType,
              },
              { expiresIn: `${security.sessionTimeoutMinutes}m` as jwt.SignOptions["expiresIn"] },
            )
          : generateAccessToken({
              id: user.id,
              email: user.email,
              accountType: user.accountType,
            });
      const refreshToken = await generateRefreshToken(
        {
          id: user.id,
          email: user.email,
          accountType: user.accountType,
        },
        { days: rememberMe ? 30 : 7 },
      );

      // Signing in forces a check rather than trusting a live lease. This is the
      // moment yesterday's evidence stops being evidence about today: someone who
      // unsubscribed last night must see a locked feed now, not in an hour.
      // Best effort by design — a Google outage locks the feed for this response
      // rather than failing the sign-in, and it never opens anything.
      const communityAccess = await resolveChannelAccessForLogin(user.id);

       const response: any = {
         ...toAuthUser(user, communityAccess),
         accessToken,
         refreshToken,
       };

       // Echo a validated app return destination so password login can mirror
       // the OAuth deep-link redirect flow. Only allowlisted destinations pass.
       if (loginData.redirect && isAllowedAppReturnDestination(loginData.redirect)) {
         response.redirectUrl = loginData.redirect;
       }

      if (user.accountType === "ADMIN") {
        const adminProfile = await prisma.adminProfile.findUnique({
          where: { userId: user.id },
          select: { role: true, department: true, mfaEnabled: true, mfaMethod: true },
        });
        response.adminRole = adminProfile?.role ?? null;
        response.department = adminProfile?.department ?? null;
        response.permissions = adminProfile?.role
          ? getAllPermissionsForRole(adminProfile.role)
          : [];
        response.mfaRequired = adminProfile?.mfaEnabled ?? false;
        response.mfaMethod = adminProfile?.mfaMethod ?? null;
        if (adminProfile?.mfaEnabled) {
          response.mfaToken = generateMfaToken({
            id: user.id,
            email: user.email,
            accountType: user.accountType,
          });
          delete response.accessToken;
          delete response.refreshToken;
        } else if (security.require2FAForAdmins) {
          // Global 2FA mandate: this admin never enrolled, so hand back a
          // session-less mfaToken for the TOTP setup flow instead of a session.
          response.mfaToken = generateMfaToken({
            id: user.id,
            email: user.email,
            accountType: user.accountType,
          });
          delete response.accessToken;
          delete response.refreshToken;
          response.mfaRequired = true;
          response.mfaSetupRequired = true;
        }
      }

      return ok(res, response);
    } catch (error) {
      console.error("Login error:", error);
      return fail(res, 500, "Login failed");
    }
  }

  //log out user
  async logout(req: Request, res: Response) {
    try {
      const user = req.user as { id: string; email: string; accountType: string } | undefined;
      const userId = user?.id;

      if (!userId) {
        return fail(res, 401, "Not authenticated");
      }

      // Delete all refresh tokens for this user (logout from all devices)
      await prisma.deviceToken.deleteMany({
        where: { userId },
      });

      // Disable push-enabled devices so no incoming-call pushes target them
      await disableAllUserDevices(userId);

      return ok(res, null as never, "Logged out successfully");
    } catch (error) {
      console.error("Logout error:", error);
      return fail(res, 500, "Logout failed");
    }
  }

  //access token
  async newAccessToken(req: Request, res: Response) {
    try {
      const { refreshToken } = req.body as RefreshTokenSchema;

      if (!refreshToken) {
        return fail(res, 400, "Refresh token is required");
      }

      // Verify refresh token signature
      let decoded;
      try {
        decoded = jwt.verify(
          refreshToken,
          process.env.JWT_REFRESH_SECRET as string,
        ) as jwt.JwtPayload & { id: string; email: string; accountType: string };
      } catch {
        return fail(res, 401, "Invalid or expired refresh token");
      }

      // Check if refresh token exists in database
      const tokenRecord = await prisma.deviceToken.findFirst({
        where: {
          userId: decoded.id,
          token: refreshToken,
        },
      });

      if (!tokenRecord) {
        return fail(res, 401, "Refresh token not found");
      }

      // Check if token is expired
      if (tokenRecord.expiredAt && new Date() > tokenRecord.expiredAt) {
        // Delete expired token
        await prisma.deviceToken.delete({
          where: { id: tokenRecord.id },
        });
        return fail(res, 401, "Refresh token has expired");
      }

      // Verify user still exists and is active
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
      });

      if (!user) {
        return fail(res, 404, "User not found");
      }

      if (user.isDeleted) {
        return fail(res, 403, "Account is not active");
      }

      if (user.lockedUntil && user.lockedUntil > new Date()) {
        return fail(res, 423, {
          code: "ACCOUNT_LOCKED",
          message: "Account is temporarily locked. Please try again later",
        });
      }

      if (user.accountStatus !== "ACTIVE") {
        return fail(res, 403, "Account is not active");
      }

      // Generate new access token
      const newAccessToken = generateAccessToken({
        id: user.id,
        email: user.email,
        accountType: user.accountType,
      });

      // The user row is already loaded (it was needed for the accountStatus
      // check above), so returning it costs no extra query. It is not optional
      // decoration: this endpoint is what a client calls when its access token
      // expires mid-session, and it used to answer with the token alone. A
      // client rehydrating its cached session from this response therefore lost
      // every profile field the login response had given it — most visibly
      // ethnicity, which then looked unset and re-prompted the user on every
      // resume. Same flat shape as `login`, so one client-side session handler
      // covers both.
      // A read, not a forced check. Refresh runs every few minutes on an active
      // session, so forcing Google on each one would burn quota to answer a
      // question the lease already answers; a lapsed lease is still re-checked
      // here. The client rebuilds its session from this response, which is
      // exactly why it needs the current access rather than a token alone.
      const { access: communityAccess } = await resolveChannelAccessForRead(user.id);

      const refreshed: Record<string, unknown> = {
        ...toAuthUser(user, communityAccess),
        accessToken: newAccessToken,
      };

      // Same admin fields as login so a client rehydrating its session from a
      // refresh keeps role, department, and permissions without a second call.
      if (user.accountType === "ADMIN") {
        const adminProfile = await prisma.adminProfile.findUnique({
          where: { userId: user.id },
          select: { role: true, department: true },
        });
        refreshed.adminRole = adminProfile?.role ?? null;
        refreshed.department = adminProfile?.department ?? null;
        refreshed.permissions = adminProfile?.role
          ? getAllPermissionsForRole(adminProfile.role)
          : [];
      }

      return ok(res, refreshed);
    } catch (error) {
      console.error("Token refresh error:", error);
      return fail(res, 500, "Failed to refresh token");
    }
  }

  //verify otp
  async verifyOtp(req: Request, res: Response) {
    try {
      const otpData = req.body as VerifyOtpSchema;

      const user = await prisma.user.findUnique({
        where: { email: otpData.email },
      });

      if (!user) {
        return fail(res, 404, "User not found");
      }

      // Only block re-verification for EMAIL_VERIFICATION — a PASSWORD_RESET
      // OTP must be allowed for already-active users.
      if (otpData.purpose === "EMAIL_VERIFICATION" && user.accountStatus === "ACTIVE") {
        return fail(res, 400, "Email already verified");
      }

      const otpRecord = await prisma.otp.findFirst({
        where: {
          email: otpData.email,
          purpose: otpData.purpose,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      if (!otpRecord) {
        return fail(res, 400, "Invalid OTP code");
      }

      if (new Date() > otpRecord.expiresAt) {
        return fail(res, 400, "OTP has expired");
      }

      const isOtpValid = await verifyOtp(otpRecord.code, otpData.code);
      if (!isOtpValid) {
        return fail(res, 400, "Invalid OTP code");
      }

      // Update user status to ACTIVE only for email verification
      if (otpData.purpose === "EMAIL_VERIFICATION") {
        await prisma.user.update({
          where: { email: otpData.email },
          data: { accountStatus: "ACTIVE" },
        });
      }

      // Only consume the OTP here for EMAIL_VERIFICATION. A PASSWORD_RESET OTP
      // must remain valid so the follow-up /auth/reset-password call (which
      // re-validates the same code) can still find and consume it.
      if (otpData.purpose === "EMAIL_VERIFICATION") {
        // deleteMany avoids P2025 race on concurrent submissions
        await prisma.otp.deleteMany({
          where: { id: otpRecord.id },
        });
      }

      const message =
        otpData.purpose === "EMAIL_VERIFICATION"
          ? "Email verified successfully"
          : "OTP verified successfully";
      return ok(res, null as never, message);
    } catch (error) {
      console.error("OTP verification error:", error);
      return fail(res, 500, "OTP verification failed");
    }
  }

  //resend otp
  async resendOtp(req: Request, res: Response) {
    try {
      const { email } = req.body as ResendOtpSchema;

      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        return fail(res, 404, "User not found");
      }

      if (user.accountStatus === "ACTIVE") {
        return fail(res, 400, "Email already verified");
      }

      // Check for recent OTP (rate limiting)
      const recentOtp = await prisma.otp.findFirst({
        where: {
          email,
          purpose: "EMAIL_VERIFICATION",
          createdAt: {
            gte: new Date(Date.now() - 60 * 1000), // 1 minute ago
          },
        },
      });

      if (recentOtp) {
        return fail(res, 429, "Please wait 1 minute before requesting a new OTP");
      }

      // Delete old OTPs for this email
      await prisma.otp.deleteMany({
        where: {
          email,
          purpose: "EMAIL_VERIFICATION",
        },
      });

      // Generate new OTP — non-fatal if email fails (record is still created)
      try {
        await sendOtp({ email, subject: "Verify Your Email", purpose: "EMAIL_VERIFICATION" });
      } catch (otpError) {
        console.error("Failed to resend verification email:", otpError);
      }

      return ok(res, null as never, "OTP sent successfully");
    } catch (error) {
      console.error("Resend OTP error:", error);
      return fail(res, 500, "Failed to resend OTP");
    }
  }

  //password request reset
  async requestResetPassword(req: Request, res: Response) {
    const { email } = req.body as { email: string };

    try {
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (!existingUser) {
        // Deliberately identical to the success response: account enumeration
        // via this endpoint must not reveal whether an email is registered.
        // No OTP is sent when there is no user.
        return ok(res, null as never, "Password reset OTP sent successfully");
      }

      // Generate OTP — non-fatal if email fails (record is still created)
      try {
        await sendOtp({
          email: existingUser.email,
          subject: "Password Reset OTP",
          purpose: "PASSWORD_RESET",
        });
      } catch (otpError) {
        console.error("Failed to send password reset email:", otpError);
      }
      return ok(res, null as never, "Password reset OTP sent successfully");
    } catch (error) {
      console.error("Request reset password error:", error);
      return fail(res, 500, "Failed to send password reset OTP");
    }
  }

  //reset password
  async resetPassword(req: Request, res: Response) {
    try {
      const resetData = req.body as ResetPasswordSchema;

      const user = await prisma.user.findUnique({
        where: { email: resetData.email },
      });

      if (!user || !user.passwordHash) {
        return fail(res, 404, "User not found");
      }

      const otpRecord = await prisma.otp.findFirst({
        where: {
          email: resetData.email,
          purpose: "PASSWORD_RESET",
        },
        orderBy: { createdAt: "desc" },
      });

      if (!otpRecord) {
        return fail(res, 400, "Invalid OTP code");
      }

      if (new Date() > otpRecord.expiresAt) {
        return fail(res, 400, "OTP has expired");
      }

      const code = resetData.otp ?? resetData.token;
      if (!code) {
        return fail(res, 400, "Invalid OTP code");
      }

      const isOtpValid = await verifyOtp(otpRecord.code, code);
      if (!isOtpValid) {
        return fail(res, 400, "Invalid OTP code");
      }

      const hashedNewPassword = await bcrypt.hash(resetData.newPassword, 10);
      await prisma.user.update({
        where: { email: resetData.email },
        data: { passwordHash: hashedNewPassword, passwordLastChanged: new Date() },
      });

      // A reset proves email ownership, so every existing session ends here.
      await prisma.deviceToken.deleteMany({ where: { userId: user.id } });

      await prisma.otp.deleteMany({ where: { id: otpRecord.id } });

      return ok(res, null as never, "Password reset successfully");
    } catch (error) {
      console.error("Reset password error:", error);
      return fail(res, 500, "Failed to reset password");
    }
  }
}
