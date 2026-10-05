import { z } from "zod";
import { AdminDepartment, AdminRole } from "../../generated/prisma/client.js";

export const adminRegistrationSchema = z.object({
  fullName: z.string().min(2, { message: "Full name must be at least 2 characters long" }),
  email: z.string().email({ message: "Invalid email address" }),
  phoneNumber: z.string().e164("Phone number must be in E.164 format").optional(),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters long" })
    .regex(/[A-Z]/, { message: "Password must contain at least one uppercase letter" })
    .regex(/[a-z]/, { message: "Password must contain at least one lowercase letter" })
    .regex(/[0-9]/, { message: "Password must contain at least one number" })
    .regex(/[\W_]/, { message: "Password must contain at least one special character" }),
  department: z.enum(AdminDepartment),
  role: z.enum(AdminRole),
  acceptedTerms: z.boolean().optional(),
});

export type AdminRegistrationSchema = z.infer<typeof adminRegistrationSchema>;
