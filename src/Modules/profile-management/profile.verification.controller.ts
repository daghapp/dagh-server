import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import type {
  SendPhoneOtpSchema,
  VerifyPhoneOtpSchema,
} from "../../validator/profile-phone-verification-validator.js";
import { sendOtp } from "../../helpers/otp.js";

// NOTE: For now, OTP is hardcoded/validated against 123456 per requirement.
// We still generate an OTP record to keep behavior consistent.
const HARDCODED_OTP = "123456";

export class ProfileVerificationController {
  /**
   * POST /profile/phone/send-otp
   * - takes phone number from request body (if provided) else falls back to profile.phoneNumber
   * - validates phone number format
   * - saves phone number on profile
   * - sends OTP (email-based) and validates OTP against HARDCODED_OTP on verify
   */
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

      // Basic phone validation: digits only, length 10..15 (generic for GH/intl)
      const phoneNormalized = String(phoneNumber).trim();
      const phoneDigits = phoneNormalized.replace(/\s+/g, "");
      if (!/^\d{10,15}$/.test(phoneDigits)) {
        return res.status(400).json({
          success: false,
          message: "Phone number must be a valid phone number",
          data: null,
        });
      }

      // Save (or update) phone number on profile so subsequent verify uses it.
      await prisma.userProfile.update({
        where: { userId: user.id },
        data: {
          phoneNumber: phoneDigits,
        },
      });

      // Create an OTP record to keep behavior consistent with the existing OTP table.
      // (We still validate against HARDCODED_OTP.)
      await prisma.otp.deleteMany({
        where: {
          email: (profile as any).user?.email,
          purpose: "PHONE_VERIFICATION",
        },
      });

      // sendOtp requires email; use user's related email.
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

      await sendOtp({
        email: updatedProfile.user.email,
        subject: "Phone Verification OTP",
        purpose: "PHONE_VERIFICATION",
      });

      return res.status(200).json({
        success: true,
        message: "OTP sent successfully",
        data: {
          // Do not leak OTP; response minimal.
          phoneNumber: phoneDigits,
        },
      });
    } catch (error) {
      console.error("sendPhoneOtpForVerification error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to send OTP",
        data: null,
      });
    }
  }

  /**
   * POST /profile/phone/verify-otp
   * - validates code equals "123456"
   * - updates ProfileVerification flags for phone number verification
   */
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

      // Hardcoded validation rule
      if (body.code !== HARDCODED_OTP) {
        return res.status(400).json({
          success: false,
          message: "Invalid OTP code",
          data: null,
        });
      }

      // Upsert profile verification linked to this profile
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
      console.error("verifyPhoneOtpForVerification error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to verify OTP",
        data: null,
      });
    }
  }
}

