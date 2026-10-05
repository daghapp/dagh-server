import { Request, Response } from "express";
import { prisma } from "../../config/prisma.js";
import { ok, fail, paginated } from "../../helpers/response.js";

export class AdminNotificationsController {
  async list(req: Request, res: Response) {
    try {
      const user = req.user;
      if (!user) return fail(res, 401, "Not authenticated");
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
      const skip = (page - 1) * limit;
      const category = req.query.category as string | undefined;

      const where: any = { adminId: user.id };
      if (category) where.category = category;

      const [items, total, unreadCount] = await Promise.all([
        prisma.adminNotification.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.adminNotification.count({ where }),
        prisma.adminNotification.count({ where: { adminId: user.id, read: false } }),
      ]);

      return paginated(res, items, total, page, limit, undefined, { unreadCount });
    } catch (error) {
      console.error("Failed to list admin notifications:", error);
      return fail(res, 500, "Failed to fetch notifications");
    }
  }

  async markRead(req: Request, res: Response) {
    try {
      const user = req.user;
      if (!user) return fail(res, 401, "Not authenticated");
      const id = req.params.id as string;
      await prisma.adminNotification.updateMany({
        where: { id, adminId: user.id },
        data: { read: true, readAt: new Date() },
      });
      return ok(res, { id }, "Marked as read");
    } catch (error) {
      return fail(res, 500, "Failed to mark as read");
    }
  }

  async markAllRead(req: Request, res: Response) {
    try {
      const user = req.user;
      if (!user) return fail(res, 401, "Not authenticated");
      await prisma.adminNotification.updateMany({
        where: { adminId: user.id, read: false },
        data: { read: true, readAt: new Date() },
      });
      return ok(res, null as never, "All notifications marked as read");
    } catch (error) {
      return fail(res, 500, "Failed to mark all as read");
    }
  }

  async clearAll(req: Request, res: Response) {
    try {
      const user = req.user;
      if (!user) return fail(res, 401, "Not authenticated");
      await prisma.adminNotification.deleteMany({ where: { adminId: user.id } });
      return ok(res, null as never, "Notifications cleared");
    } catch (error) {
      return fail(res, 500, "Failed to clear notifications");
    }
  }
}
