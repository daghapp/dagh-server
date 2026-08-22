import sendEmail from "../config/resend.config.js";
import { prisma } from "../config/prisma.js";
import * as bcrypt from "bcrypt";
import { randomInt } from "crypto";

interface OtpPayload {
  email: string;
  subject: string;
  purpose?: string;
}

export async function sendOtp({ email, subject, purpose }: OtpPayload) {
  const otp = randomInt(100000, 999999);
  const expirationTime = new Date(Date.now() + 10 * 60 * 1000);
  const hashedOtp = await bcrypt.hash(otp.toString(), 10);

  const otpRecord = await prisma.otp.create({
    data: {
      code: hashedOtp,
      expiresAt: expirationTime,
      email: email,
      purpose: purpose!,
    },
  });

  await sendEmail({
    email: email,
    subject: subject,
    html: `<p>Your OTP code is: <strong>${otp}</strong>. It will expire in 10 minutes.</p>`,
  });

  return { challengeId: otpRecord.id, expiresAt: expirationTime };
}

export async function verifyOtp(hashedCode: string, plainCode: string): Promise<boolean> {
  return bcrypt.compare(plainCode, hashedCode);
}

/**
 * Normalize a phone number to a consistent digits-only format.
 * Strips spaces, dashes, parentheses, and leading +.
 * Returns null if the result is not a plausible phone number (10-15 digits).
 */
export function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/[\s\-()+]/g, "");
  if (!/^\d{10,15}$/.test(digits)) return null;
  return digits;
}

/**
 * Mask a phone number for diagnostic logging.
 * Shows first 3 and last 2 digits, masks the rest.
 * e.g. "233501234567" -> "233***4567"
 */
export function maskPhone(phone: string): string {
  if (phone.length <= 5) return "***";
  return phone.slice(0, 3) + "*".repeat(phone.length - 5) + phone.slice(-2);
}
