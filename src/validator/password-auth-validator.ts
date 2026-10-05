import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  password: z.string().min(8, { message: "Password must be at least 8 characters long" }),
});

export const registrationSchema = z.object({
  fullName: z.string().min(2, { message: "Full name must be at least 2 characters long" }),
  phoneNumber: z.string().e164("Phone number must be in E.164 format"),
  gender: z.string().toUpperCase(),
  dateOfBirth: z.iso.date({ message: "Invalid date of birth" }),
  email: z.string().email({ message: "Invalid email address" }),
  ethnicity: z.string().optional(),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters long" })
    .regex(/[A-Z]/, { message: "Password must contain at least one uppercase letter" })
    .regex(/[a-z]/, { message: "Password must contain at least one lowercase letter" })
    .regex(/[0-9]/, { message: "Password must contain at least one number" })
    .regex(/[\W_]/, { message: "Password must contain at least one special character" }),
});

export const requestResetPasswordSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
});

export const resetPasswordSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  otp: z.string().length(6, { message: "OTP must be 6 digits long" }).optional(),
  token: z.string().optional(),
  newPassword: z
    .string()
    .min(8, { message: "Password must be at least 8 characters long" })
    .regex(/[A-Z]/, { message: "Password must contain at least one uppercase letter" })
    .regex(/[a-z]/, { message: "Password must contain at least one lowercase letter" })
    .regex(/[0-9]/, { message: "Password must contain at least one number" })
    .regex(/[\W_]/, { message: "Password must contain at least one special character" }),
});

export type LoginSchema = z.infer<typeof loginSchema>;
export type RegistrationSchema = z.infer<typeof registrationSchema>;
export type RequestResetPasswordSchema = z.infer<typeof requestResetPasswordSchema>;
export type ResetPasswordSchema = z.infer<typeof resetPasswordSchema>;
