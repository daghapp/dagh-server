//get all tours
//get tours user has booked
//book a tour by user
//cancel a tour booking by user
//update tour by admin
//delete tour by admin
//create tour by admin
//create tour itinerary by admin
//update tour itinerary by admin
//delete tour itinerary by admin
//delete tour itinerary by admin
//tour media management by admin
// user has paid for a tour
//assign tour guide to a tour by admin
//unassign tour guide from a tour by admin

//add tour review by user
//get tour reviews by tour id
//get tour reviews by user id
//delete tour review by user

import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { prisma } from "../../config/index.js";
import { TourSchema, UpdateTourSchema, TourItinerarySchema } from "../../validator/index.js";
import { ok, created, fail } from "../../helpers/response.js";

const isPrismaNotFoundError = (error: unknown): error is { code: string } => {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  );
};

const ensureAdmin = (req: Request, res: Response) => {
  const accountType = req.user?.accountType;

  if (!accountType || accountType.toUpperCase() !== "ADMIN") {
    return fail(res, 403, "Forbidden: Admins only");
  }

  return null;
};

export class AdminTourController {
  // Create a new tour
  async createTour(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const tourData = req.body as TourSchema;
      const newTour = await prisma.tour_packages.create({
        data: tourData,
      });
      return created(res, newTour, "Tour created successfully");
    } catch (error) {
      console.error("Error creating tour:", error);
      return fail(res, 500, "Failed to create tour");
    }
  }

  // Update an existing tour
  async updateTour(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const tourId = req.params.id as string;
      const tourData = req.body as UpdateTourSchema;
      const updatedTour = await prisma.tour_packages.update({
        where: { id: tourId },
        data: tourData,
      });
      return ok(res, updatedTour, "Tour updated successfully");
    } catch (error) {
      if (isPrismaNotFoundError(error)) {
        return fail(res, 404, "Tour not found");
      }
      console.error("Error updating tour:", error);
      return fail(res, 500, "Failed to update tour");
    }
  }

  //delete a tour
  async deleteTour(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const tourId = req.params.id as string;
      await prisma.tour_packages.delete({
        where: { id: tourId },
      });
      return ok(res, null as never, "Tour deleted successfully");
    } catch (error) {
      if (isPrismaNotFoundError(error)) {
        return fail(res, 404, "Tour not found");
      }
      console.error("Error deleting tour:", error);
      return fail(res, 500, "Failed to delete tour");
    }
  }

  //add tour itinerary by admin
  async addTourItinerary(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const tourId = req.params.id as string;
      const itineraryData = req.body as TourItinerarySchema;
      const { activities, ...itineraryFields } = itineraryData;

      // Check if the tour exists before adding itinerary
      const tour = await prisma.tour_packages.findUnique({
        where: { id: tourId },
      });
      if (!tour) {
        return fail(res, 404, "Tour not found");
      }
      const newItinerary = await prisma.tour_itineraries.create({
        data: {
          ...itineraryFields,
          tourId,
          itinerary_activities: activities?.length
            ? {
                create: activities.map((activity) => ({
                  id: randomUUID(),
                  activityTime: activity.activityTime,
                  activity: activity.activity,
                  durationMinutes: activity.durationMinutes,
                  included: activity.included,
                  cost: activity.cost,
                  locationName: activity.locationName,
                  locationAddress: activity.locationAddress,
                })),
              }
            : undefined,
        },
        include: { itinerary_activities: true },
      });
      return created(res, newItinerary, "Tour itinerary added successfully");
    } catch (error) {
      console.error("Error adding tour itinerary:", error);
      return fail(res, 500, "Failed to add tour itinerary");
    }
  }

  //update tour itinerary by admin
  async updateTourItinerary(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const itineraryId = req.params.id as string;
      const itineraryData = req.body as TourItinerarySchema;
      const { activities, ...itineraryFields } = itineraryData;

      const updatedItinerary = await prisma.$transaction(async (tx) => {
        const updated = await tx.tour_itineraries.update({
          where: { id: itineraryId },
          data: itineraryFields,
        });

        if (activities !== undefined) {
          await tx.itinerary_activities.deleteMany({
            where: { itineraryId },
          });

          if (activities.length > 0) {
            await tx.itinerary_activities.createMany({
              data: activities.map((activity) => ({
                id: randomUUID(),
                itineraryId,
                activityTime: activity.activityTime,
                activity: activity.activity,
                durationMinutes: activity.durationMinutes,
                included: activity.included,
                cost: activity.cost,
                locationName: activity.locationName,
                locationAddress: activity.locationAddress,
              })),
            });
          }
        }

        const itineraryWithActivities = await tx.tour_itineraries.findUnique({
          where: { id: itineraryId },
          include: { itinerary_activities: true },
        });

        return itineraryWithActivities ?? updated;
      });

      return ok(res, updatedItinerary, "Tour itinerary updated successfully");
    } catch (error) {
      if (isPrismaNotFoundError(error)) {
        return fail(res, 404, "Itinerary not found");
      }
      console.error("Error updating tour itinerary:", error);
      return fail(res, 500, "Failed to update tour itinerary");
    }
  }

  //delete tour itinerary by admin
  async deleteTourItinerary(req: Request, res: Response) {
    try {
      const unauthorizedResponse = ensureAdmin(req, res);
      if (unauthorizedResponse) {
        return unauthorizedResponse;
      }

      const itineraryId = req.params.id as string;
      await prisma.tour_itineraries.delete({
        where: { id: itineraryId },
      });
      return ok(res, null as never, "Tour itinerary deleted successfully");
    } catch (error) {
      if (isPrismaNotFoundError(error)) {
        return fail(res, 404, "Itinerary not found");
      }
      console.error("Error deleting tour itinerary:", error);
      return fail(res, 500, "Failed to delete tour itinerary");
    }
  }
}
