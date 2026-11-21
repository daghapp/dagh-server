import { pathToFileURL } from "node:url";
import * as bcrypt from "bcrypt";
import { prisma } from "../src/config/index.js";
import { ROLE_DEPARTMENT } from "../src/config/admin-roles.js";
import { AdminRole } from "../generated/prisma/client.js";

const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
const fullName = process.env.ADMIN_BOOTSTRAP_NAME?.trim() || "DAGH Super Admin";
const phoneNumber = process.env.ADMIN_BOOTSTRAP_PHONE?.trim() || null;
const requestedRole = (process.env.ADMIN_BOOTSTRAP_ROLE?.trim() || "SUPER_ADMIN") as AdminRole;

export async function bootstrapSuperAdmin() {
  if (!email || !password) {
    console.log("Admin bootstrap skipped: set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD");
    return;
  }

  const role = requestedRole in ROLE_DEPARTMENT ? requestedRole : AdminRole.SUPER_ADMIN;
  const department = ROLE_DEPARTMENT[role];
  const existing = await prisma.user.findUnique({
    where: { email },
    include: { adminProfile: true },
  });

  if (existing?.adminProfile) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        accountType: "ADMIN",
        accountStatus: "ACTIVE",
        passwordHash: await bcrypt.hash(password, 10),
        adminProfile: {
          update: {
            role,
            department,
          },
        },
      },
      select: { id: true, email: true, accountStatus: true, adminProfile: true },
    });
    console.log("Admin bootstrap updated existing admin:", updated.email);
    return;
  }

  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        accountType: "ADMIN",
        accountStatus: "ACTIVE",
        passwordHash: await bcrypt.hash(password, 10),
        adminProfile: { create: { role, department } },
      },
      select: { id: true, email: true, accountStatus: true, adminProfile: true },
    });
    console.log("Admin bootstrap promoted existing user:", updated.email);
    return;
  }

  const created = await prisma.user.create({
    data: {
      authProvider: "PASSWORD",
      fullName,
      email,
      phoneNumber,
      passwordHash: await bcrypt.hash(password, 10),
      accountType: "ADMIN",
      accountStatus: "ACTIVE",
      adminProfile: { create: { role, department } },
    },
    select: { id: true, email: true, accountStatus: true, adminProfile: true },
  });
  console.log("Admin bootstrap created admin:", created.email);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  bootstrapSuperAdmin()
    .catch((error) => {
      console.error("Admin bootstrap failed:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
