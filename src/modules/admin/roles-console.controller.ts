import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { AdminRole, AdminDepartment } from "../../../generated/prisma/client.js";
import { ok, fail } from "../../helpers/response.js";
import {
  PERMISSIONS,
  getAllPermissionsForRole,
  hasPermissionKey,
} from "../../middleware/permissions.js";
import { ROLE_DEPARTMENT, DEPARTMENT_ROLES } from "../../config/admin-roles.js";

const ALL_ROLES = Object.values(AdminRole) as AdminRole[];
const ALL_DEPARTMENTS = Object.values(AdminDepartment) as AdminDepartment[];

function buildModules() {
  return Object.entries(PERMISSIONS).map(([moduleKey, actions]) => ({
    key: moduleKey.toLowerCase(),
    label: moduleKey.charAt(0) + moduleKey.slice(1).toLowerCase(),
    actions: Object.entries(actions).map(([actionKey, permission]) => ({
      action: actionKey.toLowerCase(),
      permission,
    })),
  }));
}

function buildMatrix() {
  const matrix: Record<string, Record<AdminRole, boolean>> = {};
  for (const [_moduleKey, actions] of Object.entries(PERMISSIONS)) {
    for (const permission of Object.values(actions)) {
      matrix[permission] = Object.fromEntries(
        ALL_ROLES.map((role) => [role, hasPermissionKey(role, permission)]),
      ) as Record<AdminRole, boolean>;
    }
  }
  return matrix;
}

/**
 * Admin console — Roles & Permissions view (§3.12).
 *
 * Read-only: the four roles with their department, admin count, assigned
 * admins, permission statements, and the module × action matrix. Both the list
 * and the matrix derive from the single PERMISSIONS / ROLE_SCOPES_MAP source of
 * truth (with department membership from admin-roles.ts), so the screen can
 * never drift from what requirePermission() actually enforces.
 */
export class AdminRolesConsoleController {
  async summary(req: Request, res: Response) {
    try {
      const profiles = await prisma.adminProfile.findMany({
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              accountStatus: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      const byRole = new Map<AdminRole, (typeof profiles)[number][]>();
      for (const profile of profiles) {
        const bucket = byRole.get(profile.role) ?? [];
        bucket.push(profile);
        byRole.set(profile.role, bucket);
      }

      const roles = ALL_ROLES.map((role) => {
        const members = byRole.get(role) ?? [];
        return {
          role,
          department: ROLE_DEPARTMENT[role],
          adminCount: members.length,
          permissions: getAllPermissionsForRole(role),
          admins: members.map((member) => ({
            id: member.user.id,
            fullName: member.user.fullName,
            email: member.user.email,
            accountStatus: member.user.accountStatus,
            mfaEnabled: member.mfaEnabled,
          })),
        };
      });

      const departments = ALL_DEPARTMENTS.map((department) => ({
        department,
        roles: DEPARTMENT_ROLES[department],
      }));

      return ok(res, {
        modules: buildModules(),
        matrix: buildMatrix(),
        roles,
        departments,
      });
    } catch (error) {
      console.error("Failed to load admin roles:", error);
      return fail(res, 500, "Failed to load admin roles");
    }
  }
}
