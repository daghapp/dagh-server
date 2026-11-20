import { describe, expect, it } from "vitest";
import { tourSiteCatalogue } from "../src/seed-data/tour-catalogue.js";
import { uniqueSiteImages } from "../src/seed-data/ghana-tour-site-images-unique.js";

describe("tour site images", () => {
  it("gives every catalogue site its own image", () => {
    const images = tourSiteCatalogue
      .map((site) => site.imageUrl)
      .filter((url): url is string => Boolean(url));

    expect(images).toHaveLength(tourSiteCatalogue.length);
    expect(new Set(images).size).toBe(images.length);
  });

  it("applies every unique-image override", () => {
    const byName = new Map(tourSiteCatalogue.map((site) => [site.name, site]));

    for (const [name, image] of Object.entries(uniqueSiteImages)) {
      const site = byName.get(name);
      expect(site, `missing catalogue site: ${name}`).toBeDefined();
      expect(site?.imageUrl).toBe(image.url);
      expect(site?.imageCredit).toBe(image.credit);
    }
  });
});
