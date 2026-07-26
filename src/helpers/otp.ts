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

  await prisma.otp.create({
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

  return otp;
}

export async function verifyOtp(hashedCode: string, plainCode: string): Promise<boolean> {
  return bcrypt.compare(plainCode, hashedCode);
}
