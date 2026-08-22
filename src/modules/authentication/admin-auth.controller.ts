import { Request, Response } from "express";
import * as bcrypt from "bcrypt";
import { prisma } from "../../config/index.js";
import { AdminRegistrationSchema } from "../../validator/admin-auth-validator.js";
import { created, fail } from "../../helpers/response.js";

// Optional gate: when ADMIN_OFFICIAL_EMAIL_DOMAIN is set, only emails under that
// domain can self-register as admins (e.g. "dagh.app"). Leave unset to allow any.
const OFFICIAL_EMAIL_DOMAIN = process.env.ADMIN_OFFICIAL_EMAIL_DOMAIN?.toLowerCase();

export class AdminAuthController {
  // Direct admin registration — creates an ACTIVE admin account with department + role
  async register(req: Request, res: Response) {
    try {
      const data = req.body as AdminRegistrationSchema;

      if (OFFICIAL_EMAIL_DOMAIN) {
        const domain = data.email.split("@")[1]?.toLowerCase();
        if (!domain || domain !== OFFICIAL_EMAIL_DOMAIN) {
          return fail(
            res,
            403,
            `Admin registration is restricted to the official email domain @${OFFICIAL_EMAIL_DOMAIN}`,
          );
        }
      }

      const userExists = await prisma.user.findUnique({
        where: { email: data.email },
      });

      if (userExists) {
        return fail(res, 400, "User already exists");
      }

      if (data.phoneNumber) {
        const phoneExists = await prisma.user.findUnique({
          where: { phoneNumber: data.phoneNumber },
        });
        if (phoneExists) {
          return fail(res, 400, "Phone number already in use");
        }
      }

      const hashedPassword = await bcrypt.hash(data.password, 10);

      const newUser = await prisma.user.create({
        data: {
          authProvider: "PASSWORD",
          fullName: data.fullName,
          email: data.email,
          phoneNumber: data.phoneNumber ?? null,
          passwordHash: hashedPassword,
          accountType: "ADMIN",
          accountStatus: "ACTIVE",
          adminProfile: {
            create: {
              department: data.department,
              role: data.role,
            },
          },
        },
        include: { adminProfile: true },
      });

      const { passwordHash: _removed, ...safeUser } = newUser;

      return created(res, safeUser, "Admin registered successfully");
    } catch (error) {
      console.error("Admin registration error:", error);
      return fail(res, 500, "Admin registration failed");
    }
  }
}
