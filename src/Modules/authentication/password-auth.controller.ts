import { Response, Request ,NextFunction} from "express";
import { RegistrationSchema, LoginSchema, VerifyOtpSchema, ResendOtpSchema, RefreshTokenSchema , RequestResetPasswordSchema,ResetPasswordSchema} from "../../validator/index.js";
import { prisma } from "../../config/index.js";
import * as bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { sendOtp , generateAccessToken, generateRefreshToken} from "../../helpers/index.js";





export class PasswordAuthController {
  async register(req: Request, res: Response) {
    try {
      const userData = req.body as RegistrationSchema;

      const userExists = await prisma.user.findUnique({
        where: { email: userData.email },
      });

      if (userExists) {
        return res
          .status(400)
          .json({ success: false, message: "User already exists" });
      }

      const hashedPassword = bcrypt.hashSync(userData.password, 10);
      const newUser = await prisma.user.create({
        data: {
          authProvider: "PASSWORD",
          fullName: userData.fullName,
          email: userData.email,
          phoneNumber: userData.phoneNumber,
          dateOfBirth: userData.dateOfBirth
            ? new Date(userData.dateOfBirth)
            : undefined,
          gender: userData.gender,
          passwordHash: hashedPassword,
        },
      });
      
      await  sendOtp({ email: newUser.email, subject: "Verify Your Email", purpose: "EMAIL_VERIFICATION" });
      return res.status(201).json({ success: true, data: newUser });
    } catch (error) {
      console.error("Registration error:", error);
      return res.status(500).json({
        success: false,
        message: "Registration failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
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
        return res
          .status(400)
          .json({ success: false, message: "Invalid email or password" });
      }

      if (user.accountStatus !== "ACTIVE") {
        return res
          .status(403)
          .json({ success: false, message: "Please verify your email before logging in" });
      }

      const passwordMatch = bcrypt.compareSync(
        loginData.password,
        user.passwordHash,
      );
      if (!passwordMatch) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid email or password" });
      }

      const accessToken = generateAccessToken({
        id: user.id,
        email: user.email,
        accountType: user.accountType,
    
      })
      const refreshToken = await generateRefreshToken({
        id: user.id,
        email: user.email,
        accountType: user.accountType,
      })
      console.log(req.headers.authorization);
      return res.status(200).json({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          accountType: user.accountType,
          accessToken,
          refreshToken,
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      return res.status(500).json({
        success: false,
        message: "Login failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  //log out user
  async logout(req: Request, res: Response) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res
          .status(401)
          .json({ success: false, message: "Not authenticated" });
      }

      // Delete all refresh tokens for this user (logout from all devices)
      await prisma.deviceToken.deleteMany({
        where: { userId },
      });

      return res.status(200).json({
        success: true,
        message: "Logged out successfully",
      });
    } catch (error) {
      console.error("Logout error:", error);
      return res.status(500).json({
        success: false,
        message: "Logout failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  //access token
  async newAccessToken(req: Request, res: Response) {
    try {
      const { refreshToken } = req.body as RefreshTokenSchema;

      if (!refreshToken) {
        return res
          .status(400)
          .json({ success: false, message: "Refresh token is required" });
      }

      // Verify refresh token signature
      let decoded;
      try {
        decoded = jwt.verify(
          refreshToken,
          process.env.JWT_REFRESH_SECRET as string,
        ) as jwt.JwtPayload & { id: string; email: string; accountType: string };
      } catch (error) {
        return res
          .status(401)
          .json({ success: false, message: "Invalid or expired refresh token" });
      }

      // Check if refresh token exists in database
      const tokenRecord = await prisma.deviceToken.findFirst({
        where: {
          userId: decoded.id,
          token: refreshToken,
        },
      });

      if (!tokenRecord) {
        return res
          .status(401)
          .json({ success: false, message: "Refresh token not found" });
      }

      // Check if token is expired
      if (tokenRecord.expiredAt && new Date() > tokenRecord.expiredAt) {
        // Delete expired token
        await prisma.deviceToken.delete({
          where: { id: tokenRecord.id },
        });
        return res
          .status(401)
          .json({ success: false, message: "Refresh token has expired" });
      }

      // Verify user still exists and is active
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
      });

      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      if (user.accountStatus !== "ACTIVE") {
        return res
          .status(403)
          .json({ success: false, message: "Account is not active" });
      }

      // Generate new access token
      const newAccessToken = generateAccessToken({
        id: user.id,
        email: user.email,
        accountType: user.accountType,
      });

      return res.status(200).json({
        success: true,
        data: {
          accessToken: newAccessToken,
        },
      });
    } catch (error) {
      console.error("Token refresh error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to refresh token",
        error: error instanceof Error ? error.message : "Unknown error",
      });
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
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      if (user.accountStatus === "ACTIVE") {
        return res
          .status(400)
          .json({ success: false, message: "Email already verified" });
      }

      const otpRecord = await prisma.otp.findFirst({
        where: {
          email: otpData.email,
          code: otpData.code,
          purpose:otpData.purpose,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      if (!otpRecord) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid OTP code" });
      }

      if (new Date() > otpRecord.expiresAt) {
        return res
          .status(400)
          .json({ success: false, message: "OTP has expired" });
      }

      // Update user status to ACTIVE only for email verification
      if (otpData.purpose === "EMAIL_VERIFICATION") {
        await prisma.user.update({
          where: { email: otpData.email },
          data: { accountStatus: "ACTIVE" },
        });
      }

      // Delete used OTP
      await prisma.otp.delete({
        where: { id: otpRecord.id },
      });

      return res.status(200).json({
        success: true,
        message: "Email verified successfully",
      });
    } catch (error) {
      console.error("OTP verification error:", error);
      return res.status(500).json({
        success: false,
        message: "OTP verification failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
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
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      if (user.accountStatus === "ACTIVE") {
        return res
          .status(400)
          .json({ success: false, message: "Email already verified" });
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
        return res.status(429).json({
          success: false,
          message: "Please wait 1 minute before requesting a new OTP",
        });
      }

      // Delete old OTPs for this email
      await prisma.otp.deleteMany({
        where: {
          email,
          purpose: "EMAIL_VERIFICATION",
        },
      });

      await sendOtp({ email, subject: "Verify Your Email" });

      return res.status(200).json({
        success: true,
        message: "OTP sent successfully",
      });
    } catch (error) {
      console.error("Resend OTP error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to resend OTP",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }


  //password request reset
  async requestResetPassword(req: Request, res: Response) {
    //Verify if user is logged in
    const user = req.user;
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Not authenticated" });
    }
    
    //send otp for password reset
    try{
      const existingUser = await prisma.user.findUnique({
        where: { id: user.id },
      });

      if (!existingUser) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      await sendOtp({ email: existingUser.email, subject: "Password Reset OTP", purpose: "PASSWORD_RESET" });
      return res.status(200).json({
        success: true,
        message: "Password reset OTP sent successfully",
      });
    } catch (error) {
      console.error("Request reset password error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to send password reset OTP",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  //reset password
  async resetPassword(req: Request, res: Response) {
    try{
      const resetData = req.body as ResetPasswordSchema;

      const user = await prisma.user.findUnique({
        where: { email: resetData.email },
      });

      if (!user || !user.passwordHash) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      const passwordMatch = bcrypt.compareSync(
        resetData.oldPassword,
        user.passwordHash,
      );
      if (!passwordMatch) {
        return res
          .status(400)
          .json({ success: false, message: "Old password is incorrect" });
      }

      const hashedNewPassword = bcrypt.hashSync(resetData.newPassword, 10);
      await prisma.user.update({
        where: { email: resetData.email },
        data: { passwordHash: hashedNewPassword },
      });

      return res.status(200).json({
        success: true,
        message: "Password reset successfully",
      });
    }
    catch (error) {
      console.error("Reset password error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to reset password",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
  
}
