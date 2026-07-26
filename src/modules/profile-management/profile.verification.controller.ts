import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import type {
  SendPhoneOtpSchema,
  VerifyPhoneOtpSchema,
} from "../../validator/profile-phone-verification-validator.js";
import { sendOtp, verifyOtp } from "../../helpers/otp.js";
import { ok, fail } from "../../helpers/response.js";

export class ProfileVerificationController {
  async sendPhoneOtpForVerification(req: Request, res: Response) {
    try {
      const user = req.user as { id: string } | undefined;
      if (!user?.id) {
        return fail(res, 401, "Unauthorized");
      }

      const body = req.body as SendPhoneOtpSchema;

      const profile = await prisma.userProfile.findUnique({
        where: { userId: user.id },
      });

      if (!profile) {
        return fail(res, 404, "Profile not found");
      }

      const phoneNumberFromRequest = body.phoneNumber as string | undefined;
      const phoneNumberFromProfile = profile.phoneNumber ?? null;
      const phoneNumber = phoneNumberFromRequest ?? phoneNumberFromProfile;

      if (!phoneNumber) {
        return fail(res, 400, "Phone number is required");
      }

      const phoneNormalized = String(phoneNumber).trim();
      const phoneDigits = phoneNormalized.replace(/\s+/g, "");
      if (!/^\d{10,15}$/.test(phoneDigits)) {
        return fail(res, 400, "Phone number must be a valid phone number");
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
        return fail(res, 500, "Failed to resolve user email");
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

      return ok(res, { phoneNumber: phoneDigits }, "OTP sent successfully");
    } catch (_error) {
      return fail(res, 500, "Failed to send OTP");
    }
  }

  async verifyPhoneOtpForVerification(req: Request, res: Response) {
    try {
      const user = req.user as { id: string } | undefined;
      if (!user?.id) {
        return fail(res, 401, "Unauthorized");
      }

      const body = req.body as VerifyPhoneOtpSchema;

      const profile = await prisma.userProfile.findUnique({
        where: { userId: user.id },
      });

      if (!profile) {
        return fail(res, 404, "Profile not found");
      }

      const phoneNumber = profile.phoneNumber ?? null;

      if (!phoneNumber) {
        return fail(res, 400, "Phone number is required");
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
        return fail(res, 400, "OTP expired or not found. Please request a new one.");
      }

      if (new Date() > otpRecord.expiresAt) {
        await prisma.otp.delete({ where: { id: otpRecord.id } });
        return fail(res, 400, "OTP expired. Please request a new one.");
      }

      const isValid = await verifyOtp(otpRecord.code, body.code);
      if (!isValid) {
        return fail(res, 400, "Invalid OTP code");
      }

      await prisma.otp.delete({ where: { id: otpRecord.id } });

      const verification = await prisma.profileVerification.upsert({
        where: { userProfileId: profile.id },
        update: {
          phone_number_verified: true,
          isVerified: true,
        },
        create: {
          userProfileId: profile.id,
          phone_number_verified: true,
          isVerified: true,
        },
      });

      return ok(res, verification, "Phone number verified successfully");
    } catch (_error) {
      return fail(res, 500, "Failed to verify OTP");
    }
  }
}
