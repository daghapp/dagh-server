import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { fail, paginated } from "../../helpers/response.js";

/**
 * Reads over AdminActivityLog (§3.10 activity, §3.13 audit logs).
 * One table, two views: activity is the raw trail, audit-logs is the
 * admin-action view with before/after values surfaced.
 */

const ACTOR_SELECT = { id: true, fullName: true, email: true } as const;

function dateRange(query: Request["query"]) {
  const where: { gte?: Date; lte?: Date } = {};
  if (typeof query.from === "string" && !Number.isNaN(Date.parse(query.from))) {
    where.gte = new Date(query.from);
  }
  if (typeof query.to === "string" && !Number.isNaN(Date.parse(query.to))) {
    where.lte = new Date(query.to);
  }
  return Object.keys(where).length > 0 ? where : undefined;
}

function pageOf(query: Request["query"]) {
  const page = Math.max(1, parseInt((query.page as string) || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt((query.limit as string) || "20", 10)));
  return { page, limit, skip: (page - 1) * limit };
}

function escapeCsv(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export class AdminActivityController {
  /** GET /admin/activity — filterable trail over admin + system events. */
  async list(req: Request, res: Response) {
    try {
      const { page, limit, skip } = pageOf(req.query);
      const createdAt = dateRange(req.query);
      const where: Record<string, unknown> = {};
      if (typeof req.query.module === "string") where.entityType = req.query.module;
      if (typeof req.query.actor === "string") where.actorId = req.query.actor;
      if (typeof req.query.status === "string") where.action = req.query.status;
      if (createdAt) where.createdAt = createdAt;
      if (typeof req.query.search === "string" && req.query.search.length > 0) {
        const q = req.query.search;
        where.OR = [
          { action: { contains: q, mode: "insensitive" } },
          { note: { contains: q, mode: "insensitive" } },
          { entityId: { contains: q, mode: "insensitive" } },
        ];
      }
      const [rows, total] = await Promise.all([
        prisma.adminActivityLog.findMany({
          where,
          include: { actor: { select: ACTOR_SELECT } },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.adminActivityLog.count({ where }),
      ]);
      return paginated(res, rows, total, page, limit);
    } catch (error) {
      console.error("[activity] list failed:", error);
      return fail(res, 500, "Failed to load activity");
    }
  }

  /** GET /admin/activity/export — CSV with the same filters. */
  async exportCsv(req: Request, res: Response) {
    try {
      const createdAt = dateRange(req.query);
      const where: Record<string, unknown> = {};
      if (typeof req.query.module === "string") where.entityType = req.query.module;
      if (typeof req.query.actor === "string") where.actorId = req.query.actor;
      if (typeof req.query.status === "string") where.action = req.query.status;
      if (createdAt) where.createdAt = createdAt;
      if (typeof req.query.search === "string" && req.query.search.length > 0) {
        const q = req.query.search;
        where.OR = [
          { action: { contains: q, mode: "insensitive" } },
          { note: { contains: q, mode: "insensitive" } },
          { entityId: { contains: q, mode: "insensitive" } },
        ];
      }
      const rows = await prisma.adminActivityLog.findMany({
        where,
        include: { actor: { select: ACTOR_SELECT } },
        orderBy: { createdAt: "desc" },
        take: 5000,
      });
      const lines = [
        "timestamp,actor,action,module,entityId,note",
        ...rows.map((r) =>
          [
            r.createdAt.toISOString(),
            r.actor?.email ?? r.actorId,
            r.action,
            r.entityType,
            r.entityId ?? "",
            r.note ?? "",
          ]
            .map(escapeCsv)
            .join(","),
        ),
      ];
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="activity.csv"');
      return res.send(lines.join("\n"));
    } catch (error) {
      console.error("[activity] export failed:", error);
      return fail(res, 500, "Failed to export activity");
    }
  }

  /** GET /admin/audit-logs — admin-action view with before/after values. */
  async auditLogs(req: Request, res: Response) {
    try {
      const { page, limit, skip } = pageOf(req.query);
      const createdAt = dateRange(req.query);
      const where: Record<string, unknown> = {};
      if (typeof req.query.module === "string") where.entityType = req.query.module;
      if (typeof req.query.admin === "string") where.actorId = req.query.admin;
      if (createdAt) where.createdAt = createdAt;
      if (typeof req.query.search === "string" && req.query.search.length > 0) {
        const q = req.query.search;
        where.OR = [
          { action: { contains: q, mode: "insensitive" } },
          { note: { contains: q, mode: "insensitive" } },
          { entityId: { contains: q, mode: "insensitive" } },
        ];
      }
      const [rows, total] = await Promise.all([
        prisma.adminActivityLog.findMany({
          where,
          include: { actor: { select: ACTOR_SELECT } },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.adminActivityLog.count({ where }),
      ]);
      const data = rows.map((r) => {
        const meta =
          r.metadata && typeof r.metadata === "object" ? (r.metadata as Record<string, unknown>) : {};
        return {
          timestamp: r.createdAt,
          admin: r.actor,
          action: r.action,
          module: r.entityType,
          entity: r.entityId,
          previous: (meta.previous as unknown) ?? null,
          newState: (meta.new as unknown) ?? (meta.to as unknown) ?? null,
          note: r.note,
        };
      });
      return paginated(res, data, total, page, limit);
    } catch (error) {
      console.error("[audit-logs] list failed:", error);
      return fail(res, 500, "Failed to load audit logs");
    }
  }

  /** GET /admin/audit-logs/export — CSV. Super Administrator only via route. */
  async auditExport(req: Request, res: Response) {
    try {
      const createdAt = dateRange(req.query);
      const where: Record<string, unknown> = {};
      if (typeof req.query.module === "string") where.entityType = req.query.module;
      if (typeof req.query.admin === "string") where.actorId = req.query.admin;
      if (createdAt) where.createdAt = createdAt;
      const rows = await prisma.adminActivityLog.findMany({
        where,
        include: { actor: { select: ACTOR_SELECT } },
        orderBy: { createdAt: "desc" },
        take: 5000,
      });
      const lines = [
        "timestamp,admin,action,module,entity,previous,newState",
        ...rows.map((r) => {
          const meta =
            r.metadata && typeof r.metadata === "object" ? (r.metadata as Record<string, unknown>) : {};
          return [
            r.createdAt.toISOString(),
            r.actor?.email ?? r.actorId,
            r.action,
            r.entityType,
            r.entityId ?? "",
            JSON.stringify(meta.previous ?? null),
            JSON.stringify(meta.new ?? meta.to ?? null),
          ]
            .map(escapeCsv)
            .join(",");
        }),
      ];
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="audit-logs.csv"');
      return res.send(lines.join("\n"));
    } catch (error) {
      console.error("[audit-logs] export failed:", error);
      return fail(res, 500, "Failed to export audit logs");
    }
  }
}
