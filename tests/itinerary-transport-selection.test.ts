import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { prisma } from "../src/config/prisma.js";
import {
  createTourRequest,
  getItineraryByRequestId,
  selectDayTransport,
} from "../src/modules/itinerary/itinerary.service.js";
import { ProviderNearbyRentalsController } from "../src/modules/provider-management/provider-nearby-rentals.controller.js";
import { AuthProvider, AccountType } from "../generated/prisma/client.js";

/**
 * Per-day car rental selection.
 *
 * The itinerary used to only *recommend* transport (available_transports +
 * per-day localTransport) with no way for the traveller to commit to one. These
 * checks cover the confirmation path: a verified rental can be attached to a
 * day, is echoed back as `selectedTransport` with the fleet/price detail the
 * frontend needs, can be cleared, and rejects anything that is not verified
 * car-rental supply.
 */
describe("itinerary per-day car rental selection", () => {
  const stamp = Date.now();
  let userId: string;
  let tourRequestId: string;
  let rentalProviderId: string;
  let nonRentalProviderId: string;
  let accraSiteId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `transport-selection-${stamp}@example.com`,
        fullName: "Transport Selection Tester",
        accountType: AccountType.USER,
        authProvider: AuthProvider.EMAIL,
      },
    });
    userId = user.id;

    const wanted = ["Cape Coast Castle", "Manhyia Palace Museum", "Wli Waterfalls", "Labadi Beach"];
    const sites = await prisma.tourSite.findMany({ where: { name: { in: wanted } } });
    expect(sites).toHaveLength(wanted.length);
    accraSiteId = sites.find((s) => s.name === "Labadi Beach")!.id;

    const created = await createTourRequest({
      userId,
      tourSiteIds: sites.map((s) => s.id),
      tourType: "SINGLE",
      durationDays: 6,
      startRegion: "Central",
      allowAccraOvernight: false,
      relocationInterest: false,
      companionInterest: false,
      casualDatingInterest: false,
      transportType: "RENTED_VEHICLE",
    });
    expect(created.success).toBe(true);
    tourRequestId = created.data!.tourRequestId;

    await prisma.tourRequest.update({
      where: { id: tourRequestId },
      data: { paymentStatus: "SUCCESS", feeWaived: true },
    });

    const rental = await prisma.provider.findFirst({
      where: { display_name: "DAGH Rentals" },
      select: { provider_id: true },
    });
    expect(rental).toBeTruthy();
    rentalProviderId = rental!.provider_id;

    const guide = await prisma.provider.findFirst({
      where: { display_name: "Kojo Asante — Tour Guide" },
      select: { provider_id: true },
    });
    expect(guide).toBeTruthy();
    nonRentalProviderId = guide!.provider_id;

    // Generate the itinerary so days exist to attach a rental to.
    await getItineraryByRequestId(tourRequestId, userId);
  });

  afterAll(async () => {
    await prisma.tourRequest.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("exposes rich car-rental detail on available_transports", async () => {
    const itinerary = await getItineraryByRequestId(tourRequestId, userId);
    expect(itinerary.available_transports.length).toBeGreaterThan(0);

    const first = itinerary.available_transports[0];
    expect(first.transportType).toBe("RENTED_VEHICLE");
    expect(first.vehicleMake).toBeTruthy();
    expect(first.vehicleModel).toBeTruthy();
    expect(typeof first.dailyRate).toBe("number");
    expect(typeof first.driverRequired).toBe("boolean");
  });

  it("persists a selection and echoes it back as selectedTransport", async () => {
    const saved = await selectDayTransport(tourRequestId, 2, userId, rentalProviderId);
    expect(saved).toEqual({ dayNumber: 2, transportProviderId: rentalProviderId });

    const itinerary = await getItineraryByRequestId(tourRequestId, userId);
    const day = itinerary.days.find((d) => d.dayNumber === 2)!;

    expect(day.selectedTransport).not.toBeNull();
    expect(day.selectedTransport!.id).toBe(rentalProviderId);
    expect(day.selectedTransport!.transportType).toBe("RENTED_VEHICLE");
    expect(day.selectedTransport!.dailyRate).toBeGreaterThan(0);

    // Other days stay untouched.
    const day3 = itinerary.days.find((d) => d.dayNumber === 3)!;
    expect(day3.selectedTransport).toBeNull();
  });

  it("clears the selection when providerId is null", async () => {
    await selectDayTransport(tourRequestId, 2, userId, null);

    const itinerary = await getItineraryByRequestId(tourRequestId, userId);
    const day = itinerary.days.find((d) => d.dayNumber === 2)!;
    expect(day.selectedTransport).toBeNull();

    // Falls back to the recommendation rather than going blank.
    expect(day.localTransport).not.toBeNull();
  });

  it("rejects a provider that is not a verified car rental", async () => {
    await expect(selectDayTransport(tourRequestId, 2, userId, nonRentalProviderId)).rejects.toThrow(
      "INVALID_TRANSPORT_PROVIDER",
    );
  });

  it("rejects a day that does not exist on the itinerary", async () => {
    await expect(selectDayTransport(tourRequestId, 999, userId, rentalProviderId)).rejects.toThrow(
      "ITINERARY_DAY_NOT_FOUND",
    );
  });

  it("rejects the preparation and departure days", async () => {
    // Day 1 is PREPARATION; the last day (durationDays + 2) is DEPARTURE.
    const itinerary = await getItineraryByRequestId(tourRequestId, userId);
    const first = itinerary.days[0]!;
    const last = itinerary.days[itinerary.days.length - 1]!;
    expect(first.dayType).toBe("PREPARATION");
    expect(last.dayType).toBe("DEPARTURE");

    await expect(
      selectDayTransport(tourRequestId, first.dayNumber, userId, rentalProviderId),
    ).rejects.toThrow("DAY_NOT_TOURING");
    await expect(
      selectDayTransport(tourRequestId, last.dayNumber, userId, rentalProviderId),
    ).rejects.toThrow("DAY_NOT_TOURING");
  });

  it("rejects a request that belongs to someone else", async () => {
    await expect(
      selectDayTransport(
        tourRequestId,
        2,
        "00000000-0000-0000-0000-000000000000",
        rentalProviderId,
      ),
    ).rejects.toThrow("FORBIDDEN");
  });

  describe("GET /providers/nearby-rentals", () => {
    const controller = new ProviderNearbyRentalsController();

    function call(query: Record<string, string>) {
      const json = vi.fn();
      const status = vi.fn(() => ({ json }));
      const res = { json, status } as unknown as Response;
      const req = { query } as unknown as Request;
      return { json, status, run: () => controller.getNearbyRentals(req, res) };
    }

    it("returns verified rentals with fleet and pricing detail", async () => {
      const { run, json } = call({ tourSiteId: accraSiteId, radiusKm: "50" });
      await run();

      const body = json.mock.calls[0][0];
      expect(body.success).toBe(true);
      expect(body.data.rentals.length).toBeGreaterThan(0);
      const rental = body.data.rentals.find((r: { id: string }) => r.id === rentalProviderId);
      expect(rental).toBeTruthy();
      expect(rental.vehicleModel).toBeTruthy();
      expect(rental.dailyRate).toBeGreaterThan(0);
    });

    it("prefers exact-type matches when supply exists", async () => {
      const { run, json } = call({
        tourSiteId: accraSiteId,
        transportType: "RENTED_VEHICLE",
      });
      await run();

      const body = json.mock.calls[0][0];
      expect(body.data.matchedType).toBe(true);
      expect(
        body.data.rentals.every(
          (r: { transportType: string }) => r.transportType === "RENTED_VEHICLE",
        ),
      ).toBe(true);
    });

    it("flags a type fallback instead of returning nothing", async () => {
      // NONE has no provider supply, so the endpoint must fall back to the
      // closest rentals of any type and tell the client it did.
      const { run, json } = call({
        tourSiteId: accraSiteId,
        transportType: "NONE",
      });
      await run();

      const body = json.mock.calls[0][0];
      expect(body.data.matchedType).toBe(false);
      expect(body.data.rentals.length).toBeGreaterThan(0);
    });

    it("requires a tourSiteId", async () => {
      const { run, status } = call({});
      await run();
      expect(status).toHaveBeenCalledWith(400);
    });
  });
});
