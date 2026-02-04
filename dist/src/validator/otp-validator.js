import { z } from 'zod';
var OtpPurpose;
(function (OtpPurpose) {
    OtpPurpose["EMAIL_VERIFICATION"] = "EMAIL_VERIFICATION";
    OtpPurpose["PASSWORD_RESET"] = "PASSWORD_RESET";
})(OtpPurpose || (OtpPurpose = {}));
export const verifyOtpSchema = z.object({
    email: z.string().email({ message: 'Invalid email address' }),
    code: z.string().length(6, { message: 'OTP must be 6 digits' })
        .regex(/^\d+$/, { message: 'OTP must contain only numbers' }),
    purpose: z.nativeEnum(OtpPurpose, { message: 'Invalid OTP purpose' })
});
export const resendOtpSchema = z.object({
    email: z.string().email({ message: 'Invalid email address' })
});
