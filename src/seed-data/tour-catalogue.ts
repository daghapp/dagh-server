import type { Prisma } from "../../generated/prisma/client.js";
import { deriveTransitProfile } from "../helpers/transit-profile.js";
import { baseTourSites } from "./base-tour-sites.js";
import { extraTourSites } from "./ghana-tour-sites.js";
import { siteHistories } from "./ghana-tour-site-histories.js";
import { siteImages, type SiteImageDetail } from "./ghana-tour-site-images.js";
import { uniqueSiteImages } from "./ghana-tour-site-images-unique.js";

/**
 * The complete Ghana tour-site catalogue used by both the demo seed and the
 * targeted production sync script. Each entry carries the long-form history and
 * photo metadata needed by the destination detail page, and the mobility tier
 * is always derived from the region.
 *
 * Up to 4 images per site are selected from the siteImages gallery; if a site
 * has fewer than 4 images, only the available images are rendered. The
 * uniqueSiteImages overrides take precedence so shared fallback photos are not
 * reused across different destinations.
 */
export const tourSiteCatalogue: Prisma.TourSiteCreateInput[] = [
  ...baseTourSites,
  ...extraTourSites,
].map((site) => {
  const rawImage = uniqueSiteImages[site.name] ?? siteImages[site.name];
  const imageGallery: SiteImageDetail[] = Array.isArray(rawImage)
    ? rawImage
    : rawImage
      ? [rawImage]
      : [];
  const maxImages = 4;
  const selectedImages = imageGallery.slice(0, maxImages);
  return {
    ...site,
    history: siteHistories[site.name] ?? site.history ?? null,
    imageUrl: selectedImages.length > 0 ? selectedImages[0].url : (site.imageUrl ?? null),
    imageCredit: selectedImages.length > 0 ? selectedImages[0].credit : null,
    transit_profile: deriveTransitProfile(site.region),
  };
});
