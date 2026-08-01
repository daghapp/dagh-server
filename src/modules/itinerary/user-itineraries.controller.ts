import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { getItineraryByRequestId } from "./itinerary.service.js";
import { ok, fail } from "../../helpers/response.js";

export async function getUserItineraries(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;

    if (!userId) {
      return fail(res, 401, "Unauthorized");
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
        return getItineraryByRequestId(r.id, userId);
      }),
    );

    return ok(res, itineraries, "Itineraries retrieved successfully.");
  } catch (error) {
    console.error("[getUserItineraries]", error);
    return fail(res, 500, "Failed to retrieve itineraries.");
  }
}
