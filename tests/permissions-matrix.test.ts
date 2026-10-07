import { describe, expect, it } from "vitest";
import { AdminRole, AdminDepartment } from "../generated/prisma/client.js";
import {
  PERMISSIONS,
  hasPermissionKey,
  getAllPermissionsForRole,
} from "../src/middleware/permissions.js";
import {
  ROLE_DEPARTMENT,
  DEPARTMENT_ROLES,
  roleBelongsToDepartment,
} from "../src/config/admin-roles.js";

const ALL_ROLES = Object.values(AdminRole) as AdminRole[];

const ALL_PERMISSIONS: string[] = Object.values(PERMISSIONS).flatMap(
  (module) => Object.values(module) as unknown as string[],
);

function permsOf(role: AdminRole): Set<string> {
  return new Set(getAllPermissionsForRole(role));
}

describe("Permission matrix (§4)", () => {
  it("covers every role with a non-empty permission set", () => {
    for (const role of ALL_ROLES) {
      expect(getAllPermissionsForRole(role).length).toBeGreaterThan(0);
    }
  });

  it("only references defined permission keys (no orphan/typo grants)", () => {
    const defined = new Set(ALL_PERMISSIONS);
    for (const role of ALL_ROLES) {
      for (const permission of getAllPermissionsForRole(role)) {
        expect(defined.has(permission)).toBe(true);
      }
    }
  });

  it("grants dashboard.view to every role", () => {
    for (const role of ALL_ROLES) {
      expect(hasPermissionKey(role, PERMISSIONS.DASHBOARD.VIEW)).toBe(true);
    }
  });

  it("grants notifications.view to every role but manage to SUPER_ADMIN only", () => {
    for (const role of ALL_ROLES) {
      expect(hasPermissionKey(role, PERMISSIONS.NOTIFICATIONS.VIEW)).toBe(true);
    }
    const superPerms = permsOf(AdminRole.SUPER_ADMIN);
    for (const role of ALL_ROLES) {
      if (role === AdminRole.SUPER_ADMIN) {
        expect(superPerms.has(PERMISSIONS.NOTIFICATIONS.MANAGE)).toBe(true);
      } else {
        expect(hasPermissionKey(role, PERMISSIONS.NOTIFICATIONS.MANAGE)).toBe(false);
      }
    }
  });

  it("SUPER_ADMIN holds every defined permission", () => {
    const superPerms = permsOf(AdminRole.SUPER_ADMIN);
    for (const permission of ALL_PERMISSIONS) {
      expect(superPerms.has(permission)).toBe(true);
    }
  });

  it("matches the SUPERVISORY/moderator column for OPERATIONS", () => {
    const ops = permsOf(AdminRole.OPERATIONS);
    for (const p of [
      PERMISSIONS.TOURS.VIEW,
      PERMISSIONS.TOURS.EDIT,
      PERMISSIONS.TOURS.APPROVE,
      PERMISSIONS.PAYMENTS.VIEW,
      PERMISSIONS.USERS.VIEW,
      PERMISSIONS.USERS.EDIT,
      PERMISSIONS.USERS.SUSPEND,
      PERMISSIONS.USERS.APPROVE,
      PERMISSIONS.USERS.REJECT,
      PERMISSIONS.DATING.APPROVE,
      PERMISSIONS.DATING.WARN,
      PERMISSIONS.NGO_ACCESS.GRANT,
      PERMISSIONS.REPORTS.MANAGE,
    ]) {
      expect(ops.has(p)).toBe(true);
    }
    for (const p of [
      PERMISSIONS.TOURS.DELETE,
      PERMISSIONS.PAYMENTS.REFUND,
      PERMISSIONS.PAYMENTS.TOGGLE,
      PERMISSIONS.USERS.TERMINATE,
      PERMISSIONS.USERS.DELETE,
      PERMISSIONS.USERS.WARN,
      PERMISSIONS.SETTINGS.FULL,
    ]) {
      expect(ops.has(p)).toBe(false);
    }
  });

  it("matches the FINANCE column", () => {
    const fin = permsOf(AdminRole.FINANCE);
    for (const p of [
      PERMISSIONS.PAYMENTS.VIEW,
      PERMISSIONS.PAYMENTS.REFUND,
      PERMISSIONS.PAYMENTS.FLAG,
      PERMISSIONS.PAYMENTS.EXPORT,
      PERMISSIONS.USERS.VIEW,
      PERMISSIONS.BUSINESS_APPS.VIEW,
      PERMISSIONS.NGO_ACCESS.VIEW,
      PERMISSIONS.REPORTS.EXPORT,
      PERMISSIONS.REPORTS.GENERATE,
    ]) {
      expect(fin.has(p)).toBe(true);
    }
    for (const p of [
      PERMISSIONS.PAYMENTS.TOGGLE,
      PERMISSIONS.USERS.SUSPEND,
      PERMISSIONS.USERS.APPROVE,
      PERMISSIONS.DATING.APPROVE,
      PERMISSIONS.TOURS.EDIT,
      PERMISSIONS.SETTINGS.FULL,
      PERMISSIONS.REPORTS.MANAGE,
    ]) {
      expect(fin.has(p)).toBe(false);
    }
  });

  it("matches the SUPPORT column", () => {
    const sup = permsOf(AdminRole.SUPPORT);
    for (const p of [
      PERMISSIONS.TOURS.VIEW,
      PERMISSIONS.PAYMENTS.VIEW,
      PERMISSIONS.USERS.VIEW,
      PERMISSIONS.USERS.LOOKUP,
      PERMISSIONS.DATING.VIEW,
      PERMISSIONS.BUSINESS_APPS.VIEW,
      PERMISSIONS.NGO_ACCESS.VIEW,
      PERMISSIONS.REPORTS.VIEW,
    ]) {
      expect(sup.has(p)).toBe(true);
    }
    for (const p of [
      PERMISSIONS.TOURS.EDIT,
      PERMISSIONS.PAYMENTS.REFUND,
      PERMISSIONS.USERS.SUSPEND,
      PERMISSIONS.DATING.APPROVE,
      PERMISSIONS.NGO_ACCESS.GRANT,
      PERMISSIONS.REPORTS.EXPORT,
      PERMISSIONS.REPORTS.MANAGE,
      PERMISSIONS.SETTINGS.FULL,
    ]) {
      expect(sup.has(p)).toBe(false);
    }
  });

  it("keeps SUPER_ADMIN-only keys exclusive", () => {
    const exclusive = [
      PERMISSIONS.SETTINGS.FULL,
      PERMISSIONS.USERS.DELETE,
      PERMISSIONS.USERS.WARN,
      PERMISSIONS.PAYMENTS.TOGGLE,
      PERMISSIONS.AUDIT.VIEW,
      PERMISSIONS.AUDIT.EXPORT,
      PERMISSIONS.MAINTENANCE.MANAGE,
      PERMISSIONS.ROLES.VIEW,
      PERMISSIONS.ROLES.MANAGE,
    ];
    for (const permission of exclusive) {
      expect(hasPermissionKey(AdminRole.SUPER_ADMIN, permission)).toBe(true);
      for (const role of [AdminRole.OPERATIONS, AdminRole.FINANCE, AdminRole.SUPPORT]) {
        expect(hasPermissionKey(role, permission)).toBe(false);
      }
    }
  });

  it("maps each role to exactly one department and back (strict 1:1)", () => {
    for (const role of ALL_ROLES) {
      const department = ROLE_DEPARTMENT[role];
      expect(DEPARTMENT_ROLES[department]).toEqual([role]);
    }
    for (const department of Object.values(AdminDepartment) as AdminDepartment[]) {
      expect(DEPARTMENT_ROLES[department].length).toBe(1);
    }
  });

  it("validates role↔department membership both directions", () => {
    expect(roleBelongsToDepartment(AdminRole.FINANCE, AdminDepartment.FINANCE_AND_COMPLIANCE)).toBe(
      true,
    );
    expect(roleBelongsToDepartment(AdminRole.FINANCE, AdminDepartment.TECHNICAL_SUPPORT)).toBe(
      false,
    );
    expect(
      roleBelongsToDepartment(AdminRole.OPERATIONS, AdminDepartment.OPERATIONS_AND_MEMBERSHIP),
    ).toBe(true);
  });
});
