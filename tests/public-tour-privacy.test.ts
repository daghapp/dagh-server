import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { prisma } from "../src/config/prisma.js";
import { UserTourController } from "../src/modules/tour-management/user-tour.controller.js";

describe("public tour detail privacy", () => {
  it("does not include bookings or customer information", async () => {
    const user = await prisma.user.create({
      data: {
        email: `tour-privacy-${randomUUID()}@example.com`,
        fullName: "Private Test Customer",
        authProvider: "EMAIL",
      },
    });
    let tourId: string | undefined;
    try {
      const tour = await prisma.tour_packages.create({
        data: { title: "Privacy test tour", status: "published", basePrice: 100 },
      });
      tourId = tour.id;
      await prisma.tour_bookings.create({
        data: {
          userId: user.id,
          tourId,
          bookingReference: randomUUID(),
          numberOfPeople: 1,
          tourStartDate: new Date("2030-01-01T00:00:00Z"),
          totalPrice: 100,
        },
      });
      const json = vi.fn();
      const res = { json, status: vi.fn().mockReturnThis() } as unknown as Response;
      const req = { params: { tourId } } as unknown as Request;
      await new UserTourController().getTourDetails(req, res);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ id: tourId, title: tour.title }),
        }),
      );
      const payload = json.mock.calls[0][0];
      expect(payload.data).not.toHaveProperty("bookings");
      expect(JSON.stringify(payload)).not.toContain(user.email);
      expect(JSON.stringify(payload)).not.toContain(user.fullName);
    } finally {
      if (tourId) await prisma.tour_packages.delete({ where: { id: tourId } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
