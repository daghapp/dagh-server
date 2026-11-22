import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import type {
  SendPhoneOtpSchema,
  VerifyPhoneOtpSchema,
} from "../../validator/profile-phone-verification-validator.js";
import { verifyOtp, normalizePhone, maskPhone } from "../../helpers/otp.js";
import { sendSms } from "../../helpers/sms.js";
import sendEmail from "../../config/resend.config.js";
import bcrypt from "bcrypt";
import { randomInt } from "crypto";
import { hashPhoneNumber } from "../../helpers/phoneHash.js";
import { syncPhoneHashVariants } from "../contacts/contacts.service.js";
import { ok, fail } from "../../helpers/response.js";
import { ensureUserProfile } from "../../helpers/ensure-user-profile.js";

export class ProfileVerificationController {
  async sendPhoneOtpForVerification(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) {
      return fail(res, 401, "Unauthorized");
    }

    try {
      const body = req.body as SendPhoneOtpSchema;

      const profile = await ensureUserProfile(userId);

      const phoneNumberFromRequest = body.phoneNumber as string | undefined;
      const phoneNumberFromProfile = profile.phoneNumber ?? null;
      const phoneNumber = phoneNumberFromRequest ?? phoneNumberFromProfile;

      if (!phoneNumber) {
        return fail(res, 400, "Phone number is required");
      }

      const phoneNormalized = normalizePhone(phoneNumber);
      if (!phoneNormalized) {
        return fail(res, 400, "Phone number must be a valid phone number");
      }

      await prisma.userProfile.update({
        where: { userId },
        data: { phoneNumber: phoneNormalized },
      });

      try {
        await prisma.user.update({
          where: { id: userId },
          data: {
            phoneNumber: phoneNormalized,
            phoneNumberHash: hashPhoneNumber(phoneNormalized),
            phoneHash: hashPhoneNumber(phoneNormalized),
          },
        });
        await syncPhoneHashVariants(userId, phoneNormalized);
      } catch {
        // ignore
      }

      const updatedProfile = await prisma.userProfile.findUnique({
        where: { userId },
        include: { user: true },
      });

      if (!updatedProfile?.user?.email) {
        return fail(res, 500, "Failed to resolve user email");
      }

      // Invalidate all older active OTPs for this user's phone verification
      const deleted = await prisma.otp.deleteMany({
        where: {
          email: updatedProfile.user.email,
          purpose: "PHONE_VERIFICATION",
        },
      });

      const otp = randomInt(100000, 999999);
      const expirationTime = new Date(Date.now() + 10 * 60 * 1000);
      const hashedOtp = await bcrypt.hash(otp.toString(), 10);

      const otpRecord = await prisma.otp.create({
        data: {
          code: hashedOtp,
          expiresAt: expirationTime,
          email: updatedProfile.user.email,
          purpose: "PHONE_VERIFICATION",
        },
      });

      const otpResult = { challengeId: otpRecord.id, expiresAt: expirationTime };
      const resendAvailableAt = new Date(Date.now() + 60 * 1000);

      // Send the verification code to the phone number via SMS.
      try {
        await sendSms({
          to: phoneNormalized,
          message: `Your Diaspora Sync verification code is: ${otp}. It expires in 10 minutes.`,
        });
      } catch (smsError) {
        console.error("[SMS_SEND_ERROR]", { to: phoneNormalized, error: smsError });

        // Fall back to email delivery so the user still receives their code
        // and can continue verification even when SMS is unavailable.
        try {
          await sendEmail({
            email: updatedProfile.user.email,
            subject: "Your Diaspora Sync verification code",
            html: `<p>Your verification code is: <strong>${otp}</strong>. It will expire in 10 minutes.</p>`,
          });
        } catch (emailError) {
          console.error("[EMAIL_FALLBACK_ERROR]", { userId, error: emailError });
          return fail(
            res,
            502,
            "Failed to deliver verification code by SMS or email. Please try again.",
          );
        }

        return ok(
          res,
          {
            challengeId: otpResult.challengeId,
            phoneNumber: phoneNormalized,
            expiresAt: otpResult.expiresAt,
            resendAvailableAt,
            deliveryChannel: "EMAIL",
          },
          "Verification code sent to your email (SMS unavailable)",
        );
      }

      console.log("[OTP_SEND]", {
        userId,
        challengeId: otpResult.challengeId,
        phoneMasked: maskPhone(phoneNormalized),
        expiresAt: otpResult.expiresAt.toISOString(),
        resendAvailableAt: resendAvailableAt.toISOString(),
        previousChallengesInvalidated: deleted.count,
        deliveryChannel: "SMS",
      });

      return ok(
        res,
        {
          challengeId: otpResult.challengeId,
          phoneNumber: phoneNormalized,
          expiresAt: otpResult.expiresAt,
          resendAvailableAt,
        },
        "OTP sent successfully",
      );
    } catch (error) {
      console.error("[OTP_SEND_ERROR]", { userId, error });
      return fail(res, 500, "Failed to send OTP");
    }
  }

  async verifyPhoneOtpForVerification(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) {
      return fail(res, 401, "Unauthorized");
    }

    try {
      const body = req.body as VerifyPhoneOtpSchema;

      const profile = await ensureUserProfile(userId);
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });

      const existingVerification = await prisma.profileVerification.findUnique({
        where: { userProfileId: profile.id },
      });

      if (existingVerification?.phone_number_verified) {
        console.log("[OTP_VERIFY_ALREADY_VERIFIED]", { userId });
        return fail(res, 409, {
          code: "PHONE_ALREADY_VERIFIED",
          message: "Phone number is already verified",
        });
      }

      const requestedChallengeId = body.challengeId;

      let otpRecord;
      if (requestedChallengeId) {
        otpRecord = await prisma.otp.findUnique({
          where: { id: requestedChallengeId },
        });
      } else {
        const requestedPhone = normalizePhone(body.phoneNumber ?? "");
        if (!requestedPhone || (profile.phoneNumber && requestedPhone !== profile.phoneNumber)) {
          return fail(res, 404, {
            code: "OTP_CHALLENGE_NOT_FOUND",
            message: "No active challenge",
          });
        }
        otpRecord = await prisma.otp.findFirst({
          where: {
            email: user?.email,
            purpose: "PHONE_VERIFICATION",
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: "desc" },
        });
      }

      if (!otpRecord) {
        console.log("[OTP_VERIFY_CHALLENGE_NOT_FOUND]", {
          userId,
          challengeId: requestedChallengeId,
        });
        return fail(res, 404, { code: "OTP_CHALLENGE_NOT_FOUND", message: "No active challenge" });
      }

      const challengeId = otpRecord.id;

      // Scope OTP to the authenticated user — reject if the challenge belongs to a different account
      if (otpRecord.email !== user?.email) {
        console.log("[OTP_VERIFY_CHALLENGE_NOT_FOUND]", { userId, challengeId });
        return fail(res, 404, { code: "OTP_CHALLENGE_NOT_FOUND", message: "No active challenge" });
      }

      if (new Date() > otpRecord.expiresAt) {
        await prisma.otp.delete({ where: { id: otpRecord.id } });
        console.log("[OTP_VERIFY_EXPIRED]", { userId, challengeId });
        return fail(res, 400, {
          code: "OTP_EXPIRED",
          message: "The verification code has expired. Request a new code.",
        });
      }

      const isValid = await verifyOtp(otpRecord.code, body.code);
      if (!isValid) {
        console.log("[OTP_VERIFY_INVALID]", { userId, challengeId });
        return fail(res, 400, { code: "OTP_INVALID", message: "Code does not match" });
      }

      await prisma.otp.delete({ where: { id: otpRecord.id } });

      const verification = await prisma.profileVerification.upsert({
        where: { userProfileId: profile.id },
        update: {
          phone_number_verified: true,
          isVerified: false,
          validationStep: "PROFILE_IMAGE_VERIFICATION",
        },
        create: {
          userProfileId: profile.id,
          phone_number_verified: true,
          isVerified: false,
          validationStep: "PROFILE_IMAGE_VERIFICATION",
        },
      });

      const phoneMasked = maskPhone(profile.phoneNumber ?? "");

      console.log("[OTP_VERIFY_SUCCESS]", {
        userId,
        challengeId,
        phoneMasked,
        verificationId: verification.id,
      });

      return ok(
        res,
        { ...verification, isVerified: verification.phone_number_verified },
        "Phone number verified successfully",
      );
    } catch (error) {
      console.error("[OTP_VERIFY_ERROR]", { userId, error });
      return fail(res, 500, "Failed to verify OTP");
    }
  }
}
