import { z } from "zod";
import { AdminDepartment, AdminRole } from "../../generated/prisma/client.js";
import { roleBelongsToDepartment } from "../config/admin-roles.js";
import { strongPassword } from "./password-auth-validator.js";

export const adminRegistrationSchema = z
  .object({
    fullName: z.string().min(2, { message: "Full name must be at least 2 characters long" }),
    email: z.string().email({ message: "Invalid email address" }),
    phoneNumber: z.string().e164("Phone number must be in E.164 format").optional(),
    password: strongPassword,
    department: z.enum(AdminDepartment),
    role: z.enum(AdminRole),
    acceptedTerms: z.literal(true, { message: "You must accept the terms and conditions" }),
  })
  .superRefine((data, ctx) => {
    if (!roleBelongsToDepartment(data.role, data.department)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["role"],
        message: `Role ${data.role} is not allowed in the ${data.department} department`,
      });
    }
  });

export type AdminRegistrationSchema = z.infer<typeof adminRegistrationSchema>;
