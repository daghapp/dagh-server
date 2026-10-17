import { Request, Response } from "express";
import { prisma } from "../../config/prisma.js";
import { ok, fail, paginated } from "../../helpers/response.js";
import { logAdminActivity } from "../../helpers/admin-activity.js";
import { notifyAdmins } from "../../helpers/notify-admins.js";
import sendEmail from "../../config/resend.config.js";
import { roleBelongsToDepartment } from "../../config/admin-roles.js";
import { AdminDepartment, AdminRole, Prisma } from "../../../generated/prisma/client.js";

const ensureAdmin = (req: Request, res: Response) => {
  const accountType = req.user?.accountType;

  if (!accountType || accountType.toUpperCase() !== "ADMIN") {
    return fail(res, 403, "Access denied");
  }

  return null;
};

// ─────────────────────────────────────────
// Shared helpers (§3.7 user management)
// ─────────────────────────────────────────

const VALID_STATUSES = [
  "ACTIVE",
  "SUSPENDED",
  "TERMINATED",
  "PENDING",
  "PENDING_VERIFICATION",
  "DEACTIVATED",
] as const;

const VALID_TIER_CODES = [
  "FREE",
  "BASELINE",
  "SENIOR_PIONEER",
  "SANKOFA_SETTLED",
  "BASIC",
  "SILVER",
  "GOLD_INVESTOR",
  "ELITE_AMBASSADOR",
  "FAMILY_PLAN",
] as const;

const VALID_ADMIN_ROLES = ["SUPER_ADMIN", "OPERATIONS", "FINANCE", "SUPPORT"] as const;
const VALID_DEPARTMENTS = [
  "EXECUTIVE_MANAGEMENT",
  "OPERATIONS_AND_MEMBERSHIP",
  "FINANCE_AND_COMPLIANCE",
  "TECHNICAL_SUPPORT",
] as const;

const MAX_WARNINGS_PER_USER = 2;

/**
 * Status-based row actions. Kept status-based only (not filtered by caller
 * permissions) so the panel can explain why an action is unavailable; the
 * server still enforces requirePermission() on every mutating route.
 */
function allowedActionsFor(status: string): string[] {
  switch (status) {
    case "ACTIVE":
      return ["view", "suspend", "terminate", "delete"];
    case "PENDING":
    case "PENDING_VERIFICATION":
      return ["view", "approve", "reject", "delete"];
    case "SUSPENDED":
      return ["view", "reactivate", "terminate", "delete"];
    case "TERMINATED":
      return ["view", "delete"];
    default:
      return ["view", "delete"];
  }
}

/** Best-effort user email: a failed send must never fail the admin mutation. */
async function sendUserEmail(to: string | null | undefined, subject: string, html: string) {
  if (!to) return;
  try {
    await sendEmail({ email: to, subject, html });
  } catch (error) {
    console.error("[admin-users] user email failed:", error);
  }
}

function statusEmailHtml(name: string, title: string, body: string) {
  return `<p>Hi ${name},</p><p><strong>${title}</strong></p><p>${body}</p><p>— The Dagh team</p>`;
}

export class AuthAdminController {
  /**
   * GET /admin/users — paginated list with search/role/status/verification/plan
   * filters. Soft-deleted users are always excluded.
   */
  async getAllUsers(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
      const skip = (page - 1) * limit;

      const search = (req.query.search as string | undefined)?.trim();
      const role = (req.query.role as string | undefined)?.trim();
      const status = (req.query.status as string | undefined)?.trim();
      const verification = (req.query.verification as string | undefined)?.trim()?.toLowerCase();
      const plan = (req.query.plan as string | undefined)?.trim()?.toUpperCase();

      if (status && !VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
        return fail(res, 400, {
          code: "INVALID_STATUS",
          message: `Invalid status filter. Expected one of: ${VALID_STATUSES.join(", ")}`,
        });
      }
      if (verification && verification !== "verified" && verification !== "unverified") {
        return fail(res, 400, {
          code: "INVALID_VERIFICATION",
          message: "Invalid verification filter. Expected verified|unverified",
        });
      }
      if (plan && !VALID_TIER_CODES.includes(plan as (typeof VALID_TIER_CODES)[number])) {
        return fail(res, 400, {
          code: "INVALID_PLAN",
          message: `Invalid plan filter. Expected one of: ${VALID_TIER_CODES.join(", ")}`,
        });
      }

      // role=admin|user maps to accountType; a concrete admin role
      // (SUPER_ADMIN|OPERATIONS|FINANCE|SUPPORT) matches adminProfile.role.
      let roleClause: Prisma.UserWhereInput | null = null;
      if (role) {
        const upper = role.toUpperCase();
        if (upper === "ADMIN" || upper === "USER") {
          roleClause = { accountType: upper as "ADMIN" | "USER" };
        } else if (VALID_ADMIN_ROLES.includes(upper as (typeof VALID_ADMIN_ROLES)[number])) {
          roleClause = {
            accountType: "ADMIN",
            adminProfile: { role: upper as AdminRole },
          };
        } else {
          return fail(res, 400, {
            code: "INVALID_ROLE",
            message:
              "Invalid role filter. Expected admin|user|SUPER_ADMIN|OPERATIONS|FINANCE|SUPPORT",
          });
        }
      }

      const baseAnd: Prisma.UserWhereInput[] = [{ isDeleted: false }];
      if (search) {
        baseAnd.push({
          OR: [
            { fullName: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { phoneNumber: { contains: search, mode: "insensitive" } },
          ],
        });
      }
      if (roleClause) baseAnd.push(roleClause);
      if (verification === "verified") {
        baseAnd.push({ verification: { isVerified: true } });
      } else if (verification === "unverified") {
        baseAnd.push({ OR: [{ verification: { isVerified: false } }, { verification: null }] });
      }
      if (plan) {
        baseAnd.push({ subscription: { tierCode: plan as never } });
      }

      // Summary describes the filtered cohort with the status filter lifted,
      // so the panel can render per-status breakdown chips for the same query.
      const summaryWhere: Prisma.UserWhereInput = { AND: baseAnd };
      const where: Prisma.UserWhereInput = status
        ? { AND: [...baseAnd, { accountStatus: status as never }] }
        : summaryWhere;

      const [users, total, groups, verifiedCount] = await Promise.all([
        prisma.user.findMany({
          where,
          select: {
            id: true,
            fullName: true,
            email: true,
            phoneNumber: true,
            accountType: true,
            accountStatus: true,
            authProvider: true,
            statusReason: true,
            statusChangedAt: true,
            createdAt: true,
            lastLoginAt: true,
            lastActiveAt: true,
            verification: { select: { isVerified: true, verificationLevel: true } },
            subscription: { select: { tierCode: true, status: true, memberCode: true } },
            adminProfile: { select: { role: true, department: true } },
            _count: { select: { userWarnings: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.user.count({ where }),
        prisma.user.groupBy({ by: ["accountStatus"], where: summaryWhere, _count: true }),
        prisma.user.count({
          where: { AND: [...baseAnd, { verification: { isVerified: true } }] },
        }),
      ]);

      const countFor = (...statuses: string[]) =>
        groups
          .filter((g) => statuses.includes(g.accountStatus))
          .reduce((sum, g) => sum + g._count, 0);

      const summary = {
        total,
        verified: verifiedCount,
        active: countFor("ACTIVE"),
        suspended: countFor("SUSPENDED"),
        terminated: countFor("TERMINATED"),
        pending: countFor("PENDING", "PENDING_VERIFICATION"),
      };

      const rows = users.map((u) => ({
        ...u,
        isVerified: u.verification?.isVerified ?? false,
        planTier: u.subscription?.tierCode ?? null,
        warningsCount: u._count.userWarnings,
        allowedActions: allowedActionsFor(u.accountStatus),
      }));

      return paginated(res, rows, total, page, limit, undefined, { summary });
    } catch (error) {
      console.error("Get all users error:", error);
      return fail(
        res,
        500,
        "Failed to fetch users",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  /**
   * GET /admin/users/:userId — full detail: profile, verification,
   * subscription, warnings, latest 20 status-history rows, and adminProfile
   * (role/department) for admin accounts. Soft-deleted users read as 404.
   */
  async getUserDetail(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const userId = req.params.userId as string;
      const user = await prisma.user.findFirst({
        where: { id: userId, isDeleted: false },
        select: {
          id: true,
          fullName: true,
          firstName: true,
          lastName: true,
          username: true,
          email: true,
          phoneNumber: true,
          profileImageUrl: true,
          dateOfBirth: true,
          gender: true,
          accountType: true,
          accountStatus: true,
          authProvider: true,
          statusReason: true,
          statusChangedAt: true,
          statusChangedBy: true,
          createdAt: true,
          updatedAt: true,
          lastLoginAt: true,
          lastActiveAt: true,
          profile: true,
          verification: true,
          subscription: true,
          adminProfile: { select: { role: true, department: true, createdAt: true } },
          userWarnings: { orderBy: { issuedAt: "desc" } },
          statusHistory: { orderBy: { createdAt: "desc" }, take: 20 },
        },
      });

      if (!user) {
        return fail(res, 404, { code: "USER_NOT_FOUND", message: "User not found" });
      }

      return ok(
        res,
        { ...user, allowedActions: allowedActionsFor(user.accountStatus) },
        "User retrieved successfully",
      );
    } catch (error) {
      console.error("Get user detail error:", error);
      return fail(
        res,
        500,
        "Failed to fetch user",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  /** Shared post-mutation trail: status-history row + admin audit log. */
  private async recordTrail(input: {
    actorId: string;
    userId: string;
    from: string | null;
    to: string;
    reason?: string | null;
    action: string;
    note?: string;
    metadata?: Record<string, unknown>;
  }) {
    await prisma.userStatusHistory.create({
      data: {
        userId: input.userId,
        from: input.from,
        to: input.to,
        reason: input.reason ?? null,
        actorId: input.actorId,
      },
    });
    await logAdminActivity({
      actorId: input.actorId,
      entityType: "USER",
      entityId: input.userId,
      action: input.action,
      note: input.note,
      metadata: {
        previous: input.from,
        new: input.to,
        ...(input.metadata ?? {}),
      },
    });
  }

  private async fanOutUserAction(input: {
    actorId: string;
    userId: string;
    action: string;
    message: string;
  }) {
    await notifyAdmins({
      category: "users",
      message: input.message,
      actionUrl: `/admin/users/${input.userId}`,
      meta: { userId: input.userId, action: input.action },
      excludeAdminId: input.actorId,
    });
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

  // Soft-delete user (keeps the record for audit; list/detail exclude deleted).
  async deleteUser(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const userId = req.params.userId as string;
      const actorId = req.user!.id;

      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user || user.isDeleted) {
        return fail(res, 404, { code: "USER_NOT_FOUND", message: "User not found" });
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { isDeleted: true, deletedAt: new Date() },
        select: { id: true, fullName: true, email: true, accountStatus: true },
      });

      await this.recordTrail({
        actorId,
        userId,
        from: user.accountStatus,
        to: "DELETED",
        action: "SOFT_DELETE",
        note: `Soft-deleted user ${user.email}`,
      });
      await this.fanOutUserAction({
        actorId,
        userId,
        action: "SOFT_DELETE",
        message: `User ${user.email} was deleted by an administrator`,
      });
      await sendUserEmail(
        user.email,
        "Your Dagh account has been deleted",
        statusEmailHtml(
          user.fullName,
          "Your account has been deleted.",
          "If you believe this is a mistake, please contact support.",
        ),
      );

      return ok(res, updated, "User deleted successfully");
    } catch (error) {
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

  // Suspend user from app (ACTIVE → SUSPENDED, reason required)
  async suspendUser(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const userId = req.params.userId as string;
      const actorId = req.user!.id;
      const { reason } = req.body as { reason?: string };

      if (!reason?.trim()) {
        return fail(res, 400, { code: "REASON_REQUIRED", message: "Reason is required" });
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user || user.isDeleted) {
        return fail(res, 404, { code: "USER_NOT_FOUND", message: "User not found" });
      }

      if (user.accountStatus !== "ACTIVE") {
        return fail(res, 409, {
          code: "INVALID_STATUS_TRANSITION",
          message: "Only active users can be suspended",
          currentStatus: user.accountStatus,
        });
      }

      const now = new Date();
      const updated = await prisma.user.update({
        where: { id: userId },
        data: {
          accountStatus: "SUSPENDED",
          statusReason: reason.trim(),
          statusChangedAt: now,
          statusChangedBy: actorId,
        },
        select: { id: true, fullName: true, email: true, accountStatus: true },
      });

      await this.recordTrail({
        actorId,
        userId,
        from: "ACTIVE",
        to: "SUSPENDED",
        reason: reason.trim(),
        action: "SUSPEND",
        note: `Suspended user ${user.email}: ${reason.trim()}`,
      });
      await this.fanOutUserAction({
        actorId,
        userId,
        action: "SUSPEND",
        message: `User ${user.email} was suspended: ${reason.trim()}`,
      });
      await sendUserEmail(
        user.email,
        "Your Dagh account has been suspended",
        statusEmailHtml(
          user.fullName,
          "Your account has been suspended.",
          `Reason: ${reason.trim()}. Contact support if you believe this is a mistake.`,
        ),
      );

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

  // Reactivate user on app (SUSPENDED → ACTIVE)
  async reactivateUser(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const userId = req.params.userId as string;
      const actorId = req.user!.id;
      const { reason } = req.body as { reason?: string };

      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user || user.isDeleted) {
        return fail(res, 404, { code: "USER_NOT_FOUND", message: "User not found" });
      }

      if (user.accountStatus !== "SUSPENDED") {
        return fail(res, 409, {
          code: "INVALID_STATUS_TRANSITION",
          message: "Only suspended users can be reactivated",
          currentStatus: user.accountStatus,
        });
      }

      const now = new Date();
      const updated = await prisma.user.update({
        where: { id: userId },
        data: {
          accountStatus: "ACTIVE",
          statusReason: reason?.trim() || null,
          statusChangedAt: now,
          statusChangedBy: actorId,
        },
        select: { id: true, fullName: true, email: true, accountStatus: true },
      });

      await this.recordTrail({
        actorId,
        userId,
        from: "SUSPENDED",
        to: "ACTIVE",
        reason: reason?.trim() || null,
        action: "REACTIVATE",
        note: `Reactivated user ${user.email}`,
      });
      await this.fanOutUserAction({
        actorId,
        userId,
        action: "REACTIVATE",
        message: `User ${user.email} was reactivated`,
      });
      await sendUserEmail(
        user.email,
        "Your Dagh account has been reactivated",
        statusEmailHtml(
          user.fullName,
          "Good news — your account is active again.",
          "You can now sign in and use Dagh as normal.",
        ),
      );

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

  // Terminate user (ACTIVE|SUSPENDED → TERMINATED, reason required)
  async terminateUser(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const userId = req.params.userId as string;
      const actorId = req.user!.id;
      const { reason } = req.body as { reason?: string };

      if (!reason?.trim()) {
        return fail(res, 400, { code: "REASON_REQUIRED", message: "Reason is required" });
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user || user.isDeleted) {
        return fail(res, 404, { code: "USER_NOT_FOUND", message: "User not found" });
      }

      if (user.accountStatus !== "ACTIVE" && user.accountStatus !== "SUSPENDED") {
        return fail(res, 409, {
          code: "INVALID_STATUS_TRANSITION",
          message: "Only active or suspended users can be terminated",
          currentStatus: user.accountStatus,
        });
      }

      const now = new Date();
      const previous = user.accountStatus;
      const updated = await prisma.user.update({
        where: { id: userId },
        data: {
          accountStatus: "TERMINATED",
          statusReason: reason.trim(),
          statusChangedAt: now,
          statusChangedBy: actorId,
        },
        select: { id: true, fullName: true, email: true, accountStatus: true },
      });

      // Termination revokes push sessions but keeps the record for audit.
      await prisma.deviceToken.deleteMany({ where: { userId } });

      await this.recordTrail({
        actorId,
        userId,
        from: previous,
        to: "TERMINATED",
        reason: reason.trim(),
        action: "TERMINATE",
        note: `Terminated user ${user.email}: ${reason.trim()}`,
        metadata: { deviceTokensRevoked: true },
      });
      await this.fanOutUserAction({
        actorId,
        userId,
        action: "TERMINATE",
        message: `User ${user.email} was terminated: ${reason.trim()}`,
      });
      await sendUserEmail(
        user.email,
        "Your Dagh account has been terminated",
        statusEmailHtml(
          user.fullName,
          "Your account has been terminated.",
          `Reason: ${reason.trim()}. Contact support if you believe this is a mistake.`,
        ),
      );

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

  // Approve pending user (PENDING → ACTIVE; login already blocks non-ACTIVE)
  async approveUser(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) return unauthorizedResponse;
      const userId = req.params.userId as string;
      const actorId = req.user!.id;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.isDeleted) {
        return fail(res, 404, { code: "USER_NOT_FOUND", message: "User not found" });
      }
      if (user.accountStatus !== "PENDING") {
        return fail(res, 409, {
          code: "INVALID_STATUS_TRANSITION",
          message: "Only pending users can be approved",
          currentStatus: user.accountStatus,
        });
      }
      const now = new Date();
      const updated = await prisma.user.update({
        where: { id: userId },
        data: {
          accountStatus: "ACTIVE",
          statusReason: null,
          statusChangedAt: now,
          statusChangedBy: actorId,
        },
        select: { id: true, fullName: true, email: true, accountStatus: true },
      });

      await this.recordTrail({
        actorId,
        userId,
        from: "PENDING",
        to: "ACTIVE",
        action: "APPROVE",
        note: `Approved user ${user.email}`,
      });
      await this.fanOutUserAction({
        actorId,
        userId,
        action: "APPROVE",
        message: `User ${user.email} was approved`,
      });
      await sendUserEmail(
        user.email,
        "Your Dagh account has been approved",
        statusEmailHtml(
          user.fullName,
          "Welcome — your account is now active.",
          "You can now sign in and use Dagh.",
        ),
      );

      return ok(res, updated, "User approved successfully");
    } catch (error) {
      console.error("Approve user error:", error);
      return fail(
        res,
        500,
        "Failed to approve user",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  // Reject pending user (PENDING → TERMINATED, reason required)
  async rejectUser(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) return unauthorizedResponse;
      const userId = req.params.userId as string;
      const actorId = req.user!.id;
      const { reason } = req.body as { reason?: string };
      if (!reason?.trim()) {
        return fail(res, 400, { code: "REASON_REQUIRED", message: "Reason is required" });
      }
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.isDeleted) {
        return fail(res, 404, { code: "USER_NOT_FOUND", message: "User not found" });
      }
      if (user.accountStatus !== "PENDING") {
        return fail(res, 409, {
          code: "INVALID_STATUS_TRANSITION",
          message: "Only pending users can be rejected",
          currentStatus: user.accountStatus,
        });
      }
      const now = new Date();
      const updated = await prisma.user.update({
        where: { id: userId },
        data: {
          accountStatus: "TERMINATED",
          statusReason: reason.trim(),
          statusChangedAt: now,
          statusChangedBy: actorId,
        },
        select: { id: true, fullName: true, email: true, accountStatus: true },
      });

      await this.recordTrail({
        actorId,
        userId,
        from: "PENDING",
        to: "TERMINATED",
        reason: reason.trim(),
        action: "REJECT",
        note: `Rejected user ${user.email}: ${reason.trim()}`,
      });
      await this.fanOutUserAction({
        actorId,
        userId,
        action: "REJECT",
        message: `Pending user ${user.email} was rejected: ${reason.trim()}`,
      });
      await sendUserEmail(
        user.email,
        "Your Dagh account application was not approved",
        statusEmailHtml(
          user.fullName,
          "Your application was not approved.",
          `Reason: ${reason.trim()}. Contact support if you have questions.`,
        ),
      );

      return ok(res, updated, "User rejected successfully");
    } catch (error) {
      console.error("Reject user error:", error);
      return fail(
        res,
        500,
        "Failed to reject user",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  /**
   * PATCH /admin/users/:userId/role — assign an admin role + department.
   * Non-admin accounts are promoted to ADMIN; the adminProfile is upserted.
   */
  async updateUserRole(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) return unauthorizedResponse;

      const userId = req.params.userId as string;
      const actorId = req.user!.id;
      const { role, department } = req.body as { role?: string; department?: string };

      if (!role || !department) {
        return fail(res, 400, {
          code: "ROLE_REQUIRED",
          message: "Both role and department are required",
        });
      }
      if (!VALID_ADMIN_ROLES.includes(role as (typeof VALID_ADMIN_ROLES)[number])) {
        return fail(res, 400, {
          code: "INVALID_ROLE",
          message: `Invalid role. Expected one of: ${VALID_ADMIN_ROLES.join(", ")}`,
        });
      }
      if (!VALID_DEPARTMENTS.includes(department as (typeof VALID_DEPARTMENTS)[number])) {
        return fail(res, 400, {
          code: "INVALID_DEPARTMENT",
          message: `Invalid department. Expected one of: ${VALID_DEPARTMENTS.join(", ")}`,
        });
      }
      if (!roleBelongsToDepartment(role as AdminRole, department as AdminDepartment)) {
        return fail(res, 400, {
          code: "ROLE_DEPARTMENT_MISMATCH",
          message: `Role ${role} does not belong to department ${department}`,
        });
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.isDeleted) {
        return fail(res, 404, { code: "USER_NOT_FOUND", message: "User not found" });
      }

      const previousType = user.accountType;
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { accountType: "ADMIN" },
        select: { id: true, fullName: true, email: true, accountType: true, accountStatus: true },
      });
      const adminProfile = await prisma.adminProfile.upsert({
        where: { userId },
        create: { userId, role: role as AdminRole, department: department as AdminDepartment },
        update: { role: role as AdminRole, department: department as AdminDepartment },
      });

      await this.recordTrail({
        actorId,
        userId,
        from: user.accountStatus,
        to: user.accountStatus,
        reason: `Role set to ${role} (${department})`,
        action: "UPDATE_ROLE",
        note: `Set ${user.email} role to ${role} in ${department}`,
        metadata: { previousAccountType: previousType, newAccountType: "ADMIN", role, department },
      });
      await this.fanOutUserAction({
        actorId,
        userId,
        action: "UPDATE_ROLE",
        message: `User ${user.email} was assigned the ${role} role`,
      });
      await sendUserEmail(
        user.email,
        "Your Dagh administrator role was updated",
        statusEmailHtml(
          user.fullName,
          `You have been assigned the ${role} role.`,
          `Department: ${department}. Sign in to the admin console to continue.`,
        ),
      );

      return ok(res, { ...updated, adminProfile }, "User role updated successfully");
    } catch (error) {
      console.error("Update user role error:", error);
      return fail(
        res,
        500,
        "Failed to update user role",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  /**
   * POST /admin/users/:userId/warnings — issue a warning (max 2 per user).
   */
  async createWarning(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) return unauthorizedResponse;

      const userId = req.params.userId as string;
      const actorId = req.user!.id;
      const { reason, note } = req.body as { reason?: string; note?: string };

      if (!reason?.trim()) {
        return fail(res, 400, { code: "REASON_REQUIRED", message: "Reason is required" });
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.isDeleted) {
        return fail(res, 404, { code: "USER_NOT_FOUND", message: "User not found" });
      }

      const existingCount = await prisma.userWarning.count({ where: { userId } });
      if (existingCount >= MAX_WARNINGS_PER_USER) {
        return fail(res, 409, {
          code: "WARNING_LIMIT",
          message: `User already has the maximum of ${MAX_WARNINGS_PER_USER} warnings`,
          count: existingCount,
        });
      }

      const warning = await prisma.userWarning.create({
        data: {
          userId,
          reason: reason.trim(),
          issuedBy: actorId,
          note: note?.trim() || null,
        },
      });

      await this.recordTrail({
        actorId,
        userId,
        from: user.accountStatus,
        to: user.accountStatus,
        reason: reason.trim(),
        action: "WARN",
        note: `Warned user ${user.email}: ${reason.trim()}`,
        metadata: { warningId: warning.id, warningCount: existingCount + 1 },
      });
      await this.fanOutUserAction({
        actorId,
        userId,
        action: "WARN",
        message: `User ${user.email} was warned: ${reason.trim()}`,
      });
      await sendUserEmail(
        user.email,
        "A warning has been issued on your Dagh account",
        statusEmailHtml(
          user.fullName,
          "A warning has been issued on your account.",
          `Reason: ${reason.trim()}${note?.trim() ? `<br/>Note: ${note.trim()}` : ""}<br/>Further violations may lead to suspension or termination.`,
        ),
      );

      return ok(res, warning, "Warning issued successfully");
    } catch (error) {
      console.error("Create warning error:", error);
      return fail(
        res,
        500,
        "Failed to issue warning",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  /** GET /admin/users/:userId/warnings — warning history (newest first). */
  async listWarnings(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) return unauthorizedResponse;

      const userId = req.params.userId as string;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, isDeleted: true },
      });
      if (!user || user.isDeleted) {
        return fail(res, 404, { code: "USER_NOT_FOUND", message: "User not found" });
      }

      const warnings = await prisma.userWarning.findMany({
        where: { userId },
        orderBy: { issuedAt: "desc" },
      });

      return ok(res, warnings, "Warnings retrieved successfully");
    } catch (error) {
      console.error("List warnings error:", error);
      return fail(
        res,
        500,
        "Failed to fetch warnings",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  /**
   * GET /admin/reports/export — CSV dump of the UserReport moderation queue,
   * honoring the same status filter as the list endpoint.
   */
  async exportReports(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const status = req.query.status as string | undefined;
      const where = status && status !== "ALL" ? { status: status as never } : {};

      const reports = await prisma.userReport.findMany({
        where,
        include: {
          reporter: { select: { id: true, fullName: true, email: true } },
          target: { select: { id: true, fullName: true, email: true, accountStatus: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 5000,
      });

      const escape = (value: unknown): string => {
        if (value === null || value === undefined) return "";
        const text = value instanceof Date ? value.toISOString() : String(value);
        return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };

      const header = [
        "id",
        "reporterId",
        "reporterName",
        "reporterEmail",
        "targetId",
        "targetName",
        "targetEmail",
        "targetStatus",
        "reason",
        "details",
        "status",
        "resolutionNote",
        "createdAt",
        "resolvedAt",
      ];
      const lines = reports.map((r) =>
        [
          r.id,
          r.reporterId,
          r.reporter?.fullName,
          r.reporter?.email,
          r.targetId,
          r.target?.fullName,
          r.target?.email,
          r.target?.accountStatus,
          r.reason,
          r.details,
          r.status,
          r.resolutionNote,
          r.createdAt,
          r.resolvedAt,
        ]
          .map(escape)
          .join(","),
      );
      const csv = [header.join(","), ...lines].join("\r\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="user-reports.csv"');
      return res.send(csv);
    } catch (error) {
      console.error("Export reports error:", error);
      return fail(
        res,
        500,
        "Failed to export reports",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  /** GET /admin/reports/summary — report counts by status. */
  async reportsSummary(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const [total, groups] = await Promise.all([
        prisma.userReport.count(),
        prisma.userReport.groupBy({ by: ["status"], _count: true }),
      ]);

      const byStatus: Record<string, number> = {
        PENDING: 0,
        REVIEWING: 0,
        RESOLVED: 0,
        DISMISSED: 0,
      };
      for (const g of groups) {
        byStatus[g.status] = g._count;
      }

      return ok(res, { total, byStatus }, "Report summary retrieved successfully");
    } catch (error) {
      console.error("Report summary error:", error);
      return fail(
        res,
        500,
        "Failed to fetch report summary",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }
}
