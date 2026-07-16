import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import type {
  SendPhoneOtpSchema,
  VerifyPhoneOtpSchema,
} from "../../validator/profile-phone-verification-validator.js";
import { sendOtp, verifyOtp } from "../../helpers/otp.js";

export class ProfileVerificationController {
  async sendPhoneOtpForVerification(req: Request, res: Response) {
    try {
      const user = req.user as { id: string } | undefined;
      if (!user?.id) {
        return res.status(401).json({ success: false, message: "Unauthorized", data: null });
      }

      const body = req.body as SendPhoneOtpSchema;

      const profile = await prisma.userProfile.findUnique({
        where: { userId: user.id },
      });

      if (!profile) {
        return res.status(404).json({ success: false, message: "Profile not found", data: null });
      }

      const phoneNumberFromRequest = (body as any).phoneNumber as string | undefined;
      const phoneNumberFromProfile =
        (profile as any).phoneNumber ?? (profile as any).user?.phoneNumber ?? null;
      const phoneNumber = phoneNumberFromRequest ?? phoneNumberFromProfile;

      if (!phoneNumber) {
        return res
          .status(400)
          .json({ success: false, message: "Phone number is required", data: null });
      }

      const phoneNormalized = String(phoneNumber).trim();
      const phoneDigits = phoneNormalized.replace(/\s+/g, "");
      if (!/^\d{10,15}$/.test(phoneDigits)) {
        return res.status(400).json({
          success: false,
          message: "Phone number must be a valid phone number",
          data: null,
        });
      }

      await prisma.userProfile.update({
        where: { userId: user.id },
        data: {
          phoneNumber: phoneDigits,
        },
      });

      const updatedProfile = await prisma.userProfile.findUnique({
        where: { userId: user.id },
        include: { user: true },
      });

      if (!updatedProfile?.user?.email) {
        return res.status(500).json({
          success: false,
          message: "Failed to resolve user email",
          data: null,
        });
      }

      await prisma.otp.deleteMany({
        where: {
          email: updatedProfile.user.email,
          purpose: "PHONE_VERIFICATION",
        },
      });

      await sendOtp({
        email: updatedProfile.user.email,
        subject: "Phone Verification OTP",
        purpose: "PHONE_VERIFICATION",
      });

      return res.status(200).json({
        success: true,
        message: "OTP sent successfully",
        data: { phoneNumber: phoneDigits },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to send OTP",
        data: null,
      });
    }
  }

  async verifyPhoneOtpForVerification(req: Request, res: Response) {
    try {
      const user = req.user as { id: string } | undefined;
      if (!user?.id) {
        return res.status(401).json({ success: false, message: "Unauthorized", data: null });
      }

      const body = req.body as VerifyPhoneOtpSchema;

      const profile = await prisma.userProfile.findUnique({
        where: { userId: user.id },
      });

      if (!profile) {
        return res.status(404).json({ success: false, message: "Profile not found", data: null });
      }

      const phoneNumber =
        (profile as any).phoneNumber ?? (profile as any).user?.phoneNumber ?? null;

      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          message: "Phone number is required",
          data: null,
        });
      }

      const updatedProfile = await prisma.userProfile.findUnique({
        where: { userId: user.id },
        include: { user: true },
      });

      const otpRecord = await prisma.otp.findFirst({
        where: {
          email: updatedProfile?.user?.email ?? "",
          purpose: "PHONE_VERIFICATION",
        },
        orderBy: { createdAt: "desc" },
      });

      if (!otpRecord) {
        return res.status(400).json({
          success: false,
          message: "OTP expired or not found. Please request a new one.",
          data: null,
        });
      }

      if (new Date() > otpRecord.expiresAt) {
        await prisma.otp.delete({ where: { id: otpRecord.id } });
        return res.status(400).json({
          success: false,
          message: "OTP expired. Please request a new one.",
          data: null,
        });
      }

      const isValid = await verifyOtp(otpRecord.code, body.code);
      if (!isValid) {
        return res.status(400).json({
          success: false,
          message: "Invalid OTP code",
          data: null,
        });
      }

      await prisma.otp.delete({ where: { id: otpRecord.id } });

      const verification = await prisma.profileVerification.upsert({
        where: { userProfileId: profile.id },
        update: {
          phone_number_verified: true,
          isVerifided: true,
        },
        create: {
          userProfileId: profile.id,
          phone_number_verified: true,
          isVerifided: true,
        },
      });

      return res.status(200).json({
        success: true,
        message: "Phone number verified successfully",
        data: verification,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to verify OTP",
        data: null,
      });
    }
  }
}
