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
import { prisma } from "../../config/index.js";
import { TourSchema, UpdateTourSchema, ItineraryActivitySchema, TourItinerarySchema } from "../../validator/index.js";

export class AdminTourController {
  // Create a new tour
  async createTour(req: Request, res: Response) {
    try {
      const tourData = req.body as TourSchema;
      const newTour = await prisma.tour_packages.create({
        data: tourData,
      });
      return res
        .status(201)
        .json({ message: "Tour created successfully", tour: newTour });
    } catch (error) {
      console.error("Error creating tour:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to create tour",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Update an existing tour
    async updateTour(req: Request, res: Response) {
        try {
            const tourId = req.params.id as string;
            const tourData = req.body as UpdateTourSchema;
            const updatedTour = await prisma.tour_packages.update({
              where: { id: tourId },
              data: tourData,
            });
            return res.json({ message: "Tour updated successfully", tour: updatedTour });
        } catch (error) {
          console.error("Error updating tour:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to update tour",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
    }

    //delete a tour
    async deleteTour(req: Request, res: Response) {
        try{
            const tourId = req.params.id as string;
            await prisma.tour_packages.delete({
              where: { id: tourId },
            });
            return res.json({ message: "Tour deleted successfully" });
        } catch (error) {
          console.error("Error deleting tour:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to delete tour",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
    }

    //add tour itinerary by admin
    async addTourItinerary(req: Request, res: Response) {
        try{
            const tourId = req.params.id as string;
            const itineraryData = req.body as ItineraryActivitySchema;

            // Check if the tour exists before adding itinerary
            const tour = await prisma.tour_packages.findUnique({
              where: { id: tourId },
            });
            if (!tour) {
              return res.status(404).json({ message: "Tour not found" });
            }
            const newItinerary = await prisma.tour_itineraries.create({
              data: {
                ...itineraryData,
                tourId: tourId,},
            });
            return res.status(201).json({ message: "Tour itinerary added successfully", itinerary: newItinerary });
        } catch (error) {
          console.error("Error adding tour itinerary:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to add tour itinerary",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
    }

    //update tour itinerary by admin
    async updateTourItinerary(req: Request, res: Response) {
        try{
            const itineraryId = req.params.id as string;
            const itineraryData = req.body as TourItinerarySchema;
            const updatedItinerary = await prisma.tour_itineraries.update({
              where: { id: itineraryId },
              data: itineraryData,
            });
            return res.json({ message: "Tour itinerary updated successfully", itinerary: updatedItinerary });
        } catch (error) {
          console.error("Error updating tour itinerary:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to update tour itinerary",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
    }

    //delete tour itinerary by admin
    async deleteTourItinerary(req: Request, res: Response) {
        try{
            const itineraryId = req.params.id as string;
            await prisma.tour_itineraries.delete({
              where: { id: itineraryId },
            });
            return res.json({ message: "Tour itinerary deleted successfully" });
        } catch (error) {
          console.error("Error deleting tour itinerary:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to delete tour itinerary",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
    }

}

