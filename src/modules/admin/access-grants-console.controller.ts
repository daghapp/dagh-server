import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, created, fail } from "../../helpers/response.js";
import { logAdminActivity, AdminEntityType } from "../../helpers/admin-activity.js";
import { getEffectiveAccess } from "../../helpers/membership.js";
import type { MembershipTierCode } from "../../../generated/prisma/client.js";

/**
 * Admin console — complimentary access grants (comped membership).
 *
 * Lets an admin give a named user access to a paid tier without a payment.
 * The grant lives in its own table rather than overwriting user_subscriptions,
 * so a comp and a real subscription coexist instead of clobbering each other.
 *
 * Every mutation is soft: grants are revoked, never deleted, because the row is
 * the audit record explaining why someone had access.
 *
 * Mounted under /admin/access-grants.
 */
export class AdminAccessGrantsConsoleController {
  /**
   * GET /admin/access-grants — list grants, filterable by user, tier, and
   * whether the grant is currently in force.
   */
  async list(req: Request, res: Response) {
    try {
      const { userId, email, tierCode, status } = req.query as Record<string, string | undefined>;
      const now = new Date();

      const where: Record<string, unknown> = {};
      if (userId) where.userId = userId;
      if (email) {
        where.user = { email: { equals: email, mode: "insensitive" } };
      }
      if (tierCode) where.tierCode = tierCode as MembershipTierCode;

      if (status === "active") {
        where.revokedAt = null;
        where.startDate = { lte: now };
        where.OR = [{ endDate: null }, { endDate: { gt: now } }];
      } else if (status === "revoked") {
        where.revokedAt = { not: null };
      } else if (status === "expired") {
        where.revokedAt = null;
        where.endDate = { lte: now };
      }

      const grants = await prisma.subscriptionAccessGrant.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, email: true, fullName: true } },
          grantedBy: { select: { id: true, email: true, fullName: true } },
          revokedBy: { select: { id: true, email: true, fullName: true } },
        },
      });

      return ok(res, grants);
    } catch (error) {
      console.error("Failed to list access grants:", error);
      return fail(res, 500, "Failed to list access grants");
    }
  }

  /**
   * POST /admin/access-grants — comp a user into a tier.
   */
  async create(req: Request, res: Response) {
    try {
      const actor = req.user!;
      const {
        userId,
        email,
        tierCode,
        includePaidPerks,
        waiveServiceFees,
        reason,
        startDate,
        endDate,
      } = req.body as {
        userId?: string;
        email?: string;
        tierCode: MembershipTierCode;
        includePaidPerks?: boolean;
        waiveServiceFees?: boolean;
        reason: string;
        startDate?: Date;
        endDate?: Date | null;
      };

      // Admins normally know the person's email, not their internal id. Match
      // case-insensitively because historical rows were not normalised; if two
      // accounts collide on case, require the id rather than guessing.
      let user: { id: string; email: string; fullName: string } | null = null;
      if (userId) {
        user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, fullName: true },
        });
      } else if (email) {
        const matches = await prisma.user.findMany({
          where: { email: { equals: email, mode: "insensitive" } },
          select: { id: true, email: true, fullName: true },
          take: 2,
        });
        if (matches.length > 1) {
          return fail(res, 409, {
            code: "AMBIGUOUS_EMAIL",
            message: "Multiple accounts use that email. Provide userId instead.",
          });
        }
        user = matches[0] ?? null;
      }

      if (!user) {
        return fail(res, 404, {
          code: "USER_NOT_FOUND",
          message: email ? "No user found with that email" : "User not found",
        });
      }
      const resolvedUserId = user.id;

      // One live grant per user per tier keeps "who approved this" answerable;
      // a second grant for the same tier is almost always a mistake.
      const duplicate = await prisma.subscriptionAccessGrant.findFirst({
        where: {
          userId: resolvedUserId,
          tierCode,
          revokedAt: null,
          OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
        },
      });
      if (duplicate) {
        return fail(res, 409, {
          code: "ACCESS_GRANT_ALREADY_ACTIVE",
          message: `An active ${tierCode} grant already exists for this user`,
        });
      }

      const grant = await prisma.subscriptionAccessGrant.create({
        data: {
          userId: resolvedUserId,
          tierCode,
          includePaidPerks: includePaidPerks ?? false,
          waiveServiceFees: waiveServiceFees ?? false,
          reason,
          startDate: startDate ?? new Date(),
          endDate: endDate ?? null,
          grantedById: actor.id,
        },
      });

      await logAdminActivity({
        actorId: actor.id,
        entityType: AdminEntityType.SUBSCRIPTION_ACCESS_GRANT,
        entityId: grant.id,
        action: "GRANT_ACCESS",
        note: `Granted ${tierCode} to ${user.email}${includePaidPerks ? " (with paid perks)" : " (tier access only)"}${waiveServiceFees ? " — all service fees waived" : ""}`,
        metadata: {
          userId: resolvedUserId,
          email: user.email,
          tierCode,
          includePaidPerks: includePaidPerks ?? false,
          waiveServiceFees: waiveServiceFees ?? false,
          endDate: endDate ?? null,
          perpetual: !endDate,
          reason,
        },
      });

      return created(res, grant, "Access granted successfully");
    } catch (error) {
      console.error("Failed to create access grant:", error);
      return fail(res, 500, "Failed to create access grant");
    }
  }

  /**
   * PATCH /admin/access-grants/:id — amend a grant in place.
   * Moving endDate into the past is an early revoke that keeps the reason trail.
   */
  async update(req: Request, res: Response) {
    try {
      const actor = req.user!;
      const id = req.params.id as string;
      const body = req.body as {
        tierCode?: MembershipTierCode;
        includePaidPerks?: boolean;
        waiveServiceFees?: boolean;
        reason?: string;
        startDate?: Date;
        endDate?: Date | null;
      };

      const existing = await prisma.subscriptionAccessGrant.findUnique({ where: { id } });
      if (!existing) {
        return fail(res, 404, {
          code: "ACCESS_GRANT_NOT_FOUND",
          message: "Access grant not found",
        });
      }
      if (existing.revokedAt) {
        return fail(res, 409, {
          code: "ACCESS_GRANT_REVOKED",
          message: "A revoked grant cannot be modified",
        });
      }

      const startDate = body.startDate ?? existing.startDate;
      const endDate = body.endDate === undefined ? existing.endDate : body.endDate;
      if (endDate && endDate <= startDate) {
        return fail(res, 400, {
          code: "INVALID_DATE_RANGE",
          message: "endDate must be after startDate",
        });
      }

      const grant = await prisma.subscriptionAccessGrant.update({
        where: { id },
        data: {
          ...(body.tierCode !== undefined && { tierCode: body.tierCode }),
          ...(body.includePaidPerks !== undefined && { includePaidPerks: body.includePaidPerks }),
          ...(body.waiveServiceFees !== undefined && {
            waiveServiceFees: body.waiveServiceFees,
          }),
          ...(body.reason !== undefined && { reason: body.reason }),
          ...(body.startDate !== undefined && { startDate: body.startDate }),
          ...(body.endDate !== undefined && { endDate: body.endDate }),
        },
      });

      await logAdminActivity({
        actorId: actor.id,
        entityType: AdminEntityType.SUBSCRIPTION_ACCESS_GRANT,
        entityId: grant.id,
        action: "UPDATE_ACCESS",
        note:
          body.waiveServiceFees === undefined
            ? `Updated ${grant.tierCode} grant`
            : grant.waiveServiceFees
              ? `Updated ${grant.tierCode} grant — all service fees waived`
              : `Updated ${grant.tierCode} grant — service fee waiver removed`,
        metadata: {
          userId: grant.userId,
          tierCode: { from: existing.tierCode, to: grant.tierCode },
          includePaidPerks: {
            from: existing.includePaidPerks,
            to: grant.includePaidPerks,
          },
          waiveServiceFees: {
            from: existing.waiveServiceFees,
            to: grant.waiveServiceFees,
          },
          endDate: { from: existing.endDate, to: grant.endDate },
        },
      });

      return ok(res, grant, "Access grant updated successfully");
    } catch (error) {
      console.error("Failed to update access grant:", error);
      return fail(res, 500, "Failed to update access grant");
    }
  }

  /**
   * POST /admin/access-grants/:id/revoke — soft revoke.
   * The row survives so the decision remains explainable.
   */
  async revoke(req: Request, res: Response) {
    try {
      const actor = req.user!;
      const id = req.params.id as string;
      const body = (req.body ?? {}) as { reason?: string };

      const existing = await prisma.subscriptionAccessGrant.findUnique({
        where: { id },
        include: { user: { select: { email: true } } },
      });
      if (!existing) {
        return fail(res, 404, {
          code: "ACCESS_GRANT_NOT_FOUND",
          message: "Access grant not found",
        });
      }
      if (existing.revokedAt) {
        return fail(res, 409, {
          code: "ACCESS_GRANT_ALREADY_REVOKED",
          message: "This grant is already revoked",
        });
      }

      const grant = await prisma.subscriptionAccessGrant.update({
        where: { id },
        data: { revokedAt: new Date(), revokedById: actor.id },
      });

      await logAdminActivity({
        actorId: actor.id,
        entityType: AdminEntityType.SUBSCRIPTION_ACCESS_GRANT,
        entityId: grant.id,
        action: "REVOKE_ACCESS",
        note: `Revoked ${grant.tierCode} access for ${existing.user.email}${
          body.reason ? `: ${body.reason}` : ""
        }`,
        metadata: {
          userId: grant.userId,
          tierCode: grant.tierCode,
          revokedReason: body.reason ?? null,
        },
      });

      return ok(res, grant, "Access grant revoked successfully");
    } catch (error) {
      console.error("Failed to revoke access grant:", error);
      return fail(res, 500, "Failed to revoke access grant");
    }
  }

  /**
   * GET /admin/users/:userId/access — a user's effective access right now, plus
   * the grant history explaining it. Answers "why does this person have access?"
   * without having to infer it from tier codes.
   */
  async userAccess(req: Request, res: Response) {
    try {
      const userId = req.params.userId as string;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, fullName: true, accountType: true },
      });
      if (!user) {
        return fail(res, 404, { code: "USER_NOT_FOUND", message: "User not found" });
      }

      const [access, subscription, grants] = await Promise.all([
        getEffectiveAccess(userId),
        prisma.userSubscription.findUnique({
          where: { userId },
          include: { plan: { select: { id: true, code: true, name: true } } },
        }),
        prisma.subscriptionAccessGrant.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          include: {
            grantedBy: { select: { id: true, email: true, fullName: true } },
            revokedBy: { select: { id: true, email: true, fullName: true } },
          },
        }),
      ]);

      return ok(res, {
        user,
        effectiveAccess: access,
        subscription: subscription
          ? {
              id: subscription.id,
              tierCode: subscription.tierCode,
              status: subscription.status,
              endDate: subscription.endDate,
              plan: subscription.plan,
            }
          : null,
        grants,
      });
    } catch (error) {
      console.error("Failed to resolve user access:", error);
      return fail(res, 500, "Failed to resolve user access");
    }
  }
}
