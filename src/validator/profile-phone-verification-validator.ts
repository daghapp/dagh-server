import { z } from "zod";

export const sendPhoneOtpSchema = z.object({
  phoneNumber: z.string().optional(),
  deliveryMethod: z.enum(["EMAIL", "SMS"]).default("EMAIL").optional(),
});

export const verifyPhoneOtpSchema = z.object({
  challengeId: z.string().uuid({ message: "Invalid challenge ID" }),
  code: z
    .string()
    .length(6, { message: "OTP must be 6 digits" })
    .regex(/^\d+$/, { message: "OTP must contain only numbers" }),
});

export type SendPhoneOtpSchema = z.infer<typeof sendPhoneOtpSchema>;
export type VerifyPhoneOtpSchema = z.infer<typeof verifyPhoneOtpSchema>;
