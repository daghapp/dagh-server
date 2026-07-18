import { Request, Response } from "express";
import {
  createTourRequest,
  getAllTourSites,
  getItineraryByRequestId,
  getTourRequestsByUserId,
} from "./itinerary.service.js";
import { createTourRequestSchema } from "../../validator/itinerary-validator.js";

import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";

// ─────────────────────────────────────────
// GET /api/tours/sites
// ─────────────────────────────────────────
export async function getTourSites(_req: Request, res: Response) {
  try {
    const sites = await getAllTourSites();
    return ok(res, sites, "Tour sites retrieved successfully.");
  } catch (error) {
    console.error("[getTourSites]", error);
    return fail(res, 500, "Failed to retrieve tour sites.");
  }
}

// ─────────────────────────────────────────
// POST /api/tours/request
// ─────────────────────────────────────────
export async function postTourRequest(req: Request, res: Response) {
  try {
    const parsed = createTourRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      }));
      return res.status(400).json({
        success: false,
        error: "Validation failed. Please check your request.",
        details: errors,
      });
    }

    const result = await createTourRequest({ ...parsed.data, userId: req.user?.id as string });

    // Feasibility failure — valid request but unworkable plan
    if (!result.success) {
      return res.status(422).json(result);
    }

    // If feasible, frontend needs price before initiating payment
    if (result.success && result.data?.itinerary === null) {
      const durationDays = parsed.data.durationDays;
      const price = durationDays <= 4 ? 350 : 500;

      return res.status(201).json({
        ...result,
        price,
      });
    }

    return res.status(201).json(result);
  } catch (error) {
    console.error("[postTourRequest]", error);
    return fail(res, 500, "An unexpected error occurred while generating your itinerary.");
  }
}

// ─────────────────────────────────────────
// GET /api/tours/itinerary/:tourRequestId
// ─────────────────────────────────────────
export async function getItinerary(req: Request, res: Response) {
  try {
    const tourRequestId = req.params["tourRequestId"] as string;

    if (!tourRequestId) {
      return fail(res, 400, "Tour request ID is required.");
    }

    const itinerary = await getItineraryByRequestId(tourRequestId);

    if (!itinerary) {
      return fail(res, 404, "No itinerary found for this tour request.");
    }

    const tourRequest = await prisma.tourRequest.findUnique({
      where: { id: tourRequestId },
      select: {
        id: true,
        userId: true,
        tourType: true,
        durationDays: true,
        paymentStatus: true,
        paymentId: true,
        status: true,
        // primaryPlaceOfStay: true,
        // proofOfAccommodationUrl: true,

        relocationInterest: true,

        createdAt: true,

        // updatedAt: true,
        selectedSites: {
          include: {
            tourSite: true,
          },
        },
      },
    });

    const durationDays = itinerary.totalDays - 2;
    const price = durationDays <= 4 ? 350 : 500;

    return ok(
      res,
      {
        itinerary,
        request: tourRequest,
        price: itinerary.isFeasible ? price : null,
      },
      "Itinerary retrieved successfully.",
    );
  } catch (error) {
    console.error("[getItinerary]", error);

    const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    let status = 500;
    if (code === "TOUR_REQUEST_NOT_FOUND") status = 404;
    if (code === "PAYMENT_REQUIRED") status = 403;
    if (code === "ITINERARY_NOT_FEASIBLE") status = 400;
    if (code === "NO_SITES_FOR_ITINERARY") status = 400;

    return fail(res, status, code);
  }
}

export async function getUserTourRequests(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;

    if (!userId) {
      return fail(res, 401, "Unauthorized");
    }

    const requests = await getTourRequestsByUserId(userId);

    return ok(res, requests, "Tour requests retrieved successfully.");
  } catch (error) {
    console.error("[getUserTourRequests]", error);
    return fail(res, 500, "Failed to retrieve tour requests.");
  }
}
