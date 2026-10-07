import { Request, Response } from "express";
import { AdminDepartment, AdminRole } from "../../../generated/prisma/client.js";
import { DEPARTMENT_ROLES } from "../../config/admin-roles.js";
import { ok } from "../../helpers/response.js";

export class AdminDepartmentsController {
  async getDepartments(req: Request, res: Response) {
    const departments = Object.values(AdminDepartment);
    const roles = Object.values(AdminRole);
    return ok(res, { departments, roles, rolesByDepartment: DEPARTMENT_ROLES });
  }
}
