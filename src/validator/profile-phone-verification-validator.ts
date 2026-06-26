import { z } from "zod";

export const sendPhoneOtpSchema = z.object({
  // If omitted, we use req.user.profile.phoneNumber
  phoneNumber: z.string().optional(),
});

export const verifyPhoneOtpSchema = z.object({
  // Optional override; if omitted we use profile.phoneNumber
  phoneNumber: z.string().optional(),
  code: z
    .string()
    .length(6, { message: "OTP must be 6 digits" })
    .regex(/^\d+$/, { message: "OTP must contain only numbers" }),
});

export type SendPhoneOtpSchema = z.infer<typeof sendPhoneOtpSchema>;
export type VerifyPhoneOtpSchema = z.infer<typeof verifyPhoneOtpSchema>;

