import { Request, Response } from "express";
import { prisma } from "../../config/index.js";

const ensureAdmin = (req: Request, res: Response) => {
  const accountType = req.user?.accountType;

  if (!accountType || accountType.toUpperCase() !== "ADMIN") {
    return res.status(403).json({ success: false, message: "Access denied" });
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

      return res.status(200).json({
        success: true,
        data: users,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch users",
        error: error instanceof Error ? error.message : "Unknown error",
      });
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
        return res.status(404).json({ success: false, message: "User not found" });
      }

      if (user.accountType === "ADMIN") {
        return res.status(400).json({ success: false, message: "User is already an admin" });
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { accountType: "ADMIN" },
        select: { id: true, fullName: true, email: true, accountType: true },
      });

      return res
        .status(200)
        .json({ success: true, message: "User promoted to admin", data: updated });
    } catch (error) {
      console.error("Promote to admin error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to promote user",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Delete user from app
  async deleteUser(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const userId = req.params.userId as string;

      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      await prisma.user.delete({ where: { id: userId } });

      return res.status(200).json({ success: true, message: "User deleted successfully" });
    } catch (error) {
      console.error("Delete user error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to delete user",
        error: error instanceof Error ? error.message : "Unknown error",
      });
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
        return res.status(404).json({ success: false, message: "User not found" });
      }

      if (user.accountType === "USER") {
        return res.status(400).json({ success: false, message: "User is already a regular user" });
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { accountType: "USER" },
        select: { id: true, fullName: true, email: true, accountType: true },
      });

      return res
        .status(200)
        .json({ success: true, message: "Admin demoted to user", data: updated });
    } catch (error) {
      console.error("Demote to user error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to demote admin",
        error: error instanceof Error ? error.message : "Unknown error",
      });
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
        return res.status(404).json({ success: false, message: "User not found" });
      }

      if (user.accountStatus === "SUSPENDED") {
        return res.status(400).json({ success: false, message: "User is already suspended" });
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { accountStatus: "SUSPENDED" },
        select: { id: true, fullName: true, email: true, accountStatus: true },
      });

      return res
        .status(200)
        .json({ success: true, message: "User suspended successfully", data: updated });
    } catch (error) {
      console.error("Suspend user error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to suspend user",
        error: error instanceof Error ? error.message : "Unknown error",
      });
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
        return res.status(404).json({ success: false, message: "User not found" });
      }

      if (user.accountStatus === "ACTIVE") {
        return res.status(400).json({ success: false, message: "User is already active" });
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { accountStatus: "ACTIVE" },
        select: { id: true, fullName: true, email: true, accountStatus: true },
      });

      return res
        .status(200)
        .json({ success: true, message: "User reactivated successfully", data: updated });
    } catch (error) {
      console.error("Reactivate user error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to reactivate user",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}
