import type { Prisma } from "../../generated/prisma/client.js";
import { deriveTransitProfile } from "../helpers/transit-profile.js";
import { baseTourSites } from "./base-tour-sites.js";
import { extraTourSites } from "./ghana-tour-sites.js";
import { siteHistories } from "./ghana-tour-site-histories.js";
import { siteImages } from "./ghana-tour-site-images.js";

/**
 * The complete Ghana tour-site catalogue used by both the demo seed and the
 * targeted production sync script. Each entry carries the long-form history and
 * photo metadata needed by the destination detail page, and the mobility tier
 * is always derived from the region.
 */
export const tourSiteCatalogue: Prisma.TourSiteCreateInput[] = [
  ...baseTourSites,
  ...extraTourSites,
].map((site) => {
  const image = siteImages[site.name];
  return {
    ...site,
    history: siteHistories[site.name] ?? site.history ?? null,
    imageUrl: site.imageUrl ?? image?.url ?? null,
    imageCredit: image?.credit ?? null,
    transit_profile: deriveTransitProfile(site.region),
  };
});
