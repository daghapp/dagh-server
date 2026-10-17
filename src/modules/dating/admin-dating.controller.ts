import { Request, Response } from "express";
import { prisma } from "../../config/prisma.js";
import { ok, fail } from "../../helpers/response.js";
import { logAdminActivity, AdminEntityType } from "../../helpers/admin-activity.js";
import { notifyAdmins } from "../../helpers/notify-admins.js";

// ─────────────────────────────────────────
// Admin dating moderation (§3.6).
//
// Queue source of truth is DatingApplication (status String: PENDING, APPROVED,
// REJECTED, FLAGGED, NEEDS_INFO). Every DatingProfile owner is guaranteed a row
// via ensurePendingApplications() before the queue is read. `:id` params below
// are the applicant's userId (DatingApplication.userId is unique).
// ─────────────────────────────────────────

type ScreeningBadge = "ID_VERIFIED" | "MANUAL_CHECK" | "AI_SCREENED";

const TAB_STATUS = {
  pending: "PENDING",
  approved: "APPROVED",
  flagged: "FLAGGED",
} as const;

type Tab = keyof typeof TAB_STATUS;

const userSelect = {
  id: true,
  fullName: true,
  email: true,
  dateOfBirth: true,
  gender: true,
  profileImageUrl: true,
  accountStatus: true,
  createdAt: true,
  datingProfile: true,
  profile: { include: { profileVerification: true } },
} as const;

function calcAge(dateOfBirth: Date | null): number | null {
  if (!dateOfBirth) return null;
  const birth = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

function screeningBadge(isVerified: boolean, reviewerId: string | null): ScreeningBadge {
  if (isVerified) return "ID_VERIFIED";
  if (reviewerId) return "MANUAL_CHECK";
  return "AI_SCREENED";
}

// Guarantees every DatingProfile owner has a DatingApplication row so the
// queue never silently drops dating users. Runs on queue reads, not writes.
async function ensurePendingApplications(): Promise<void> {
  const profiles = await prisma.datingProfile.findMany({ select: { userId: true } });
  if (profiles.length === 0) return;
  const existing = await prisma.datingApplication.findMany({ select: { userId: true } });
  const existingIds = new Set(existing.map((a) => a.userId));
  const missing = profiles.map((p) => p.userId).filter((id) => !existingIds.has(id));
  if (missing.length === 0) return;
  await prisma.datingApplication.createMany({
    data: missing.map((userId) => ({ userId, status: "PENDING" })),
    skipDuplicates: true,
  });
}

async function requireDatingUser(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, datingProfile: { select: { userId: true } } },
  });
}

/**
 * GET /profiles?tab=pending|approved|flagged&cursor=&limit=
 * Cursor = last application id; order by application createdAt desc.
 */
export const listProfiles = async (req: Request, res: Response) => {
  try {
    const rawTab = (req.query.tab as string | undefined) ?? "pending";
    if (!(rawTab in TAB_STATUS)) {
      return fail(res, 400, {
        code: "INVALID_TAB",
        message: "tab must be one of pending, approved, flagged",
      });
    }
    const tab = rawTab as Tab;
    const limitRaw = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 50) : 20;
    const cursorId = (req.query.cursor as string | undefined) || null;

    await ensurePendingApplications();

    const [pending, approved, flagged] = await Promise.all([
      prisma.datingApplication.count({ where: { status: "PENDING" } }),
      prisma.datingApplication.count({ where: { status: "APPROVED" } }),
      prisma.datingApplication.count({ where: { status: "FLAGGED" } }),
    ]);

    // Resolve the cursor id to its createdAt for keyset pagination (with the
    // id as tiebreak for rows sharing a timestamp). Unknown cursor → ignore.
    let cursorFilter = {};
    if (cursorId) {
      const cursorRow = await prisma.datingApplication.findUnique({
        where: { id: cursorId },
        select: { id: true, createdAt: true },
      });
      if (cursorRow) {
        cursorFilter = {
          OR: [
            { createdAt: { lt: cursorRow.createdAt } },
            { createdAt: cursorRow.createdAt, id: { lt: cursorRow.id } },
          ],
        };
      }
    }

    const rows = await prisma.datingApplication.findMany({
      where: { status: TAB_STATUS[tab], ...cursorFilter },
      include: { user: { select: userSelect } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const page = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? page[page.length - 1].id : null;

    const profiles = page.map((app) => {
      const u = app.user;
      const dating = u.datingProfile;
      const verification = u.profile?.profileVerification ?? null;
      return {
        applicationId: app.id,
        userId: app.userId,
        status: app.status,
        user: {
          id: u.id,
          fullName: u.fullName,
          age: calcAge(u.dateOfBirth),
          location: dating?.location ?? null,
          joinedAt: u.createdAt,
          quote: dating?.headline ?? dating?.about ?? null,
        },
        photo: u.profileImageUrl ?? dating?.photos?.[0] ?? null,
        screeningBadge: screeningBadge(verification?.isVerified ?? false, app.reviewerId),
        reviewerId: app.reviewerId,
        reason: app.reason,
        reviewedAt: app.reviewedAt,
        createdAt: app.createdAt,
      };
    });

    return ok(res, { profiles, nextCursor, tabCounts: { pending, approved, flagged } });
  } catch (error) {
    console.error("Admin dating list error:", error);
    return fail(res, 500, "Failed to fetch dating review queue");
  }
};

/**
 * GET /profiles/stats — Review Performance panel.
 */
export const getProfileStats = async (_req: Request, res: Response) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [total, cleared, verifiedToday, reviewedToday] = await Promise.all([
      prisma.datingApplication.count(),
      prisma.datingApplication.count({ where: { status: { in: ["APPROVED", "REJECTED"] } } }),
      prisma.datingApplication.count({
        where: { status: "APPROVED", reviewedAt: { gte: startOfDay } },
      }),
      prisma.datingApplication.findMany({
        where: { reviewedAt: { gte: startOfDay } },
        select: { createdAt: true, reviewedAt: true },
      }),
    ]);

    const queueClearedPct = total === 0 ? 0 : Math.round((cleared / total) * 1000) / 10;

    // Null when nothing was reviewed today (no data, not zero-second reviews).
    let avgReviewSeconds: number | null = null;
    if (reviewedToday.length > 0) {
      const totalSeconds = reviewedToday.reduce(
        (sum, r) => sum + (r.reviewedAt!.getTime() - r.createdAt.getTime()) / 1000,
        0,
      );
      avgReviewSeconds = Math.round(totalSeconds / reviewedToday.length);
    }

    return ok(res, { queueClearedPct, verifiedToday, avgReviewSeconds });
  } catch (error) {
    console.error("Admin dating stats error:", error);
    return fail(res, 500, "Failed to fetch dating review stats");
  }
};

/**
 * GET /profiles/:id — full review detail. `:id` is the applicant's userId.
 */
export const getProfileDetail = async (req: Request, res: Response) => {
  try {
    const userId = req.params.id as string;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: userSelect,
    });
    if (!user || !user.datingProfile) {
      return fail(res, 404, {
        code: "DATING_PROFILE_NOT_FOUND",
        message: "Dating profile not found",
      });
    }

    const verification = user.profile?.profileVerification ?? null;
    const userProfile = user.profile;

    const [application, notesHistory] = await Promise.all([
      prisma.datingApplication.findUnique({ where: { userId } }),
      prisma.adminActivityLog.findMany({
        where: { entityType: AdminEntityType.PROFILE_VERIFICATION, entityId: userId },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

    // Verification row surfaced as-is: only per-section statuses exist in the
    // schema (no confidence/expiry/issuer columns), so none are invented here.
    return ok(res, {
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        age: calcAge(user.dateOfBirth),
        gender: user.gender,
        profileImageUrl: user.profileImageUrl,
        accountStatus: user.accountStatus,
        joinedAt: user.createdAt,
      },
      datingProfile: user.datingProfile,
      photos: user.datingProfile.photos ?? [],
      verification,
      document: userProfile
        ? {
            urls: userProfile.bio_document_urls,
            type: userProfile.bio_document_type,
            number: userProfile.bio_document_number,
            uploadedAt: userProfile.bio_document_uploaded_at,
          }
        : null,
      application,
      notesHistory,
    });
  } catch (error) {
    console.error("Admin dating detail error:", error);
    return fail(res, 500, "Failed to fetch dating profile detail");
  }
};

/**
 * PATCH /profiles/:id/approve
 */
export const approveProfile = async (req: Request, res: Response) => {
  try {
    const adminId = req.user!.id;
    const userId = req.params.id as string;
    const datingUser = await requireDatingUser(userId);
    if (!datingUser || !datingUser.datingProfile) {
      return fail(res, 404, {
        code: "DATING_PROFILE_NOT_FOUND",
        message: "Dating profile not found",
      });
    }

    const previous = await prisma.datingApplication.findUnique({ where: { userId } });
    const application = await prisma.datingApplication.upsert({
      where: { userId },
      create: { userId, status: "APPROVED", reviewerId: adminId, reviewedAt: new Date() },
      update: { status: "APPROVED", reviewerId: adminId, reviewedAt: new Date() },
    });

    await logAdminActivity({
      actorId: adminId,
      entityType: AdminEntityType.PROFILE_VERIFICATION,
      entityId: userId,
      action: "APPROVED",
      note: `Approved dating profile for ${datingUser.fullName}`,
      metadata: { from: previous?.status ?? null, to: "APPROVED" },
    });

    await notifyAdmins({
      category: "dating",
      message: `Dating profile approved for ${datingUser.fullName}`,
      actionUrl: `/admin/dating/profiles/${userId}`,
      meta: { userId, status: "APPROVED" },
      excludeAdminId: adminId,
    });

    return ok(res, { application }, "Dating profile approved");
  } catch (error) {
    console.error("Admin dating approve error:", error);
    return fail(res, 500, "Failed to approve dating profile");
  }
};

/**
 * PATCH /profiles/:id/reject { reason } — reason required.
 */
export const rejectProfile = async (req: Request, res: Response) => {
  try {
    const adminId = req.user!.id;
    const userId = req.params.id as string;
    const { reason } = req.body as { reason?: string };
    if (!reason || reason.trim().length === 0) {
      return fail(res, 400, {
        code: "REASON_REQUIRED",
        message: "A rejection reason is required",
      });
    }
    const datingUser = await requireDatingUser(userId);
    if (!datingUser || !datingUser.datingProfile) {
      return fail(res, 404, {
        code: "DATING_PROFILE_NOT_FOUND",
        message: "Dating profile not found",
      });
    }

    const previous = await prisma.datingApplication.findUnique({ where: { userId } });
    const application = await prisma.datingApplication.upsert({
      where: { userId },
      create: {
        userId,
        status: "REJECTED",
        reason: reason.trim(),
        reviewerId: adminId,
        reviewedAt: new Date(),
      },
      update: {
        status: "REJECTED",
        reason: reason.trim(),
        reviewerId: adminId,
        reviewedAt: new Date(),
      },
    });

    await logAdminActivity({
      actorId: adminId,
      entityType: AdminEntityType.PROFILE_VERIFICATION,
      entityId: userId,
      action: "REJECTED",
      note: reason.trim(),
      metadata: { from: previous?.status ?? null, to: "REJECTED" },
    });

    await notifyAdmins({
      category: "dating",
      message: `Dating profile rejected for ${datingUser.fullName}: ${reason.trim()}`,
      actionUrl: `/admin/dating/profiles/${userId}`,
      meta: { userId, status: "REJECTED" },
      excludeAdminId: adminId,
    });

    return ok(res, { application }, "Dating profile rejected");
  } catch (error) {
    console.error("Admin dating reject error:", error);
    return fail(res, 500, "Failed to reject dating profile");
  }
};

/**
 * POST /profiles/:id/request-info { message } — message required. Stored in
 * application.notes so the user side can display it, reason mirrors it.
 */
export const requestInfo = async (req: Request, res: Response) => {
  try {
    const adminId = req.user!.id;
    const userId = req.params.id as string;
    const { message } = req.body as { message?: string };
    if (!message || message.trim().length === 0) {
      return fail(res, 400, {
        code: "MESSAGE_REQUIRED",
        message: "An info-request message is required",
      });
    }
    const datingUser = await requireDatingUser(userId);
    if (!datingUser || !datingUser.datingProfile) {
      return fail(res, 404, {
        code: "DATING_PROFILE_NOT_FOUND",
        message: "Dating profile not found",
      });
    }

    const previous = await prisma.datingApplication.findUnique({ where: { userId } });
    const application = await prisma.datingApplication.upsert({
      where: { userId },
      create: {
        userId,
        status: "NEEDS_INFO",
        reason: message.trim(),
        notes: message.trim(),
        reviewerId: adminId,
        reviewedAt: new Date(),
      },
      update: {
        status: "NEEDS_INFO",
        reason: message.trim(),
        notes: message.trim(),
        reviewerId: adminId,
        reviewedAt: new Date(),
      },
    });

    await logAdminActivity({
      actorId: adminId,
      entityType: AdminEntityType.PROFILE_VERIFICATION,
      entityId: userId,
      action: "INFO_REQUESTED",
      note: message.trim(),
      metadata: { from: previous?.status ?? null, to: "NEEDS_INFO" },
    });

    return ok(res, { application }, "Information requested from applicant");
  } catch (error) {
    console.error("Admin dating request-info error:", error);
    return fail(res, 500, "Failed to request information");
  }
};

/**
 * PATCH /profiles/:id/flag { reason? }
 */
export const flagProfile = async (req: Request, res: Response) => {
  try {
    const adminId = req.user!.id;
    const userId = req.params.id as string;
    const { reason } = req.body as { reason?: string };
    const datingUser = await requireDatingUser(userId);
    if (!datingUser || !datingUser.datingProfile) {
      return fail(res, 404, {
        code: "DATING_PROFILE_NOT_FOUND",
        message: "Dating profile not found",
      });
    }

    const previous = await prisma.datingApplication.findUnique({ where: { userId } });
    const application = await prisma.datingApplication.upsert({
      where: { userId },
      create: {
        userId,
        status: "FLAGGED",
        reason: reason?.trim() || null,
        reviewerId: adminId,
        reviewedAt: new Date(),
      },
      update: {
        status: "FLAGGED",
        reason: reason?.trim() || null,
        reviewerId: adminId,
        reviewedAt: new Date(),
      },
    });

    await logAdminActivity({
      actorId: adminId,
      entityType: AdminEntityType.PROFILE_VERIFICATION,
      entityId: userId,
      action: "FLAGGED",
      note: reason?.trim() || `Flagged dating profile for ${datingUser.fullName}`,
      metadata: { from: previous?.status ?? null, to: "FLAGGED" },
    });

    await notifyAdmins({
      category: "dating",
      message: `Dating profile flagged for ${datingUser.fullName}${reason?.trim() ? `: ${reason.trim()}` : ""}`,
      actionUrl: `/admin/dating/profiles/${userId}`,
      meta: { userId, status: "FLAGGED" },
      excludeAdminId: adminId,
    });

    return ok(res, { application }, "Dating profile flagged");
  } catch (error) {
    console.error("Admin dating flag error:", error);
    return fail(res, 500, "Failed to flag dating profile");
  }
};

/**
 * PATCH /profiles/bulk { ids[], action: approve|flag }
 */
export const bulkReview = async (req: Request, res: Response) => {
  try {
    const adminId = req.user!.id;
    const { ids, action } = req.body as { ids?: unknown; action?: string };
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string")) {
      return fail(res, 400, {
        code: "INVALID_IDS",
        message: "ids must be a non-empty array of user id strings",
      });
    }
    if (action !== "approve" && action !== "flag") {
      return fail(res, 400, {
        code: "INVALID_ACTION",
        message: "action must be one of approve, flag",
      });
    }

    const targetStatus = action === "approve" ? "APPROVED" : "FLAGGED";
    const now = new Date();

    // Only dating-profile owners are actionable; anything else lands in failed.
    const owners = await prisma.datingProfile.findMany({
      where: { userId: { in: ids as string[] } },
      select: { userId: true },
    });
    const actionable = new Set(owners.map((o) => o.userId));

    let updated = 0;
    const failed: string[] = [];
    for (const userId of ids as string[]) {
      if (!actionable.has(userId)) {
        failed.push(userId);
        continue;
      }
      try {
        await prisma.datingApplication.upsert({
          where: { userId },
          create: { userId, status: targetStatus, reviewerId: adminId, reviewedAt: now },
          update: { status: targetStatus, reviewerId: adminId, reviewedAt: now },
        });
        updated += 1;
      } catch (error) {
        console.error(`Admin dating bulk ${action} failed for ${userId}:`, error);
        failed.push(userId);
      }
    }

    // Single audit entry covering the batch (per-item logging not required).
    await logAdminActivity({
      actorId: adminId,
      entityType: AdminEntityType.PROFILE_VERIFICATION,
      action: action === "approve" ? "BULK_APPROVED" : "BULK_FLAGGED",
      note: `Bulk ${action}: ${updated} updated, ${failed.length} failed`,
      metadata: { action, to: targetStatus, ids, updated, failed },
    });

    return ok(res, { updated, failed });
  } catch (error) {
    console.error("Admin dating bulk error:", error);
    return fail(res, 500, "Failed to process bulk review");
  }
};

/**
 * POST /profiles/:id/notes { note } — appends via activity log and mirrors
 * the latest note into application.notes.
 */
export const addNote = async (req: Request, res: Response) => {
  try {
    const adminId = req.user!.id;
    const userId = req.params.id as string;
    const { note } = req.body as { note?: string };
    if (!note || note.trim().length === 0) {
      return fail(res, 400, {
        code: "NOTE_REQUIRED",
        message: "A note is required",
      });
    }
    const datingUser = await requireDatingUser(userId);
    if (!datingUser || !datingUser.datingProfile) {
      return fail(res, 404, {
        code: "DATING_PROFILE_NOT_FOUND",
        message: "Dating profile not found",
      });
    }

    const entry = await logAdminActivity({
      actorId: adminId,
      entityType: AdminEntityType.PROFILE_VERIFICATION,
      entityId: userId,
      action: "NOTE_ADDED",
      note: note.trim(),
    });

    await prisma.datingApplication.upsert({
      where: { userId },
      create: { userId, status: "PENDING", notes: note.trim() },
      update: { notes: note.trim() },
    });

    return ok(res, { note: entry }, "Note added");
  } catch (error) {
    console.error("Admin dating note error:", error);
    return fail(res, 500, "Failed to add note");
  }
};

/**
 * GET /profiles/:id/document — stored ID document fields as-is.
 *
 * NOTE (honest): bio_document_urls are direct storage URLs, not signed or
 * expiring links — they are returned verbatim, with no access-proxying here.
 * Access itself is audit-logged below.
 */
export const getDocument = async (req: Request, res: Response) => {
  try {
    const adminId = req.user!.id;
    const userId = req.params.id as string;
    const userProfile = await prisma.userProfile.findUnique({ where: { userId } });
    if (!userProfile) {
      return fail(res, 404, {
        code: "DOCUMENT_NOT_FOUND",
        message: "No ID document on file for this user",
      });
    }

    await logAdminActivity({
      actorId: adminId,
      entityType: AdminEntityType.PROFILE_VERIFICATION,
      entityId: userId,
      action: "DOCUMENT_VIEWED",
      note: `Viewed ID document for user ${userId}`,
    });

    return ok(res, {
      userId,
      urls: userProfile.bio_document_urls,
      type: userProfile.bio_document_type,
      number: userProfile.bio_document_number,
      uploadedAt: userProfile.bio_document_uploaded_at,
    });
  } catch (error) {
    console.error("Admin dating document error:", error);
    return fail(res, 500, "Failed to fetch ID document");
  }
};
