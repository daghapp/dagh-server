import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { getItineraryByRequestId } from "./itinerary.service.js";


export async function getUserItineraries(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized", data: null });
    }

    // Load all tour requests for the user that are paid.
    // We then lazily generate itinerary per request if it doesn't exist.
    const paidRequests = await prisma.tourRequest.findMany({
      where: {
        userId,
        paymentStatus: "SUCCESS",
      },
      select: {
        id: true,
        paymentStatus: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const itineraries = await Promise.all(
      paidRequests.map(async (r) => {
        // getItineraryByRequestId handles: request-not-found, payment gating,
        // existing itinerary retrieval OR lazy generation.
        return getItineraryByRequestId(r.id);
      }),
    );

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


