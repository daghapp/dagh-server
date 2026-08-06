import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";

// ─────────────────────────────────────────
// Admin moderation — report queue & actions
// ─────────────────────────────────────────

const reportInclude = {
  reporter: { select: { id: true, fullName: true, email: true } },
  target: { select: { id: true, fullName: true, email: true, accountStatus: true } },
} as const;

/**
 * List user reports with optional status filter (default: all).
 */
export const listReports = async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const pageRaw = Number(req.query.page ?? 1);
    const page = Number.isFinite(pageRaw) ? Math.max(pageRaw, 1) : 1;
    const limitRaw = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;

    const where = status && status !== "ALL" ? { status: status as never } : {};

    const [reports, total] = await Promise.all([
      prisma.userReport.findMany({
        where,
        include: reportInclude,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: (page - 1) * limit,
      }),
      prisma.userReport.count({ where }),
    ]);

    return ok(res, { reports, total, page, limit });
  } catch (error) {
    console.error("List reports error:", error);
    return fail(res, 500, "Failed to fetch reports");
  }
};

/**
 * Update a report's status (REVIEWING / RESOLVED / DISMISSED).
 */
export const resolveReport = async (req: Request, res: Response) => {
  try {
    const adminId = req.user!.id;
    const reportId = req.params.reportId as string;
    const { status, resolutionNote } = req.body as {
      status: "REVIEWING" | "RESOLVED" | "DISMISSED";
      resolutionNote?: string;
    };

    const existing = await prisma.userReport.findUnique({ where: { id: reportId } });
    if (!existing) {
      return fail(res, 404, "Report not found");
    }

    const closed = status === "RESOLVED" || status === "DISMISSED";

    const report = await prisma.userReport.update({
      where: { id: reportId },
      data: {
        status,
        resolutionNote: resolutionNote ?? undefined,
        resolvedAt: closed ? new Date() : null,
        resolvedById: closed ? adminId : null,
      },
    });

    return ok(res, report, "Report updated successfully");
  } catch (error) {
    console.error("Resolve report error:", error);
    return fail(res, 500, "Failed to update report");
  }
};

/**
 * Suspend the target user of a report (safety action).
 */
export const suspendReportedUser = async (req: Request, res: Response) => {
  try {
    const reportId = req.params.reportId as string;

    const report = await prisma.userReport.findUnique({
      where: { id: reportId },
      select: { targetId: true },
    });

    if (!report) {
      return fail(res, 404, "Report not found");
    }

    const user = await prisma.user.update({
      where: { id: report.targetId },
      data: { accountStatus: "SUSPENDED" },
      select: { id: true, fullName: true, email: true, accountStatus: true },
    });

    await prisma.userReport.update({
      where: { id: reportId },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedById: req.user!.id,
      },
    });

    return ok(res, { user, reportId }, "User suspended and report resolved");
  } catch (error) {
    console.error("Suspend reported user error:", error);
    return fail(res, 500, "Failed to suspend user");
  }
};
