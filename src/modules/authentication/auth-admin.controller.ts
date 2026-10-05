import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail, paginated } from "../../helpers/response.js";

const ensureAdmin = (req: Request, res: Response) => {
  const accountType = req.user?.accountType;

  if (!accountType || accountType.toUpperCase() !== "ADMIN") {
    return fail(res, 403, "Access denied");
  }

  return null;
};

export class AuthAdminController {
  // Get all users on app (paginated)
  async getAllUsers(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
      const skip = (page - 1) * limit;

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          select: {
            id: true,
            fullName: true,
            email: true,
            phoneNumber: true,
            accountType: true,
            accountStatus: true,
            authProvider: true,
            createdAt: true,
            lastLoginAt: true,
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.user.count(),
      ]);

      return paginated(res, users, total, page, limit);
    } catch (error) {
      return fail(
        res,
        500,
        "Failed to fetch users",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  // Promote user to admin
  async promoteToAdmin(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const userId = req.params.userId as string;

      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        return fail(res, 404, "User not found");
      }

      if (user.accountType === "ADMIN") {
        return fail(res, 400, "User is already an admin");
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { accountType: "ADMIN" },
        select: { id: true, fullName: true, email: true, accountType: true },
      });

      return ok(res, updated, "User promoted to admin");
    } catch (error) {
      console.error("Promote to admin error:", error);
      return fail(
        res,
        500,
        "Failed to promote user",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  // Delete user from app
  //
  // `admin_activity_logs.actorId` is ON DELETE RESTRICT, so the target's audit
  // rows are purged in the same transaction before the user row goes. Without
  // this, deleting any admin — or anyone who has ever performed an admin action
  // — aborts on P2003 and returns a 500 with the user still present. Every other
  // owned row cascades; this is the only restrict left on users, since
  // subscription_access_grants.grantedById now nulls out.
  async deleteUser(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const userId = req.params.userId as string;

      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        return fail(res, 404, "User not found");
      }

      await prisma.$transaction([
        prisma.adminActivityLog.deleteMany({ where: { actorId: userId } }),
        prisma.user.delete({ where: { id: userId } }),
      ]);

      return ok(res, null as never, "User deleted successfully");
    } catch (error) {
      // Log the detail, return none of it: the previous version passed
      // error.message straight to the client, which leaked the Prisma error code
      // and the failing table/column names.
      console.error("Delete user error:", error);
      return fail(res, 500, "Failed to delete user");
    }
  }

  // Demote admin to user
  async demoteToUser(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const userId = req.params.userId as string;

      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        return fail(res, 404, "User not found");
      }

      if (user.accountType === "USER") {
        return fail(res, 400, "User is already a regular user");
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { accountType: "USER" },
        select: { id: true, fullName: true, email: true, accountType: true },
      });

      return ok(res, updated, "Admin demoted to user");
    } catch (error) {
      console.error("Demote to user error:", error);
      return fail(
        res,
        500,
        "Failed to demote admin",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  // Suspend user from app
  async suspendUser(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const userId = req.params.userId as string;

      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        return fail(res, 404, "User not found");
      }

      if (user.accountStatus === "SUSPENDED") {
        return fail(res, 400, "User is already suspended");
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { accountStatus: "SUSPENDED" },
        select: { id: true, fullName: true, email: true, accountStatus: true },
      });

      return ok(res, updated, "User suspended successfully");
    } catch (error) {
      console.error("Suspend user error:", error);
      return fail(
        res,
        500,
        "Failed to suspend user",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  // Reactivate user on app
  async reactivateUser(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const userId = req.params.userId as string;
      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        return fail(res, 404, "User not found");
      }

      if (user.accountStatus === "ACTIVE") {
        return fail(res, 400, "User is already active");
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { accountStatus: "ACTIVE" },
        select: { id: true, fullName: true, email: true, accountStatus: true },
      });

      return ok(res, updated, "User reactivated successfully");
    } catch (error) {
      console.error("Reactivate user error:", error);
      return fail(
        res,
        500,
        "Failed to reactivate user",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  // Terminate user (replaces disable)
  async terminateUser(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const userId = req.params.userId as string;
      const { reason } = req.body as { reason?: string };

      if (!reason) {
        return fail(res, 400, "Reason is required");
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        return fail(res, 404, "User not found");
      }

      if (user.accountStatus === "TERMINATED") {
        return fail(res, 400, "User is already terminated");
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { accountStatus: "TERMINATED" },
        select: { id: true, fullName: true, email: true, accountStatus: true },
      });

      return ok(res, updated, "User terminated successfully");
    } catch (error) {
      console.error("Terminate user error:", error);
      return fail(
        res,
        500,
        "Failed to terminate user",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  async approveUser(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) return unauthorizedResponse;
      const userId = req.params.userId as string;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return fail(res, 404, "User not found");
      if (user.accountStatus !== "PENDING") return fail(res, 400, "User is not pending approval");
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { accountStatus: "ACTIVE" },
        select: { id: true, fullName: true, email: true, accountStatus: true },
      });
      return ok(res, updated, "User approved successfully");
    } catch (error) {
      console.error("Approve user error:", error);
      return fail(res, 500, "Failed to approve user", error instanceof Error ? error.message : "Unknown error");
    }
  }

  async rejectUser(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) return unauthorizedResponse;
      const userId = req.params.userId as string;
      const { reason } = req.body as { reason?: string };
      if (!reason) return fail(res, 400, "Reason is required");
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return fail(res, 404, "User not found");
      if (user.accountStatus !== "PENDING") return fail(res, 400, "User is not pending approval");
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { accountStatus: "SUSPENDED" },
        select: { id: true, fullName: true, email: true, accountStatus: true },
      });
      return ok(res, updated, "User rejected successfully");
    } catch (error) {
      console.error("Reject user error:", error);
      return fail(res, 500, "Failed to reject user", error instanceof Error ? error.message : "Unknown error");
    }
  }
}
