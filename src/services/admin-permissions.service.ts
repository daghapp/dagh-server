import { AdminRole } from "../../generated/prisma/client.js";
import { getAllPermissionsForRole } from "../middleware/permissions.js";

export function getAdminPermissions(role: AdminRole | null): string[] {
  return role ? getAllPermissionsForRole(role) : [];
}
