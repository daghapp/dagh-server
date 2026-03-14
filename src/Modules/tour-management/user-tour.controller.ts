//review  of a tour by user
//book a tour by user
//cancel a tour booking by user
//get all tours by user
//get tour details by tour id
//get all tours with filtering
//report scam tour by user
import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import {
  TourBookingSchema,
  TourReviewSchema,
} from "../../validator/index.js";
import sendEmail from "../../config/resend.config.js";
import { ca } from "zod/v4/locales";

export class UserTourController {

  //get all tours
  async getAllTours(req: Request, res: Response) {
    try {
      const {
        category,
        subcategory,
        minPrice,
        maxPrice,
        durationDays,
        featured,
        trending,
        status,
        search,
        page = "1",
        limit = "10",
      } = req.query;

      const where: any = {};

      if (category) where.category = category as string;
      if (subcategory) where.subcategory = subcategory as string;
      if (status) where.status = status as string;
      if (featured !== undefined) where.featured = featured === "true";
      if (trending !== undefined) where.trending = trending === "true";
      if (durationDays) where.durationDays = Number(durationDays);

      if (minPrice || maxPrice) {
        where.basePrice = {};
        if (minPrice) where.basePrice.gte = Number(minPrice);
        if (maxPrice) where.basePrice.lte = Number(maxPrice);
      }

      if (search) {
        where.OR = [
          { title: { contains: search as string, mode: "insensitive" } },
          { description: { contains: search as string, mode: "insensitive" } },
          { shortDescription: { contains: search as string, mode: "insensitive" } },
        ];
      }

      const pageNum = Math.max(1, Number(page));
      const limitNum = Math.min(100, Math.max(1, Number(limit)));
      const skip = (pageNum - 1) * limitNum;

      const [tours, total] = await Promise.all([
        prisma.tour_packages.findMany({
          where,
          skip,
          take: limitNum,
          orderBy: { createdAt: "desc" },
        }),
        prisma.tour_packages.count({ where }),
      ]);

      return res.status(200).json({
        success: true,
        data: tours,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      console.error("Error fetching tours:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch tours",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
  // Book a tour
  async bookTour(req: Request, res: Response) {
    try {
      const userId = req.user?.id as string;
      const bookingData = req.body as TourBookingSchema;

      // Fetch tour details to get the price
      const tour = await prisma.tour_packages.findUnique({
        where: { id: bookingData.tourId },
        select: { basePrice: true, currency: true },
      });

      if (!tour || !tour.basePrice) {
        return res.status(404).json({
          success: false,
          message: "Tour not found or price not available",
        });
      }

      // Calculate total price
      const totalPrice = Number(tour.basePrice) * bookingData.numberOfPeople;

      // Generate unique booking reference
      const bookingReference = `TBK-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

      const newBooking = await prisma.tour_bookings.create({
        data: {
          userId: userId,
          tourId: bookingData.tourId,
          numberOfPeople: bookingData.numberOfPeople,
          bookingDate: new Date(bookingData.bookingDate),
          tourStartDate: new Date(bookingData.tourStartDate),
          bookingReference,
          totalPrice,
          currency: tour.currency || "GHS",
          specialRequests: bookingData.specialRequests,
        },
      });

      //send email after successful booking
      await sendEmail({
        email: req.user?.email as string,
        subject: "Tour Booking Confirmation",
        html: `<p>Dear ${req.user?.fullName as string},</p>
            <p>Your booking has been successfully confirmed.</p>
            <p>Thank you for choosing our tour!</p>`,
      });

      return res
        .status(201)
        .json({ message: "Tour booked successfully", booking: newBooking });
    } catch (error) {
      console.error("Error booking tour:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to book tour",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
  //get all tours booked by user 
  async getUserBookings(req: Request, res: Response) {
    try {
      const userId = req.user?.id as string;
      //check if user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      const bookings = await prisma.tour_bookings.findMany({
        where: { userId },
        include: { tour: true },
        orderBy: { createdAt: "desc" },
      });
      return res.status(200).json({ success: true, bookings });


    } catch (error) {
      console.error("Error fetching user bookings:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch user bookings",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  //cancel a tour booking by user
  async cancelBooking(req: Request, res: Response) {
    try {
      const userId = req.user?.id as string;
      const bookingId = req.params.bookingId as string;

      const booking = await prisma.tour_bookings.findUnique({
        where: { id: bookingId },
        select: { userId: true, status: true },
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found",
        });
      }

      if (booking.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to cancel this booking",
        });
      }

      if (booking.status === "CANCELLED") {
        return res.status(400).json({
          success: false,
          message: "Booking is already cancelled",
        });
      }

      const updatedBooking = await prisma.tour_bookings.update({
        where: { id: bookingId },
        data: { status: "CANCELLED" },
      });

      //send email after successful cancellation
      await sendEmail({
        email: req.user?.email as string,
        subject: "Tour Booking Cancellation Confirmation",
        html: `<p>Dear ${req.user?.fullName as string},</p>
            <p>Your booking has been successfully cancelled.</p>
            <p>Thank you for your understanding.</p>`,
      });

      return res.status(200).json({
        success: true,
        message: "Booking cancelled successfully",
        booking: updatedBooking,
      });
    } catch (error) {
      console.error("Error cancelling tour booking:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to cancel tour booking",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  //review a tour by user
  //get all tours booked by user


  //get all tours 

  
  
}
