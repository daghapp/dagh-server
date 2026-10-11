import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/prisma.js";
import {
  createTourRequest,
  getItineraryByRequestId,
} from "../src/modules/itinerary/itinerary.service.js";
import { AuthProvider, AccountType } from "../generated/prisma/client.js";
import { findRegionReentries } from "../src/helpers/itinerary-routing.js";

/**
 * End-to-end correction checks against the seeded tour sites:
 *  - the loop anchors at the user-selected hub,
 *  - Greater Accra lands on the departure gateway (no mid-trip backtracking),
 *  - the Accra stay limiter holds,
 *  - every day carries a descriptive header + region.
 */
describe("loop-based itinerary generation (integration)", () => {
  const stamp = Date.now();
  let userId: string;
  let tourRequestId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `loop-itinerary-${stamp}@example.com`,
        fullName: "Loop Itinerary Tester",
        accountType: AccountType.USER,
        authProvider: AuthProvider.EMAIL,
      },
    });
    userId = user.id;

    const wanted = ["Cape Coast Castle", "Manhyia Palace Museum", "Wli Waterfalls", "Labadi Beach"];
    const sites = await prisma.tourSite.findMany({ where: { name: { in: wanted } } });
    const tourSiteIds = sites.map((s) => s.id);
    expect(tourSiteIds).toHaveLength(wanted.length);

    const created = await createTourRequest({
      userId,
      tourSiteIds,
      tourType: "SINGLE",
      durationDays: 6,
      startRegion: "Central",
      allowAccraOvernight: false,
      relocationInterest: false,
      companionInterest: false,
      casualDatingInterest: false,
    });

    expect(created.success).toBe(true);
    tourRequestId = created.data!.tourRequestId;

    // Unlock the itinerary without going through the payment gateway.
    await prisma.tourRequest.update({
      where: { id: tourRequestId },
      data: { paymentStatus: "SUCCESS", feeWaived: true },
    });
  });

  afterAll(async () => {
    await prisma.tourRequest.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("anchors at the chosen hub and completes the loop without re-entry", async () => {
    const itinerary = await getItineraryByRequestId(tourRequestId, userId);

    expect(itinerary.isFeasible).toBe(true);
    expect(itinerary.routeRegions[0]).toBe("Central");
    expect(itinerary.routeRegions).toContain("Ashanti");
    expect(itinerary.routeRegions).toContain("Volta");
    // Accra is the departure gateway, not a mid-trip stop.
    expect(itinerary.routeRegions[itinerary.routeRegions.length - 1]).toBe("Greater Accra");

    const touringRegions = itinerary.days
      .filter((d) => d.dayType === "TOURING" && d.sites.length > 0)
      .map((d) => d.region);
    expect(findRegionReentries(touringRegions)).toEqual([]);
  });

  it("keeps Greater Accra within the two-night cap", async () => {
    const itinerary = await getItineraryByRequestId(tourRequestId, userId);
    expect(itinerary.accraNights).toBeLessThanOrEqual(2);
  });

  it("renders informative day headers instead of numeric tags", async () => {
    const itinerary = await getItineraryByRequestId(tourRequestId, userId);

    expect(itinerary.totalDays).toBe(8);
    expect(itinerary.days).toHaveLength(8);

    const first = itinerary.days[0];
    expect(first.dayType).toBe("PREPARATION");
    expect(first.title).toMatch(/^Day 1: Arrival & Orientation \(.+Region\)$/);
    expect(first.region).toBe("Central");

    const last = itinerary.days[itinerary.days.length - 1];
    expect(last.dayType).toBe("DEPARTURE");
    expect(last.title).toMatch(/^Day 8: Departure & Farewell/);

    for (const day of itinerary.days.filter((d) => d.sites.length > 0)) {
      expect(day.title).toMatch(/^Day \d+: .+/);
      expect(day.region).toBeTruthy();
      // Never a bare "Day X - Touring" style label.
      expect(day.title).not.toMatch(/touring/i);
    }
  });

  it("allocates local accommodation/transport per day region", async () => {
    const itinerary = await getItineraryByRequestId(tourRequestId, userId);
    // Shape is present on every day (values may be null when no verified supply).
    for (const day of itinerary.days) {
      expect(day).toHaveProperty("localAccommodation");
      expect(day).toHaveProperty("localTransport");
    }
  });
});
