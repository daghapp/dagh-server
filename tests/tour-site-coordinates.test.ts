import { describe, expect, it } from "vitest";
import { tourSiteCatalogue } from "../src/seed-data/tour-catalogue.js";
import { siteCoordinateOverrides } from "../src/seed-data/tour-site-coordinates.js";

describe("tour site coordinates", () => {
  it("gives every catalogue site its own map point", () => {
    const points = tourSiteCatalogue.map((site) => `${site.latitude},${site.longitude}`);

    expect(new Set(points).size).toBe(points.length);
  });

  it("applies every precise-coordinate override", () => {
    const byName = new Map(tourSiteCatalogue.map((site) => [site.name, site]));

    for (const [name, coordinates] of Object.entries(siteCoordinateOverrides)) {
      const site = byName.get(name);
      expect(site, `missing catalogue site: ${name}`).toBeDefined();
      expect(site?.latitude).toBe(coordinates.latitude);
      expect(site?.longitude).toBe(coordinates.longitude);
    }
  });
});
