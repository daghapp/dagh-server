import { Request, Response } from "express";
import { prisma } from "../../config/index.js";

export async function getUserItineraries(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized", data: null });
    }

    const itineraries = await prisma.itinerary.findMany({
      orderBy: { createdAt: "desc" },
      where: {
        tourRequest: {
          userId,
        },
      },
      include: {
        tourRequest: {
          select: {
            id: true,
            durationDays: true,
            paymentStatus: true,
          },
        },
        days: {
          orderBy: { dayNumber: "asc" },
          include: {
            sites: {
              orderBy: { visitOrder: "asc" },
              include: {
                tourSite: true,
              },
            },
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: "Itineraries retrieved successfully.",
      data: itineraries,
    });
  } catch (error) {
    console.error("[getUserItineraries]", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve itineraries.",
      data: null,
    });
  }
}

