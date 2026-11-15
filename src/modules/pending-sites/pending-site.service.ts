import { prisma } from "../../config/index.js";
import sendEmail from "../../config/resend.config.js";
import { notifyAdmins } from "../../helpers/notify-admins.js";
import { deriveTransitProfile } from "../../helpers/transit-profile.js";
import type { SiteCategory } from "../../../generated/prisma/client.js";
import type { SubmitPendingSiteInput } from "../../validator/pending-site-validator.js";

// ─────────────────────────────────────────
// USER-GENERATED TOUR SITES — submission + admin approval workflow (§3)
//
// Users submit site forms into the `pending_sites` staging table. Admins
// review each row and either approve it (migrating it into the production
// `tour_sites` catalogue) or reject it with a revision reason. Plain-argument
// functions (no Express types) so the workflow is directly unit-testable.
// ─────────────────────────────────────────

export type PendingSiteStatus = "pending" | "approved" | "rejected";

const VALID_STATUSES: readonly PendingSiteStatus[] = ["pending", "approved", "rejected"];

/**
 * Free-text category → SiteCategory enum normalization.
 *
 * Ordered keyword scan against the lowercased input; FIRST match wins so
 * "Accra Heritage Museum" lands on HERITAGE (checked before HISTORICAL)
 * rather than the broader bucket. Fallback is CULTURAL: Ghana's tourism
 * catalogue is predominantly cultural, and an unknown tag still produces a
 * production row admins can recategorize, instead of blocking approval.
 */
export function mapToSiteCategory(freeText: string): SiteCategory {
  const text = freeText.toLowerCase();

  const rules: [RegExp, SiteCategory][] = [
    [/heritage/, "HERITAGE"],
    [/histor|castle|fort|museum/, "HISTORICAL"],
    [/adventur/, "ADVENTURE"],
    [/beach|coast|ocean|lagoon/, "BEACH"],
    [/wildlife|safari|reserve|zoo|sanctuary/, "WILDLIFE"],
    [/botanic|garden|forest|waterfall|lake|river|nature|park/, "NATURE"],
    [/religious|church|mosque|shrine|temple|pilgrim/, "RELIGIOUS"],
    [/scenic|viewpoint|hill|mountain|cliff|landscape/, "SCENIC"],
    [/urban|city|market|nightlife|skyline/, "URBAN"],
    [/cultural|tradition|village|art|craft|festival|music|royal|palace/, "CULTURAL"],
  ];

  for (const [pattern, category] of rules) {
    if (pattern.test(text)) return category;
  }
  return "CULTURAL";
}

/**
 * Supplementary album tags (§5) built from the user's free-text category.
 *
 * The user's wording is kept as a single tag (no forced title-casing — the
 * album layer matches tags case-insensitively where possible) but ONLY when it
 * does not already equal the mapped enum name: "Historical" would duplicate
 * the primary `category` column, while "Slave Route Tour" adds real signal.
 */
export function buildCategoryTags(freeText: string): string[] {
  const trimmed = freeText.trim();
  if (!trimmed) return [];
  if (trimmed.toLowerCase() === mapToSiteCategory(trimmed).toLowerCase()) return [];
  return [trimmed];
}

// ─────────────────────────────────────────
// SUBMISSION (user)
// ─────────────────────────────────────────

/**
 * Stage a new user-submitted tour site. Rejects a name that already exists in
 * the production catalogue OR is sitting in another pending review — otherwise
 * two copies of the same site could race through moderation.
 */
export async function submitPendingSite(userId: string, input: SubmitPendingSiteInput) {
  const { name } = input;

  const existingTourSite = await prisma.tourSite.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existingTourSite) throw new Error("DUPLICATE_SITE_NAME");

  const existingPending = await prisma.pendingSite.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, status: "pending" },
    select: { id: true },
  });
  if (existingPending) throw new Error("DUPLICATE_SITE_NAME");

  // Normalize imageUrl: accept single string or array of up to 4 URLs
  let imageUrl: string | null = null;
  const imageCredit:
    | string
    | undefined = input.imageCredit as string | undefined;

  if (input.imageUrl) {
    if (typeof input.imageUrl === "string") {
      imageUrl = input.imageUrl;
    } else if (Array.isArray(input.imageUrl) && input.imageUrl.length > 0) {
      // Store first image in imageUrl, rest in imageUrl2/3/4
      imageUrl = input.imageUrl[0];
    }
  }

  // If there are additional images beyond the first, store them
  let additionalImages: string[] = [];
  if (Array.isArray(input.imageUrl) && input.imageUrl.length > 1) {
    additionalImages = input.imageUrl.slice(1).filter((url): url is string => typeof url === "string");
  }

  const pendingSite = await prisma.pendingSite.create({
    data: {
      name,
      region: input.region,
      latitude: input.latitude,
      longitude: input.longitude,
      description: input.description,
      history: input.history,
      category: input.category ?? "",
      imageUrl,
      imageCredit,
      imageUrl2: additionalImages[0] ?? null,
      imageUrl3: additionalImages[1] ?? null,
      imageUrl4: additionalImages[2] ?? null,
      status: "pending",
      submittedBy: userId,
    },
  });

  // Fire-and-forget admin ping — documented as never-throwing, but guarded so
  // a notification hiccup can never fail the user's submission (§3.4).
  notifyAdmins({
    category: "tours",
    message: `New tour site submitted for review: ${name}`,
    actionUrl: "/admin/pending-sites",
  }).catch(() => {});

  // Best-effort email notification to the account handling tour submissions.
  try {
    const submitter = await prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true, email: true },
    });
    await sendEmail({
      email: "josephbekoe15@gmail.com",
      subject: "New tour site submitted for review",
      html: `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body {font-family: Arial, sans-serif; background: #f4f4f4; padding: 20px;}
      .container {background: #ffffff; max-width: 600px; margin: 0 auto; border-radius: 8px; overflow: hidden;}
      .header {background: #667eea; color: #ffffff; padding: 20px; text-align: center;}
      .content {padding: 30px; color: #333333;}
      .content h2 {color: #667eea; margin-top: 0;}
      .info-row {margin: 20px 0; padding: 10px; background: #f9f9f9; border-radius: 4px;}
      .info-label {font-weight: bold; color: #555555; display: inline-block; width: 30%;}
      .info-value {margin-left: 5%;}
      .footer {background: #667eea; color: #ffffff; padding: 15px; text-align: center; font-size: 12px;}
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>New Tour Site Submission</h1>
      </div>
      <div class="content">
        <p>A new tour site has been submitted for review:</p>
        <h2><strong>${name}</strong></h2>
        <div class="info-row">
          <span class="info-label">Region:</span>
          <span class="info-value">${input.region}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Submitted by:</span>
          <span class="info-value">${submitter?.fullName ?? "unknown"}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Email:</span>
          <span class="info-value">${submitter?.email ?? "unknown"}</span>
        </div>
      </div>
      <div class="footer">
        — The DAGH Team
      </div>
    </div>
  </body>
</html>`,
    });
  } catch (error) {
    console.error("[pending-sites] submission email failed:", error);
  }

  return pendingSite;
}

// ─────────────────────────────────────────
// MODERATION QUERIES (admin)
// ─────────────────────────────────────────

export async function listPendingSites({
  status,
  page = 1,
  limit = 20,
}: {
  status?: string;
  page?: number;
  limit?: number;
}) {
  // No status supplied → return every row; a supplied status must be a real
  // moderation state so typos surface as 400 instead of a silent empty list.
  if (status !== undefined && !VALID_STATUSES.includes(status as PendingSiteStatus)) {
    throw new Error("INVALID_STATUS");
  }

  const pageNum = Math.max(1, Math.floor(page));
  const limitNum = Math.min(100, Math.max(1, Math.floor(limit)));
  const skip = (pageNum - 1) * limitNum;

  const where = status ? { status } : {};

  const [sites, total] = await Promise.all([
    prisma.pendingSite.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: { createdAt: "desc" },
    }),
    prisma.pendingSite.count({ where }),
  ]);

  return { sites, total, page: pageNum, limit: limitNum };
}

export async function getMySubmissions(userId: string) {
  return prisma.pendingSite.findMany({
    where: { submittedBy: userId },
    select: {
      id: true,
      name: true,
      region: true,
      category: true,
      status: true,
      rejectReason: true,
      createdAt: true,
      imageUrl: true,
      imageCredit: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

// ─────────────────────────────────────────
// APPROVE — migrate into production tour_sites
// ─────────────────────────────────────────

/**
 * Approve a pending site and migrate it into the production catalogue.
 *
 * `_adminId` is part of the signature for the moderation call site; PendingSite
 * has no moderatedBy column yet, so it is accepted-but-unused until audit
 * logging lands.
 */
export async function approvePendingSite(siteId: string, _adminId: string) {
  const pendingSite = await prisma.pendingSite.findUnique({ where: { id: siteId } });
  if (!pendingSite) throw new Error("SITE_NOT_FOUND");
  if (pendingSite.status !== "pending") throw new Error("SITE_NOT_PENDING");

  // Case-insensitive conflict against the production catalogue; the unique
  // constraint on tour_sites.name is the backstop, this gives a clean 409.
  const conflict = await prisma.tourSite.findFirst({
    where: { name: { equals: pendingSite.name, mode: "insensitive" } },
    select: { id: true },
  });
  if (conflict) throw new Error("NAME_CONFLICT");

  let tourSiteId: string;
  try {
    tourSiteId = await prisma.$transaction(async (tx) => {
      const tourSite = await tx.tourSite.create({
        data: {
          name: pendingSite.name,
          region: pendingSite.region,
          latitude: pendingSite.latitude,
          longitude: pendingSite.longitude,
          description: pendingSite.description ?? "",
          history: pendingSite.history,
          imageUrl: pendingSite.imageUrl,
          imageCredit: pendingSite.imageCredit,
          // Free-text category normalized into the enum + kept as an album tag
          // so user wording like "Slave Route Tour" stays searchable (§5).
          category: mapToSiteCategory(pendingSite.category),
          categories: buildCategoryTags(pendingSite.category),
          transit_profile: deriveTransitProfile(pendingSite.region),
        },
      });

      await tx.pendingSite.update({
        where: { id: siteId },
        data: { status: "approved", updatedAt: new Date() },
      });

      return tourSite.id;
    });
  } catch (error) {
    // P2002 = unique tour_sites.name race lost between the check above and
    // the insert; surface it as the same 409 the pre-check produces.
    if ((error as { code?: string }).code === "P2002") {
      throw new Error("NAME_CONFLICT", { cause: error });
    }
    throw error;
  }

  // Best-effort approval email — never fails the moderation action (§3).
  try {
    const submitter = await prisma.user.findUnique({
      where: { id: pendingSite.submittedBy },
      select: { email: true },
    });
    if (submitter?.email) {
      await sendEmail({
        email: submitter.email,
        subject: "Your tour site submission was approved",
        html: `<p>Hello,</p><p>Great news — your tour site submission <strong>${pendingSite.name}</strong> has been reviewed and approved.</p><p>The site is now live in the DAGH tour catalogue and can appear in itineraries and albums.</p><p>— The DAGH Team</p>`,
      });
    }
  } catch (error) {
    console.error("[pending-sites] approval email failed:", error);
  }

  return { siteId, tourSiteId };
}

// ─────────────────────────────────────────
// REJECT — send back to the submitter with revision requirements
// ─────────────────────────────────────────

/**
 * Reject a pending site, storing the revision requirements on the row.
 * `_adminId` accepted-but-unused — see approvePendingSite above.
 */
export async function rejectPendingSite(siteId: string, _adminId: string, rejectReason: string) {
  const reason = (rejectReason ?? "").trim();
  if (reason.length < 5) throw new Error("INVALID_REJECT_REASON");

  const pendingSite = await prisma.pendingSite.findUnique({ where: { id: siteId } });
  if (!pendingSite) throw new Error("SITE_NOT_FOUND");
  if (pendingSite.status !== "pending") throw new Error("SITE_NOT_PENDING");

  await prisma.pendingSite.update({
    where: { id: siteId },
    data: { status: "rejected", rejectReason: reason, updatedAt: new Date() },
  });

  // Best-effort rejection email with the revision requirements (§3).
  try {
    const submitter = await prisma.user.findUnique({
      where: { id: pendingSite.submittedBy },
      select: { email: true },
    });
    if (submitter?.email) {
      await sendEmail({
        email: submitter.email,
        subject: "Your tour site submission needs changes",
        html: `<p>Hello,</p><p>Your tour site submission <strong>${pendingSite.name}</strong> needs some changes before it can be published.</p><p><strong>What to revise:</strong></p><p>${reason}</p><p>You can resubmit the site once the revisions are made.</p><p>— The DAGH Team</p>`,
      });
    }
  } catch (error) {
    console.error("[pending-sites] rejection email failed:", error);
  }

  return { siteId, rejectReason: reason };
}
