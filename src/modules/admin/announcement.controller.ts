import { Request, Response } from "express";
import { prisma } from "../../config/prisma.js";
import { created, fail, ok, paginated } from "../../helpers/response.js";
import { AdminEntityType, logAdminActivity } from "../../helpers/admin-activity.js";
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_CATEGORIES,
  type CreateAnnouncementInput,
} from "../../validator/announcementValidation.js";
import {
  cancelAnnouncement,
  dispatchAnnouncements,
  enqueueAnnouncement,
  previewAnnouncementAudience,
} from "../../services/announcement.service.js";

const ANNOUNCEMENT_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "SENDING",
  "SENT",
  "FAILED",
  "CANCELLED",
] as const;

export class AdminAnnouncementController {
  /** POST /admin/notifications/broadcasts */
  async create(req: Request, res: Response) {
    try {
      const input = req.body as CreateAnnouncementInput;
      const adminId = req.user!.id;

      // Guard against an accidental double-submit creating two identical blasts.
      if (input.sendNow) {
        const duplicate = await prisma.announcement.findFirst({
          where: {
            createdBy: adminId,
            title: input.title,
            body: input.body,
            category: input.category,
            createdAt: { gte: new Date(Date.now() - 10 * 60_000) },
            status: { notIn: ["CANCELLED", "FAILED"] },
          },
        });
        if (duplicate) {
          return fail(res, 409, "An identical broadcast was created recently", {
            id: duplicate.id,
          });
        }
      }

      const announcement = await prisma.announcement.create({
        data: {
          title: input.title,
          body: input.body,
          category: input.category,
          audience: input.audience,
          route: input.route ? input.route : null,
          status: input.sendNow ? "DRAFT" : "SCHEDULED",
          scheduledAt: input.sendNow ? null : (input.scheduledAt ?? null),
          createdBy: adminId,
        },
      });

      await logAdminActivity({
        actorId: adminId,
        entityType: AdminEntityType.ANNOUNCEMENT,
        entityId: announcement.id,
        action: input.sendNow ? "ANNOUNCEMENT_QUEUED" : "ANNOUNCEMENT_SCHEDULED",
        note: `${input.category} broadcast: ${input.title}`,
        metadata: {
          category: input.category,
          audience: input.audience,
          scheduledAt: input.scheduledAt?.toISOString() ?? null,
        },
      });

      if (!input.sendNow) {
        return created(res, { announcement }, "Broadcast scheduled");
      }

      let audience;
      try {
        audience = await enqueueAnnouncement(announcement.id);
      } catch (error) {
        const message = (error as Error)?.message ?? "Failed to queue broadcast";
        await prisma.announcement.update({
          where: { id: announcement.id },
          data: { status: "FAILED", lastError: message },
        });
        return fail(res, 500, "Failed to queue broadcast", { id: announcement.id });
      }

      const queued = await prisma.announcement.findUnique({ where: { id: announcement.id } });
      void dispatchAnnouncements().catch((error) => {
        console.error("[announcements] immediate dispatch failed:", error);
      });

      return created(res, { announcement: queued, audience }, "Broadcast queued for delivery");
    } catch (error) {
      console.error("[announcements] create failed:", error);
      return fail(res, 500, "Failed to create broadcast");
    }
  }

  /** GET /admin/notifications/broadcasts */
  async list(req: Request, res: Response) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
      const status = typeof req.query.status === "string" ? req.query.status : undefined;

      if (status && !(ANNOUNCEMENT_STATUSES as readonly string[]).includes(status)) {
        return fail(res, 400, `status must be one of: ${ANNOUNCEMENT_STATUSES.join(", ")}`);
      }

      const where = status ? { status } : {};
      const [items, total] = await Promise.all([
        prisma.announcement.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.announcement.count({ where }),
      ]);

      return paginated(res, items, total, page, limit);
    } catch (error) {
      console.error("[announcements] list failed:", error);
      return fail(res, 500, "Failed to list broadcasts");
    }
  }

  /** GET /admin/notifications/broadcasts/:id */
  async get(req: Request, res: Response) {
    try {
      const announcement = await prisma.announcement.findUnique({
        where: { id: String(req.params.id) },
        include: {
          _count: { select: { deliveries: true } },
          deliveries: {
            orderBy: { updatedAt: "desc" },
            take: 100,
            select: {
              id: true,
              userId: true,
              deviceId: true,
              provider: true,
              status: true,
              attemptCount: true,
              errorCode: true,
              sentAt: true,
              updatedAt: true,
            },
          },
        },
      });

      if (!announcement) return fail(res, 404, "Broadcast not found");
      return ok(res, announcement);
    } catch (error) {
      console.error("[announcements] get failed:", error);
      return fail(res, 500, "Failed to fetch broadcast");
    }
  }

  /** POST /admin/notifications/broadcasts/:id/cancel */
  async cancel(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const existing = await prisma.announcement.findUnique({ where: { id } });
      if (!existing) return fail(res, 404, "Broadcast not found");

      const cancelled = await cancelAnnouncement(id);
      if (!cancelled) {
        return fail(res, 409, `Cannot cancel a broadcast in status ${existing.status}`);
      }

      await logAdminActivity({
        actorId: req.user!.id,
        entityType: AdminEntityType.ANNOUNCEMENT,
        entityId: id,
        action: "ANNOUNCEMENT_CANCELLED",
        note: `Broadcast cancelled: ${existing.title}`,
      });

      const announcement = await prisma.announcement.findUnique({ where: { id } });
      return ok(res, { announcement }, "Broadcast cancelled");
    } catch (error) {
      console.error("[announcements] cancel failed:", error);
      return fail(res, 500, "Failed to cancel broadcast");
    }
  }

  /** GET /admin/notifications/broadcasts/audience-preview */
  async preview(req: Request, res: Response) {
    try {
      const category = (req.query.category as string) || "ANNOUNCEMENT";
      const audience = (req.query.audience as string) || "ACTIVE";

      if (!(ANNOUNCEMENT_CATEGORIES as readonly string[]).includes(category)) {
        return fail(res, 400, `category must be one of: ${ANNOUNCEMENT_CATEGORIES.join(", ")}`);
      }
      if (!(ANNOUNCEMENT_AUDIENCES as readonly string[]).includes(audience)) {
        return fail(res, 400, `audience must be one of: ${ANNOUNCEMENT_AUDIENCES.join(", ")}`);
      }

      const summary = await previewAnnouncementAudience(category, audience);
      return ok(res, { category, audience, ...summary });
    } catch (error) {
      console.error("[announcements] preview failed:", error);
      return fail(res, 500, "Failed to preview audience");
    }
  }
}
