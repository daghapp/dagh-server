import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail, paginated } from "../../helpers/response.js";
import { logAdminActivity, AdminEntityType } from "../../helpers/admin-activity.js";
import { notifyAdmins } from "../../helpers/notify-admins.js";
// Reuses the user-side cancel path so admin cancels obey the same
// cancellable-state guard (ACTIVE / PAYMENT_PENDING only) instead of
// duplicating the transition rules here.
import { cancelSubscription as cancelUserSubscription } from "../../services/membership.service.js";
import { SubscriptionStatus, MembershipTierCode } from "../../../generated/prisma/client.js";

/**
 * Admin console — subscriptions + NGO access (§3.9 handoff).
 *
 * Mounted under /admin (see src/routes/admin-subscriptions.routes.ts).
 *
 * Field notes (verified against prisma/schema.prisma before writing):
 * - UserSubscription carries `endDate` (there is no `expiresAt` column), so
 *   the extend flow pushes `endDate` forward.
 * - MembershipPlan has a required `price` field, so MRR is the sum of active
 *   plans' prices.
 * - NgoMembership.status / NgoAccessRequest.status are plain String columns
 *   (not enums); the ACTIVE / REVOKED / PENDING / APPROVED literals below are
 *   the convention used by the NGO module.
 * - Team-member search has no dedicated endpoint: clients reuse
 *   GET /admin/users?search= to resolve a userId/ngoId before calling
 *   POST /ngo/lifetime-access.
 */
export class AdminSubscriptionsController {
  /**
   * GET /admin/subscriptions?status=&plan=&search=&page=&limit=
   * Paginated UserSubscription rows with user + plan, plus meta stats
   * { byStatus, activeCount, mrr }.
   */
  async listSubscriptions(req: Request, res: Response) {
    try {
      const { status, plan, search } = req.query as Record<string, string | undefined>;
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
      const skip = (page - 1) * limit;

      const where: Record<string, unknown> = {};
      if (status) {
        const upper = status.toUpperCase();
        if (!(Object.values(SubscriptionStatus) as string[]).includes(upper)) {
          return fail(res, 400, {
            code: "INVALID_STATUS",
            message: `Unknown subscription status: ${status}`,
          });
        }
        where.status = upper;
      }
      if (plan) {
        // `plan` accepts either a tier code (FREE, SILVER, …) or a plan id.
        const upperPlan = plan.toUpperCase();
        if ((Object.values(MembershipTierCode) as string[]).includes(upperPlan)) {
          where.tierCode = upperPlan;
        } else {
          where.planId = plan;
        }
      }
      if (search) {
        where.OR = [
          { memberCode: { contains: search, mode: "insensitive" } },
          { user: { fullName: { contains: search, mode: "insensitive" } } },
          { user: { email: { contains: search, mode: "insensitive" } } },
        ];
      }

      const [rows, total, statusGroups, activePlans] = await Promise.all([
        prisma.userSubscription.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: {
            user: { select: { id: true, fullName: true, email: true } },
            plan: true,
          },
        }),
        prisma.userSubscription.count({ where }),
        prisma.userSubscription.groupBy({
          by: ["status"],
          _count: { _all: true },
        }),
        prisma.userSubscription.findMany({
          where: { status: SubscriptionStatus.ACTIVE },
          select: { plan: { select: { price: true } } },
        }),
      ]);

      const byStatus = Object.fromEntries(statusGroups.map((g) => [g.status, g._count._all]));
      const activeCount = byStatus[SubscriptionStatus.ACTIVE] ?? 0;
      const mrr = activePlans.reduce((sum, s) => sum + (s.plan?.price ?? 0), 0);

      return paginated(res, rows, total, page, limit, undefined, {
        byStatus,
        activeCount,
        mrr,
      });
    } catch (error) {
      console.error("Failed to list subscriptions:", error);
      return fail(res, 500, "Failed to list subscriptions");
    }
  }

  /**
   * PATCH /admin/subscriptions/:id/cancel {reason?}
   * Cancels via the shared user-side cancel logic (same state guard).
   */
  async cancelSubscription(req: Request, res: Response) {
    try {
      const actor = req.user!;
      const id = req.params.id as string;
      const { reason } = (req.body ?? {}) as { reason?: string };

      const existing = await prisma.userSubscription.findUnique({
        where: { id },
        include: {
          user: { select: { id: true, email: true, fullName: true } },
          plan: { select: { id: true, code: true, name: true } },
        },
      });
      if (!existing) {
        return fail(res, 404, {
          code: "SUBSCRIPTION_NOT_FOUND",
          message: "Subscription not found",
        });
      }

      const result = await cancelUserSubscription(existing.userId);
      if (!result.success) {
        const httpStatus = result.code === "NO_SUBSCRIPTION" ? 404 : 409;
        return fail(res, httpStatus, {
          code: result.code,
          message: result.message,
        });
      }

      const updated = await prisma.userSubscription.findUnique({
        where: { id },
        include: {
          user: { select: { id: true, email: true, fullName: true } },
          plan: { select: { id: true, code: true, name: true } },
        },
      });

      // Handoff §3.9 mandates the SUBSCRIPTION_ACCESS_GRANT audit bucket for
      // these subscription/NGO writes.
      await logAdminActivity({
        actorId: actor.id,
        entityType: AdminEntityType.SUBSCRIPTION_ACCESS_GRANT,
        entityId: id,
        action: "CANCEL_SUBSCRIPTION",
        note: `Cancelled subscription for ${existing.user.email}${reason ? `: ${reason}` : ""}`,
        metadata: {
          userId: existing.userId,
          planCode: existing.plan?.code ?? existing.tierCode,
          reason: reason ?? null,
        },
      });

      await notifyAdmins({
        category: "subscriptions",
        message: `Subscription cancelled for ${existing.user.email}${reason ? ` — ${reason}` : ""}`,
        actionUrl: `/admin/subscriptions/${id}`,
        meta: { subscriptionId: id, userId: existing.userId },
        excludeAdminId: actor.id,
      });

      return ok(res, updated, "Subscription cancelled successfully");
    } catch (error) {
      console.error("Failed to cancel subscription:", error);
      return fail(res, 500, "Failed to cancel subscription");
    }
  }

  /**
   * PATCH /admin/subscriptions/:id/extend {days}
   * Pushes `endDate` forward by `days` (1–365). Anchors on the current
   * endDate when it lies in the future, otherwise on now, so extending an
   * already-lapsed subscription grants a full `days` from today.
   */
  async extendSubscription(req: Request, res: Response) {
    try {
      const actor = req.user!;
      const id = req.params.id as string;
      const rawDays = (req.body ?? {}).days as unknown;
      const days = typeof rawDays === "string" ? parseInt(rawDays, 10) : (rawDays as number);

      if (!Number.isInteger(days) || days < 1 || days > 365) {
        return fail(res, 400, {
          code: "INVALID_DAYS",
          message: "days is required and must be an integer between 1 and 365",
        });
      }

      const existing = await prisma.userSubscription.findUnique({
        where: { id },
        include: { user: { select: { email: true } } },
      });
      if (!existing) {
        return fail(res, 404, {
          code: "SUBSCRIPTION_NOT_FOUND",
          message: "Subscription not found",
        });
      }

      const now = new Date();
      const base =
        existing.endDate && existing.endDate.getTime() > now.getTime() ? existing.endDate : now;
      const endDate = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

      const updated = await prisma.userSubscription.update({
        where: { id },
        data: { endDate },
        include: {
          user: { select: { id: true, email: true, fullName: true } },
          plan: { select: { id: true, code: true, name: true } },
        },
      });

      await logAdminActivity({
        actorId: actor.id,
        entityType: AdminEntityType.SUBSCRIPTION_ACCESS_GRANT,
        entityId: id,
        action: "EXTEND_SUBSCRIPTION",
        note: `Extended subscription for ${existing.user.email} by ${days} day(s)`,
        metadata: {
          userId: existing.userId,
          days,
          endDate: {
            from: existing.endDate?.toISOString() ?? null,
            to: endDate.toISOString(),
          },
        },
      });

      await notifyAdmins({
        category: "subscriptions",
        message: `Subscription for ${existing.user.email} extended by ${days} day(s)`,
        actionUrl: `/admin/subscriptions/${id}`,
        meta: { subscriptionId: id, userId: existing.userId, days },
        excludeAdminId: actor.id,
      });

      return ok(res, updated, "Subscription extended successfully");
    } catch (error) {
      console.error("Failed to extend subscription:", error);
      return fail(res, 500, "Failed to extend subscription");
    }
  }

  /**
   * GET /admin/ngo/members?status=&search=&page=&limit=
   * Paginated NgoMembership rows with user{fullName,email} + ngo +
   * verification (user.verification.isVerified) + datingAccess.
   *
   * Special case: status=pending returns the PENDING NgoAccessRequest queue
   * (user+ngo) instead of members, since pending applicants have no
   * membership row yet.
   */
  async listNgoMembers(req: Request, res: Response) {
    try {
      const { status, search } = req.query as Record<string, string | undefined>;
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
      const skip = (page - 1) * limit;

      if (status?.toLowerCase() === "pending") {
        const where: Record<string, unknown> = { status: "PENDING" };
        if (search) {
          where.OR = [
            { user: { fullName: { contains: search, mode: "insensitive" } } },
            { user: { email: { contains: search, mode: "insensitive" } } },
            { ngo: { name: { contains: search, mode: "insensitive" } } },
          ];
        }
        const [requests, total] = await Promise.all([
          prisma.ngoAccessRequest.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: "desc" },
            include: {
              user: {
                select: {
                  id: true,
                  fullName: true,
                  email: true,
                  verification: { select: { isVerified: true } },
                },
              },
              ngo: true,
            },
          }),
          prisma.ngoAccessRequest.count({ where }),
        ]);
        return paginated(res, requests, total, page, limit, "Pending NGO access requests");
      }

      const where: Record<string, unknown> = {};
      if (status) where.status = status.toUpperCase();
      if (search) {
        where.OR = [
          { membershipId: { contains: search, mode: "insensitive" } },
          { user: { fullName: { contains: search, mode: "insensitive" } } },
          { user: { email: { contains: search, mode: "insensitive" } } },
          { ngo: { name: { contains: search, mode: "insensitive" } } },
        ];
      }

      const [members, total] = await Promise.all([
        prisma.ngoMembership.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                verification: { select: { isVerified: true } },
              },
            },
            ngo: true,
          },
        }),
        prisma.ngoMembership.count({ where }),
      ]);

      return paginated(res, members, total, page, limit);
    } catch (error) {
      console.error("Failed to list NGO members:", error);
      return fail(res, 500, "Failed to list NGO members");
    }
  }

  /**
   * PATCH /admin/ngo/members/:id/grant-access
   * Sets the membership ACTIVE; approves the matching PENDING
   * NgoAccessRequest for the same ngo+user when one exists.
   */
  async grantNgoAccess(req: Request, res: Response) {
    try {
      const actor = req.user!;
      const id = req.params.id as string;

      const membership = await prisma.ngoMembership.findUnique({
        where: { id },
        include: {
          user: { select: { id: true, email: true, fullName: true } },
          ngo: { select: { id: true, name: true } },
        },
      });
      if (!membership) {
        return fail(res, 404, {
          code: "NGO_MEMBERSHIP_NOT_FOUND",
          message: "NGO membership not found",
        });
      }

      const updated = await prisma.ngoMembership.update({
        where: { id },
        data: { status: "ACTIVE" },
      });

      const pendingRequest = await prisma.ngoAccessRequest.findFirst({
        where: {
          ngoId: membership.ngoId,
          userId: membership.userId,
          status: "PENDING",
        },
        orderBy: { createdAt: "asc" },
      });
      let approvedRequest = null;
      if (pendingRequest) {
        approvedRequest = await prisma.ngoAccessRequest.update({
          where: { id: pendingRequest.id },
          data: { status: "APPROVED", actionBy: actor.id, actionAt: new Date() },
        });
      }

      await logAdminActivity({
        actorId: actor.id,
        entityType: AdminEntityType.SUBSCRIPTION_ACCESS_GRANT,
        entityId: id,
        action: "GRANT_NGO_ACCESS",
        note: `Granted NGO access for ${membership.user.email} (${membership.ngo.name})`,
        metadata: {
          userId: membership.userId,
          ngoId: membership.ngoId,
          approvedRequestId: approvedRequest?.id ?? null,
        },
      });

      await notifyAdmins({
        category: "ngo",
        message: `NGO access granted for ${membership.user.email} (${membership.ngo.name})`,
        actionUrl: `/admin/ngo/members/${id}`,
        meta: { membershipId: id, userId: membership.userId, ngoId: membership.ngoId },
        excludeAdminId: actor.id,
      });

      return ok(res, { membership: updated, approvedRequest }, "NGO access granted");
    } catch (error) {
      console.error("Failed to grant NGO access:", error);
      return fail(res, 500, "Failed to grant NGO access");
    }
  }

  /**
   * PATCH /admin/ngo/members/:id/revoke-access {reason?}
   * Sets the membership REVOKED. The row is kept for audit.
   */
  async revokeNgoAccess(req: Request, res: Response) {
    try {
      const actor = req.user!;
      const id = req.params.id as string;
      const { reason } = (req.body ?? {}) as { reason?: string };

      const membership = await prisma.ngoMembership.findUnique({
        where: { id },
        include: {
          user: { select: { email: true } },
          ngo: { select: { name: true } },
        },
      });
      if (!membership) {
        return fail(res, 404, {
          code: "NGO_MEMBERSHIP_NOT_FOUND",
          message: "NGO membership not found",
        });
      }

      const updated = await prisma.ngoMembership.update({
        where: { id },
        data: { status: "REVOKED" },
      });

      await logAdminActivity({
        actorId: actor.id,
        entityType: AdminEntityType.SUBSCRIPTION_ACCESS_GRANT,
        entityId: id,
        action: "REVOKE_NGO_ACCESS",
        note: `Revoked NGO access for ${membership.user.email} (${membership.ngo.name})${reason ? `: ${reason}` : ""}`,
        metadata: {
          userId: membership.userId,
          ngoId: membership.ngoId,
          reason: reason ?? null,
        },
      });

      await notifyAdmins({
        category: "ngo",
        message: `NGO access revoked for ${membership.user.email} (${membership.ngo.name})${reason ? ` — ${reason}` : ""}`,
        actionUrl: `/admin/ngo/members/${id}`,
        meta: { membershipId: id, userId: membership.userId, ngoId: membership.ngoId },
        excludeAdminId: actor.id,
      });

      return ok(res, updated, "NGO access revoked");
    } catch (error) {
      console.error("Failed to revoke NGO access:", error);
      return fail(res, 500, "Failed to revoke NGO access");
    }
  }

  /**
   * POST /admin/ngo/lifetime-access {userId, ngoId, services[]?, note?}
   * Find-or-create an ACTIVE NgoMembership. datingAccess is true when
   * `services` includes "DATING". membershipId follows GDN-YYYY-####,
   * sequenced from the year's existing count and retried with a random
   * suffix on unique conflict.
   */
  async grantLifetimeAccess(req: Request, res: Response) {
    try {
      const actor = req.user!;
      const { userId, ngoId, services, note } = (req.body ?? {}) as {
        userId?: string;
        ngoId?: string;
        services?: unknown;
        note?: string;
      };

      if (!userId || !ngoId) {
        return fail(res, 400, {
          code: "MISSING_FIELDS",
          message: "userId and ngoId are required",
        });
      }

      const [user, ngo] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, fullName: true },
        }),
        prisma.ngo.findUnique({ where: { id: ngoId } }),
      ]);
      if (!user) {
        return fail(res, 404, { code: "USER_NOT_FOUND", message: "User not found" });
      }
      if (!ngo) {
        return fail(res, 404, { code: "NGO_NOT_FOUND", message: "NGO not found" });
      }

      const datingAccess =
        Array.isArray(services) && services.some((s) => String(s).toUpperCase() === "DATING");

      // Find-or-create: reactivate the latest existing link instead of
      // stacking duplicate rows for the same ngo+user.
      const existingLink = await prisma.ngoMembership.findFirst({
        where: { ngoId, userId },
        orderBy: { createdAt: "desc" },
      });
      if (existingLink) {
        const reactivated = await prisma.ngoMembership.update({
          where: { id: existingLink.id },
          data: {
            status: "ACTIVE",
            datingAccess: existingLink.datingAccess || datingAccess,
            ...(note !== undefined ? { eligibility: note } : {}),
          },
        });

        await logAdminActivity({
          actorId: actor.id,
          entityType: AdminEntityType.SUBSCRIPTION_ACCESS_GRANT,
          entityId: reactivated.id,
          action: "GRANT_NGO_LIFETIME_ACCESS",
          note: `Lifetime NGO access reactivated for ${user.email} (${ngo.name})${note ? `: ${note}` : ""}`,
          metadata: { userId, ngoId, datingAccess, reused: true },
        });

        await notifyAdmins({
          category: "ngo",
          message: `Lifetime NGO access reactivated for ${user.email} (${ngo.name})`,
          actionUrl: `/admin/ngo/members/${reactivated.id}`,
          meta: { membershipId: reactivated.id, userId, ngoId },
          excludeAdminId: actor.id,
        });

        return ok(res, reactivated, "Lifetime NGO access reactivated");
      }

      const year = new Date().getFullYear();
      const prefix = `GDN-${year}-`;
      const count = await prisma.ngoMembership.count({
        where: { membershipId: { startsWith: prefix } },
      });
      let membershipId = `${prefix}${String(count + 1).padStart(4, "0")}`;

      let created = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          created = await prisma.ngoMembership.create({
            data: {
              ngoId,
              userId,
              membershipId,
              status: "ACTIVE",
              datingAccess,
              eligibility: note ?? null,
            },
          });
          break;
        } catch (error: unknown) {
          const code = (error as { code?: string } | null)?.code;
          if (code !== "P2002" || attempt === 4) throw error;
          const suffix = Array.from({ length: 4 }, () =>
            "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".charAt(Math.floor(Math.random() * 32)),
          ).join("");
          membershipId = `${prefix}${String(count + 1).padStart(4, "0")}-${suffix}`;
        }
      }

      await logAdminActivity({
        actorId: actor.id,
        entityType: AdminEntityType.SUBSCRIPTION_ACCESS_GRANT,
        entityId: created!.id,
        action: "GRANT_NGO_LIFETIME_ACCESS",
        note: `Lifetime NGO access granted for ${user.email} (${ngo.name})${note ? `: ${note}` : ""}`,
        metadata: { userId, ngoId, datingAccess, membershipId: created!.membershipId },
      });

      await notifyAdmins({
        category: "ngo",
        message: `Lifetime NGO access granted for ${user.email} (${ngo.name})`,
        actionUrl: `/admin/ngo/members/${created!.id}`,
        meta: { membershipId: created!.id, userId, ngoId },
        excludeAdminId: actor.id,
      });

      return ok(res, created, "Lifetime NGO access granted");
    } catch (error) {
      console.error("Failed to grant lifetime NGO access:", error);
      return fail(res, 500, "Failed to grant lifetime NGO access");
    }
  }
}
