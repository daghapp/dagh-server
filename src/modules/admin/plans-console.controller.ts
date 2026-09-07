import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { MembershipTierCode, BillingInterval } from "../../../generated/prisma/client.js";
import { ok, created, fail } from "../../helpers/response.js";
import { logAdminActivity, AdminEntityType } from "../../helpers/admin-activity.js";

const PLAN_CODES = Object.values(MembershipTierCode) as readonly string[];
const INTERVALS = Object.values(BillingInterval) as readonly string[];

/**
 * Admin console — Membership plan management.
 * CRUD + toggle for membership plan definitions (mounted under /admin/plans).
 */
export class AdminPlansConsoleController {
  /**
   * GET /admin/plans — list all membership plans (optionally filter by active).
   */
  async list(req: Request, res: Response) {
    try {
      const active =
        req.query.active === undefined
          ? undefined
          : req.query.active === "true" || req.query.active === "1";

      const plans = await prisma.membershipPlan.findMany({
        where: active === undefined ? undefined : { isActive: active },
        orderBy: { price: "asc" },
      });

      return ok(res, plans);
    } catch (error) {
      console.error("Failed to list membership plans:", error);
      return fail(res, 500, "Failed to list membership plans");
    }
  }

  /**
   * POST /admin/plans — create a new membership plan definition.
   */
  async create(req: Request, res: Response) {
    try {
      const body = req.body as {
        code: string;
        name: string;
        description?: string;
        price: number;
        currency?: string;
        interval: string;
        features?: string[];
        isMostPopular?: boolean;
        isActive?: boolean;
      };

      const existing = await prisma.membershipPlan.findUnique({
        where: { code: body.code as never },
      });
      if (existing) {
        return fail(res, 409, {
          code: "PLAN_ALREADY_EXISTS",
          message: "A plan with this code already exists",
        });
      }

      if (!PLAN_CODES.includes(body.code)) {
        return fail(res, 400, {
          code: "INVALID_PLAN_CODE",
          message: "Invalid membership tier code",
        });
      }

      if (!INTERVALS.includes(body.interval)) {
        return fail(res, 400, { code: "INVALID_INTERVAL", message: "Invalid billing interval" });
      }

      const plan = await prisma.membershipPlan.create({
        data: {
          code: body.code as never,
          name: body.name,
          description: body.description ?? null,
          price: body.price,
          currency: body.currency ?? "GHS",
          interval: body.interval as never,
          features: body.features ?? [],
          isMostPopular: body.isMostPopular ?? false,
          isActive: body.isActive ?? true,
        },
      });

      await logAdminActivity({
        actorId: req.user!.id,
        entityType: AdminEntityType.MEMBERSHIP_PLAN,
        entityId: plan.id,
        action: "CREATE_PLAN",
        note: `Created plan ${plan.code} (${plan.name})`,
      });

      return created(res, plan, "Membership plan created successfully");
    } catch (error) {
      console.error("Failed to create membership plan:", error);
      return fail(res, 500, "Failed to create membership plan");
    }
  }

  /**
   * PATCH /admin/plans/:id — update a membership plan definition.
   */
  async update(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const body = req.body as {
        name?: string;
        description?: string;
        price?: number;
        currency?: string;
        interval?: string;
        features?: string[];
        isMostPopular?: boolean;
        isActive?: boolean;
      };

      const existing = await prisma.membershipPlan.findUnique({ where: { id } });
      if (!existing) {
        return fail(res, 404, { code: "PLAN_NOT_FOUND", message: "Membership plan not found" });
      }

      if (body.interval && !INTERVALS.includes(body.interval)) {
        return fail(res, 400, { code: "INVALID_INTERVAL", message: "Invalid billing interval" });
      }

      const data: Record<string, unknown> = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.description !== undefined) data.description = body.description;
      if (body.price !== undefined) data.price = body.price;
      if (body.currency !== undefined) data.currency = body.currency;
      if (body.interval !== undefined) data.interval = body.interval;
      if (body.features !== undefined) data.features = body.features;
      if (body.isMostPopular !== undefined) data.isMostPopular = body.isMostPopular;
      if (body.isActive !== undefined) data.isActive = body.isActive;

      const plan = await prisma.membershipPlan.update({
        where: { id },
        data: data as never,
      });

      await logAdminActivity({
        actorId: req.user!.id,
        entityType: AdminEntityType.MEMBERSHIP_PLAN,
        entityId: plan.id,
        action: "UPDATE_PLAN",
        note: `Updated plan ${plan.code}`,
      });

      return ok(res, plan, "Membership plan updated successfully");
    } catch (error) {
      console.error("Failed to update membership plan:", error);
      return fail(res, 500, "Failed to update membership plan");
    }
  }

  /**
   * POST /admin/plans/:id/toggle — activate/deactivate a membership plan.
   */
  async toggle(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const existing = await prisma.membershipPlan.findUnique({ where: { id } });
      if (!existing) {
        return fail(res, 404, { code: "PLAN_NOT_FOUND", message: "Membership plan not found" });
      }

      const plan = await prisma.membershipPlan.update({
        where: { id },
        data: { isActive: !existing.isActive },
      });

      await logAdminActivity({
        actorId: req.user!.id,
        entityType: AdminEntityType.MEMBERSHIP_PLAN,
        entityId: plan.id,
        action: plan.isActive ? "ACTIVATE_PLAN" : "DEACTIVATE_PLAN",
        note: `${plan.isActive ? "Activated" : "Deactivated"} plan ${plan.code}`,
      });

      return ok(res, plan, "Membership plan status updated successfully");
    } catch (error) {
      console.error("Failed to toggle membership plan:", error);
      return fail(res, 500, "Failed to toggle membership plan");
    }
  }

  /**
   * DELETE /admin/plans/:id — hard delete a membership plan definition.
   */
  async remove(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const existing = await prisma.membershipPlan.findUnique({ where: { id } });
      if (!existing) {
        return fail(res, 404, { code: "PLAN_NOT_FOUND", message: "Membership plan not found" });
      }

      await prisma.membershipPlan.delete({ where: { id } });

      await logAdminActivity({
        actorId: req.user!.id,
        entityType: AdminEntityType.MEMBERSHIP_PLAN,
        entityId: existing.id,
        action: "DELETE_PLAN",
        note: `Deleted plan ${existing.code} (${existing.name})`,
      });

      return ok(res, null, "Membership plan deleted successfully");
    } catch (error) {
      console.error("Failed to delete membership plan:", error);
      return fail(res, 500, "Failed to delete membership plan");
    }
  }
}
