import { prisma } from "../../config/index.js";
import { logAdminActivity, AdminEntityType } from "../../helpers/admin-activity.js";
import { deriveTransitProfile } from "../../helpers/transit-profile.js";
import { mapToSiteCategory, buildCategoryTags } from "../pending-sites/pending-site.service.js";
import type { CreateTourSiteInput } from "../../validator/tour-site-validator.js";

// ─────────────────────────────────────────
// ADMIN-CREATED TOUR SITES
//
// Admins add a site straight into the production catalogue. This reuses the
// pending-site normalization helpers so an admin-created row is shaped exactly
// like an approved submission: free-text category → SiteCategory enum, album
// tags preserved, transit profile derived from the region.
// ─────────────────────────────────────────

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const key = tag.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(tag.trim());
  }
  return result;
}

/**
 * Create a live tour site. Rejects duplicate names case-insensitively against
 * the production catalogue, mirroring the pending-site approval guard.
 */
export async function createTourSite(adminId: string, input: CreateTourSiteInput) {
  const conflict = await prisma.tourSite.findFirst({
    where: { name: { equals: input.name, mode: "insensitive" } },
    select: { id: true },
  });
  if (conflict) throw new Error("DUPLICATE_SITE_NAME");

  const category = mapToSiteCategory(input.category ?? "");
  const categories = dedupeTags([
    ...buildCategoryTags(input.category ?? ""),
    ...(input.categories ?? []),
  ]);

  let site;
  try {
    site = await prisma.tourSite.create({
      data: {
        name: input.name,
        region: input.region,
        latitude: input.latitude,
        longitude: input.longitude,
        description: input.description,
        history: input.history,
        imageUrl: input.imageUrl,
        imageCredit: input.imageCredit,
        category,
        categories,
        transit_profile: deriveTransitProfile(input.region),
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      throw new Error("DUPLICATE_SITE_NAME", { cause: error });
    }
    throw error;
  }

  // Audit logging must never fail the create — the row is already committed.
  logAdminActivity({
    actorId: adminId,
    entityType: AdminEntityType.TOUR_DESTINATION,
    entityId: site.id,
    action: "TOUR_SITE_CREATED",
    note: site.name,
    metadata: { region: site.region, category: site.category },
  }).catch((error) => console.error("[tour-sites] activity log failed:", error));

  return site;
}
