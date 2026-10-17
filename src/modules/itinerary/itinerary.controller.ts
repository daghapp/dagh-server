import { Request, Response } from "express";
import {
  createTourRequest,
  getAllTourSites,
  getItineraryByRequestId,
  getTourRequestsByUserId,
  selectDatingProfilesForTour,
  getDatingSelectionsForTour,
  selectDayTransport,
} from "./itinerary.service.js";
import { createTourRequestSchema } from "../../validator/itinerary-validator.js";
import {
  requireKYCVerification,
  KYCVerificationError,
} from "../../services/kyc-verification.service.js";

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

    // Step 2 — Verification gate: casual-dating unlocks only for KYC-verified users.
    // If the user opted into casual dating but is not fully verified, block with 403
    // and prompt them to complete verification before the dating module can proceed.
    if (parsed.data.casualDatingInterest) {
      try {
        await requireKYCVerification(req.user?.id as string);
      } catch (error) {
        if (error instanceof KYCVerificationError) {
          return fail(
            res,
            error.statusCode,
            {
              code: error.code,
              message: error.message,
              nextStep: error.currentStep,
              completedSteps: error.details?.completedSteps,
              requiredSteps: error.details?.requiredSteps,
            },
            {
              action: "COMPLETE_VERIFICATION",
              redirect: "/verification",
            },
          );
        }
        console.error("[postTourRequest][KYC]", error);
        return fail(res, 500, "Failed to verify identity for casual dating.");
      }
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

    const itinerary = await getItineraryByRequestId(tourRequestId, req.user?.id as string);

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
    if (code === "FORBIDDEN") status = 403;
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

// ─────────────────────────────────────────
// POST /itinerary/{tourRequestId}/dating-selections
// Select recommended dating profiles to merge into the itinerary as social blocks.
// ─────────────────────────────────────────
export async function selectDatingProfiles(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;
    const tourRequestId = req.params["tourRequestId"] as string;

    const body = req.body as { userIds?: string[] };
    const userIds = Array.isArray(body.userIds) ? body.userIds : [];

    if (!tourRequestId) return fail(res, 400, "Tour request ID is required.");
    if (!userIds.length) return fail(res, 400, "Select at least one dating profile.");

    // Dating features are gated behind KYC verification.
    try {
      await requireKYCVerification(userId);
    } catch (error) {
      if (error instanceof KYCVerificationError) {
        return fail(
          res,
          error.statusCode,
          {
            code: error.code,
            message: error.message,
            nextStep: error.currentStep,
            completedSteps: error.details.completedSteps,
            requiredSteps: error.details.requiredSteps,
          },
          { action: "COMPLETE_VERIFICATION", redirect: "/verification" },
        );
      }
      console.error("[selectDatingProfiles][KYC]", error);
      return fail(res, 500, "Failed to verify identity for casual dating.");
    }

    const selections = await selectDatingProfilesForTour(tourRequestId, userId, userIds);
    return ok(res, { selections }, "Dating selections saved to your itinerary.");
  } catch (error) {
    console.error("[selectDatingProfiles]", error);
    const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    if (code === "TOUR_REQUEST_NOT_FOUND") return fail(res, 404, "Tour request not found.");
    if (code === "FORBIDDEN") return fail(res, 403, "Not allowed.");
    if (code === "NO_VALID_DATING_PROFILES")
      return fail(res, 400, "None of the selected profiles have a dating profile.");
    return fail(res, 500, "Failed to save dating selections.");
  }
}

// ─────────────────────────────────────────
// GET /itinerary/{tourRequestId}/dating-selections
// List the dating profiles already merged into a tour's itinerary.
// ─────────────────────────────────────────
export async function getItineraryDatingSelections(req: Request, res: Response) {
  try {
    const tourRequestId = req.params["tourRequestId"] as string;
    if (!tourRequestId) return fail(res, 400, "Tour request ID is required.");

    const request = await prisma.tourRequest.findUnique({
      where: { id: tourRequestId },
      select: { userId: true },
    });
    if (!request) return fail(res, 404, "Tour request not found.");
    if (request.userId !== req.user?.id) return fail(res, 403, "Not allowed.");

    const selections = await getDatingSelectionsForTour(tourRequestId);
    return ok(res, { selections }, "Dating selections retrieved successfully.");
  } catch (error) {
    console.error("[getItineraryDatingSelections]", error);
    return fail(res, 500, "Failed to retrieve dating selections.");
  }
}

// ─────────────────────────────────────────
// POST /itinerary/{tourRequestId}/days/{dayNumber}/transport
// Confirm (or clear) the car rental for one itinerary day.
// ─────────────────────────────────────────
export async function selectDayTransportHandler(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;
    const tourRequestId = req.params["tourRequestId"] as string;
    const dayNumber = Number(req.params["dayNumber"]);

    if (!tourRequestId) return fail(res, 400, "Tour request ID is required.");
    if (!Number.isInteger(dayNumber) || dayNumber < 1) {
      return fail(res, 400, "dayNumber must be a positive integer.");
    }

    const body = req.body as { providerId?: string | null };
    if (!("providerId" in body)) {
      return fail(res, 400, "providerId is required (send null to clear the selection).");
    }

    const rawProviderId = body.providerId ?? null;
    if (rawProviderId !== null && typeof rawProviderId !== "string") {
      return fail(res, 400, "providerId must be a string or null.");
    }

    const result = await selectDayTransport(tourRequestId, dayNumber, userId, rawProviderId);

    return ok(
      res,
      result,
      rawProviderId
        ? "Car rental saved to your itinerary day."
        : "Car rental cleared for this itinerary day.",
    );
  } catch (error) {
    console.error("[selectDayTransport]", error);
    const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    if (code === "TOUR_REQUEST_NOT_FOUND") return fail(res, 404, "Tour request not found.");
    if (code === "FORBIDDEN") return fail(res, 403, "Not allowed.");
    if (code === "ITINERARY_NOT_FOUND") return fail(res, 404, "Itinerary not found.");
    if (code === "ITINERARY_DAY_NOT_FOUND") return fail(res, 404, "Itinerary day not found.");
    if (code === "DAY_NOT_TOURING") {
      return fail(res, 400, "Car rentals can only be selected for touring days.");
    }
    if (code === "INVALID_TRANSPORT_PROVIDER") {
      return fail(res, 400, "The selected provider is not a verified car rental.");
    }
    return fail(res, 500, "Failed to save the car rental selection.");
  }
}
