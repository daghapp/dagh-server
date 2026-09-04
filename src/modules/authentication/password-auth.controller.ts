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
import { disableAllUserDevices } from "../devices/devices.controller.js";

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

      if (user.accountStatus !== "ACTIVE") {
        return fail(res, 403, "Please verify your email before logging in");
      }

      const passwordMatch = await bcrypt.compare(loginData.password, user.passwordHash);
      if (!passwordMatch) {
        return fail(res, 400, "Invalid email or password");
      }

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
      return ok(res, {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        accountType: user.accountType,
        ethnicity: user.ethnicity ?? null,
        accessToken,
        refreshToken,
      });
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

      if (user.accountStatus !== "ACTIVE") {
        return fail(res, 403, "Account is not active");
      }

      // Generate new access token
      const newAccessToken = generateAccessToken({
        id: user.id,
        email: user.email,
        accountType: user.accountType,
      });

      return ok(res, { accessToken: newAccessToken });
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

      // Delete used OTP (deleteMany avoids P2025 race on concurrent submissions)
      await prisma.otp.deleteMany({
        where: { id: otpRecord.id },
      });

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
        return fail(res, 404, "User not found");
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
        return fail(res, 400, "Invalid or expired OTP");
      }

      if (new Date() > otpRecord.expiresAt) {
        return fail(res, 400, "OTP has expired");
      }

      const isOtpValid = await verifyOtp(otpRecord.code, resetData.otp);
      if (!isOtpValid) {
        return fail(res, 400, "Invalid OTP code");
      }

      const hashedNewPassword = await bcrypt.hash(resetData.newPassword, 10);
      await prisma.user.update({
        where: { email: resetData.email },
        data: { passwordHash: hashedNewPassword },
      });

      await prisma.otp.deleteMany({ where: { id: otpRecord.id } });

      return ok(res, null as never, "Password reset successfully");
    } catch (error) {
      console.error("Reset password error:", error);
      return fail(res, 500, "Failed to reset password");
    }
  }
}
