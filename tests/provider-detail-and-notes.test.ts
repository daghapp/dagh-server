import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import type { Request, Response } from "express";
import { prisma } from "../src/config/index.js";
import { ProviderDetailController } from "../src/modules/provider-management/provider-detail.controller.js";
import { getStructuredTravelNotes } from "../src/helpers/transit-profile.js";
import { ApartmentType } from "../generated/prisma/client.js";

describe("Provider details and structured travel notes (§1 & §2 decision aids)", () => {
  let testProviderId: string;
  const controller = new ProviderDetailController();

  beforeAll(async () => {
    // Seed a verified hotel provider with rich media and description
    const p = await prisma.provider.create({
      data: {
        display_name: "Labadi Ocean Luxury Hotel",
        verification_status: true,
        media_assets: [
          "https://example.com/photos/labadi-front.jpg",
          "https://example.com/photos/labadi-pool.jpg",
        ],
        location_lat: 5.556,
        location_lng: -0.145,
        location_address: "Labadi Beach Road, Accra",
        avg_rating: 4.8,
        review_count: 34,
        bio_description: "A 4-star beachfront resort featuring private ocean terraces and fine dining.",
        hotel: {
          create: {
            apartment_type: ApartmentType.HOTEL,
            base_price_per_night: 1100,
          },
        },
      },
    });
    testProviderId = p.provider_id;
  });

  afterAll(async () => {
    if (testProviderId) {
      await prisma.hotel.deleteMany({ where: { provider_id: testProviderId } });
      await prisma.provider.deleteMany({ where: { provider_id: testProviderId } });
    }
  });

  function mockRequest(params: Record<string, string>) {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { json, status } as unknown as Response;
    const req = { params } as unknown as Request;
    return {
      run: () => controller.getProviderById(req, res),
      json,
      status,
    };
  }

  it("returns full details for an internal verified hotel provider", async () => {
    const { run, json } = mockRequest({ id: testProviderId });
    await run();

    const body = json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(testProviderId);
    expect(body.data.displayName).toBe("Labadi Ocean Luxury Hotel");
    expect(body.data.imageUrl).toBe("https://example.com/photos/labadi-front.jpg");
    expect(body.data.mediaAssets).toEqual([
      "https://example.com/photos/labadi-front.jpg",
      "https://example.com/photos/labadi-pool.jpg",
    ]);
    expect(body.data.bioDescription).toContain("beachfront resort");
    expect(body.data.locationAddress).toBe("Labadi Beach Road, Accra");
    expect(body.data.avgRating).toBe(4.8);
    expect(body.data.reviewCount).toBe(34);
    expect(body.data.type).toBe("hotel");
    expect(body.data.hotel.basePricePerNight).toBe(1100);
    expect(body.data.googleMapsUrl).toContain("Labadi%20Ocean%20Luxury%20Hotel");
  });

  it("returns 404 for a non-existent provider id", async () => {
    const { run, status } = mockRequest({ id: "non-existent-uuid" });
    await run();

    expect(status).toHaveBeenCalledWith(404);
  });

  it("provides structured travel notes with descriptions and practical tips", () => {
    const ruralNotes = getStructuredTravelNotes("RURAL");
    expect(ruralNotes.length).toBeGreaterThan(0);

    const trotroNote = ruralNotes.find((n) => n.title.includes("Trotro"));
    expect(trotroNote).toBeTruthy();
    expect(trotroNote?.description).toContain("shared minibus transport");
    expect(trotroNote?.tips.length).toBeGreaterThan(0);
    expect(trotroNote?.category).toBe("local_transit");

    const rentalNote = ruralNotes.find((n) => n.title.includes("Car Rental with Driver"));
    expect(rentalNote).toBeTruthy();
    expect(rentalNote?.category).toBe("car_rental");
    expect(rentalNote?.tips).toContain("Driver knows local terrain, shortcuts, and police checkpoints");

    const urbanNotes = getStructuredTravelNotes("URBAN_CENTER");
    const uberNote = urbanNotes.find((n) => n.title === "Uber");
    expect(uberNote).toBeTruthy();
    expect(uberNote?.category).toBe("ride_hailing");
  });
});
