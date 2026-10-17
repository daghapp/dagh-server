import { AdminDepartment, AdminRole } from "../../generated/prisma/client.js";

// Role ↔ department mapping per the Admin Panel spec (§3.1, §4). Each of the
// four roles belongs to exactly one department.
export const ROLE_DEPARTMENT: Record<AdminRole, AdminDepartment> = {
  [AdminRole.SUPER_ADMIN]: AdminDepartment.EXECUTIVE_MANAGEMENT,
  [AdminRole.OPERATIONS]: AdminDepartment.OPERATIONS_AND_MEMBERSHIP,
  [AdminRole.FINANCE]: AdminDepartment.FINANCE_AND_COMPLIANCE,
  [AdminRole.SUPPORT]: AdminDepartment.TECHNICAL_SUPPORT,
};

export const DEPARTMENT_ROLES: Record<AdminDepartment, AdminRole[]> = {
  [AdminDepartment.EXECUTIVE_MANAGEMENT]: [AdminRole.SUPER_ADMIN],
  [AdminDepartment.OPERATIONS_AND_MEMBERSHIP]: [AdminRole.OPERATIONS],
  [AdminDepartment.FINANCE_AND_COMPLIANCE]: [AdminRole.FINANCE],
  [AdminDepartment.TECHNICAL_SUPPORT]: [AdminRole.SUPPORT],
};

export function roleBelongsToDepartment(role: AdminRole, department: AdminDepartment): boolean {
  return ROLE_DEPARTMENT[role] === department;
}
