import { describe, expect, it } from "vitest";
import { SiteCategory } from "../generated/prisma/client.js";
import {
  ACCRA_REGION,
  applyAccraGatewayConstraint,
  buildRegionDayGroups,
  clusterSitesIntoSessions,
  deriveDayTheme,
  deriveStartRegion,
  findRegionReentries,
  formatDayTitle,
  orderRegionsByLoop,
  type RoutableSite,
} from "../src/helpers/itinerary-routing.js";
import {
  planItinerary,
  buildItineraryDaysPayload,
} from "../src/modules/itinerary/itinerary.service.js";

function site(
  region: string,
  latitude: number,
  longitude: number,
  category: SiteCategory = SiteCategory.CULTURAL,
  name = `${region} Site`,
): RoutableSite {
  return { id: `${region}-${latitude}-${longitude}`, name, region, latitude, longitude, category };
}

const CENTRAL = () =>
  site("Central", 5.1031, -1.2425, SiteCategory.HISTORICAL, "Cape Coast Castle");
const KAKUM = () => site("Central", 5.35, -1.3833, SiteCategory.WILDLIFE, "Kakum National Park");
const ASHANTI = () => site("Ashanti", 6.7, -1.6167, SiteCategory.CULTURAL, "Manhyia Palace Museum");
const VOLTA = () => site("Volta", 7.0667, 0.6333, SiteCategory.NATURE, "Wli Waterfalls");
const ACCRA = () => site("Greater Accra", 5.5559, -0.1496, SiteCategory.BEACH, "Labadi Beach");

describe("orderRegionsByLoop", () => {
  it("anchors the cascade at the user-selected hub", () => {
    const order = orderRegionsByLoop("Central", [ASHANTI(), VOLTA(), ACCRA()]);
    expect(order[0]).toBe("Central");
    expect(order).toContain("Ashanti");
    expect(order).toContain("Volta");
    expect(order).toContain("Greater Accra");
  });

  it("honours a non-default hub (Volta)", () => {
    const order = orderRegionsByLoop("Volta", [CENTRAL(), ASHANTI(), ACCRA()]);
    expect(order[0]).toBe("Volta");
  });

  it("visits every distinct region exactly once", () => {
    const sites = [CENTRAL(), KAKUM(), ASHANTI(), VOLTA(), ACCRA()];
    const order = orderRegionsByLoop("Central", sites);
    expect(new Set(order).size).toBe(order.length);
    expect(order.filter((r) => r === "Central")).toHaveLength(1);
  });
});

describe("deriveStartRegion", () => {
  it("honours an explicit hub even when no selected site is in that region", () => {
    expect(deriveStartRegion([ASHANTI(), VOLTA()], "Central")).toBe("Central");
  });

  it("infers the most frequently selected region when no hub is supplied", () => {
    const sites = [ASHANTI(), site("Ashanti", 6.8, -1.7), VOLTA()];
    expect(deriveStartRegion(sites)).toBe("Ashanti");
  });

  it("never falls back to Central when the selection is elsewhere", () => {
    const sites = [ASHANTI(), VOLTA(), ACCRA()];
    const hub = deriveStartRegion(sites);
    expect(hub).not.toBe("Central");
    expect(sites.map((s) => s.region)).toContain(hub);
  });

  it("falls back to the default hub only for an empty selection", () => {
    expect(deriveStartRegion([])).toBe("Central");
  });
});

describe("zero-backtracking guard", () => {
  it("flags a region that leaves and re-enters", () => {
    expect(findRegionReentries(["Central", "Ashanti", "Central"])).toEqual(["Central"]);
  });

  it("accepts a contiguous regional cascade", () => {
    expect(findRegionReentries(["Central", "Central", "Ashanti", "Volta", "Volta"])).toEqual([]);
  });

  it("never produces re-entries when grouping a loop plan", () => {
    const sites = [CENTRAL(), KAKUM(), ASHANTI(), VOLTA(), ACCRA(), site("Eastern", 6.3, 0.06)];
    const order = orderRegionsByLoop("Central", sites);
    const groups = buildRegionDayGroups(order, sites, { maxPerDay: 3, maxKm: 250 });
    expect(findRegionReentries(groups.map((g) => g.region))).toEqual([]);
  });
});

describe("Accra gateway constraint", () => {
  it("moves Accra to the departure gateway when not the hub and not opted in", () => {
    const constrained = applyAccraGatewayConstraint(
      ["Central", ACCRA_REGION, "Volta"],
      "Central",
      false,
    );
    expect(constrained).toEqual(["Central", "Volta", ACCRA_REGION]);
  });

  it("leaves the cascade untouched when the traveller opts in", () => {
    const original = ["Central", ACCRA_REGION, "Volta"];
    expect(applyAccraGatewayConstraint(original, "Central", true)).toEqual(original);
  });

  it("leaves the cascade untouched when Accra is the hub", () => {
    const original = [ACCRA_REGION, "Central", "Volta"];
    expect(applyAccraGatewayConstraint(original, ACCRA_REGION, false)).toEqual(original);
  });
});

describe("descriptive day headers", () => {
  it("renders arrival, themed touring and departure labels", () => {
    expect(formatDayTitle(1, deriveDayTheme({ dayType: "PREPARATION", region: "Central" }))).toBe(
      "Day 1: Arrival & Orientation (Central Region)",
    );
    expect(
      formatDayTitle(
        3,
        deriveDayTheme({ dayType: "TOURING", region: "Central", sites: [KAKUM(), CENTRAL()] }),
      ),
    ).toBe("Day 3: Canopy Walk & Coastal Heritage (Central Region)");
    expect(
      formatDayTitle(9, deriveDayTheme({ dayType: "DEPARTURE", region: "Greater Accra" })),
    ).toBe("Day 9: Departure & Farewell (Greater Accra Region)");
  });

  it("falls back to a leisure label for a touring day without sites", () => {
    expect(deriveDayTheme({ dayType: "TOURING", region: "Volta", sites: [] })).toBe(
      "Leisure & Free Exploration (Volta Region)",
    );
  });
});

describe("clusterSitesIntoSessions", () => {
  it("caps a day at three sites", () => {
    const sites = [
      site("Central", 5.1, -1.24),
      site("Central", 5.11, -1.25),
      site("Central", 5.12, -1.26),
      site("Central", 5.13, -1.27),
    ];
    const sessions = clusterSitesIntoSessions(sites, 3, 250);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toHaveLength(3);
    expect(sessions[1]).toHaveLength(1);
  });
});

describe("planItinerary Accra stay limiter", () => {
  const accraSites = Array.from({ length: 7 }, (_, i) =>
    site("Greater Accra", 5.55 + i * 0.01, -0.15 - i * 0.01, SiteCategory.BEACH, `Accra ${i}`),
  );

  it("blocks an itinerary needing more than two Accra nights by default", () => {
    const plan = planItinerary(accraSites, "Central", 10, false);
    expect(plan.feasible).toBe(false);
    expect(plan.accraNights).toBeGreaterThan(2);
    expect(plan.error).toContain("allowAccraOvernight");
  });

  it("allows it but flags a warning when the traveller opts in", () => {
    const plan = planItinerary(accraSites, "Central", 10, true);
    expect(plan.feasible).toBe(true);
    expect(plan.accraNights).toBeGreaterThan(2);
    expect(plan.warnings.join(" ")).toContain("Greater Accra");
  });

  it("keeps a normal coastal loop within the two-night cap", () => {
    const plan = planItinerary(
      [CENTRAL(), KAKUM(), ASHANTI(), VOLTA(), ACCRA()],
      "Central",
      6,
      false,
    );
    expect(plan.feasible).toBe(true);
    expect(plan.accraNights).toBeLessThanOrEqual(2);
    expect(plan.orderedRegions[0]).toBe("Central");
    expect(plan.orderedRegions[plan.orderedRegions.length - 1]).toBe("Greater Accra");
  });
});

describe("buildItineraryDaysPayload", () => {
  it("threads region + descriptive titles through every day", () => {
    const plan = planItinerary(
      [CENTRAL(), KAKUM(), ASHANTI(), VOLTA(), ACCRA()],
      "Central",
      6,
      false,
    );
    const days = buildItineraryDaysPayload(plan, 6);

    expect(days[0].title).toMatch(/^Day 1: Arrival & Orientation/);
    expect(days[0].region).toBe("Central");

    const departure = days[days.length - 1];
    expect(departure.dayNumber).toBe(8);
    expect(departure.title).toMatch(/^Day 8: Departure & Farewell/);

    const titledTouringDays = days.filter(
      (d) => d.dayType === "TOURING" && d.sites && d.sites.create.length > 0,
    );
    expect(titledTouringDays.length).toBeGreaterThan(0);
    for (const day of titledTouringDays) {
      expect(day.title).toMatch(/^Day \d+: .+ \([A-Za-z ]+Region\)$/);
      expect(day.region).toBeTruthy();
    }
  });
});
