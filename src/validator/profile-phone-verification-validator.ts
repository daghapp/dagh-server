import { z } from "zod";

export const sendPhoneOtpSchema = z
  .object({
    phoneNumber: z.string().optional(),
  })
  .default({});

export const verifyPhoneOtpSchema = z
  .object({
    challengeId: z.string().uuid({ message: "Invalid challenge ID" }).optional(),
    phoneNumber: z.string().optional(),
    code: z
      .string()
      .length(6, { message: "OTP must be 6 digits" })
      .regex(/^\d+$/, { message: "OTP must contain only numbers" }),
  })
  .refine((data) => Boolean(data.challengeId || data.phoneNumber), {
    message: "challengeId or phoneNumber is required",
    path: ["challengeId"],
  });

export type SendPhoneOtpSchema = z.infer<typeof sendPhoneOtpSchema>;
export type VerifyPhoneOtpSchema = z.infer<typeof verifyPhoneOtpSchema>;
