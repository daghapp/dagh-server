import sendEmail from "../config/resend.config";
import { prisma } from "../config/prisma";
export async function sendOtp({ email, subject, purpose }) {
    const otp = Math.floor(100000 + Math.random() * 900000);
    const expirationTime = new Date(Date.now() + 10 * 60 * 1000);
    await prisma.otp.create({
        data: {
            code: otp.toString(),
            expiresAt: expirationTime,
            email: email,
            purpose: purpose,
        },
    });
    await sendEmail({
        email: email,
        subject: subject,
        html: `<p>Your OTP code is: <strong>${otp}</strong>. It will expire in 10 minutes.</p>`,
    });
    return otp;
}
