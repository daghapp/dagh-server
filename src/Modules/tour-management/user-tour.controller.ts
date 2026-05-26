//review  of a tour by user
//book a tour by user
//cancel a tour booking by user
//get all tours by user
//get tour details by tour id
//get all tours with filtering
//report scam tour by user
import { Request, Response } from "express";
import { hubtelDirectMoneyReceive, prisma } from "../../config/index.js";
import {
  TourBookingSchema,
  TourBookingSchema_MOMO,
  TourReviewSchema,
} from "../../validator/index.js";
import sendEmail from "../../config/resend.config.js";
import { ca } from "zod/v4/locales";
import { PaymentMethod, PaymentProvider, PaymentStatus, PaymentTargetType } from "../../../generated/prisma/client.js";
import { HUBTEL_CALLBACK_URL, PaymentController } from "../payment-management/payment.controller.js";

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

// Helper: copy default itinerary into user tables
static async copyItineraryToUserTables(userId: string, bookingId: string, tourId: string) {
  // Fetch the tour itineraries and activities
  const itineraries = await prisma.tour_itineraries.findMany({
    where: { tourId },
    include: { itinerary_activities: true },
  });

  // Loop through each itinerary and create user-specific copies
  for (const itinerary of itineraries) {
    const userItinerary = await prisma.user_tour_itineraries.create({
      data: {
        userId,
        bookingId,
        dayNumber: itinerary.dayNumber,
        title: itinerary.title,
        description: itinerary.description,
        breakfast: itinerary.breakfast,
        lunch: itinerary.lunch,
        dinner: itinerary.dinner,
        accommodationName: itinerary.accommodationName,
        accommodationType: itinerary.accommodationType,
        accommodationRating: itinerary.accommodationRating,
      },
    });

    // Copy activities into user_tour_itineraries_activities
    for (const activity of itinerary.itinerary_activities) {
      await prisma.user_tour_itineraries_activities.create({
        data: {
          userItineraryId: userItinerary.id,
          activityTime: activity.activityTime,
          activity: activity.activity,
          durationMinutes: activity.durationMinutes,
          included: activity.included,
          cost: activity.cost,
          locationName: activity.locationName,
          locationAddress: activity.locationAddress,
        },
      });
    }
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

      // Copy default itinerary into user-specific tables
      await UserTourController.copyItineraryToUserTables(userId, newBooking.id, bookingData.tourId);


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






  // PATCH: Update a user’s custom itinerary
async updateUserItinerary(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;
    const { itineraryId }  = req.params; // user_tour_itineraries.id
    const updates = req.body; // validated against userTourItinerarySchema

    // Check if itinerary exists and belongs to this user
    const itinerary = await prisma.user_tour_itineraries.findUnique({
      where: { id: itineraryId as string },
      include: { activities: true },
    });

    if (!itinerary) {
      return res.status(404).json({ success: false, message: "Itinerary not found" });
    }
    if (itinerary.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized to edit this itinerary" });
    }

    // Update itinerary details
    const updatedItinerary = await prisma.user_tour_itineraries.update({
      where: { id: itineraryId  as string},
      data: {
        dayNumber: updates.dayNumber,
        title: updates.title,
        description: updates.description,
        breakfast: updates.breakfast,
        lunch: updates.lunch,
        dinner: updates.dinner,
        accommodationName: updates.accommodationName,
        accommodationType: updates.accommodationType,
        accommodationRating: updates.accommodationRating,
      },
      include: { activities: true },
    });

    // If activities are provided, update them too
    if (updates.activities && Array.isArray(updates.activities)) {
      for (const activity of updates.activities) {
        if (activity.id) {
          // Update existing activity
          await prisma.user_tour_itineraries_activities.update({
            where: { id: activity.id },
            data: {
              activityTime: activity.activityTime,
              activity: activity.activity,
              durationMinutes: activity.durationMinutes,
              included: activity.included,
              cost: activity.cost,
              locationName: activity.locationName,
              locationAddress: activity.locationAddress,
            },
          });
        } else {
          // Create new activity
          await prisma.user_tour_itineraries_activities.create({
            data: {
              userItineraryId: itineraryId as string,
              activityTime: activity.activityTime,
              activity: activity.activity,
              durationMinutes: activity.durationMinutes,
              included: activity.included,
              cost: activity.cost,
              locationName: activity.locationName,
              locationAddress: activity.locationAddress,
            },
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: "Itinerary updated successfully",
      itinerary: updatedItinerary,
    });
  } catch (error) {
    console.error("Error updating itinerary:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update itinerary",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}


 async  initiateTourBookingMoMo(req: Request, res: Response) {
  // const { tourId, numberOfPeople, phoneNumber, fullName, paymentMethod } = req.body;
  try {

  
      const userId = req.user?.id as string;
      const bookingData = req.body as TourBookingSchema_MOMO;

      // Fetch tour details to get the price
      const tour = await prisma.tour_packages.findUnique({
        where: { id: bookingData.tourId },
        select: { basePrice: true, currency: true, title:true },
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


    // 2. Build universal payment request body
    const paymentPayload = {
      userId,
      targetType: PaymentTargetType.TOUR_BOOKING,
      targetId: bookingData.tourId,
      amount: totalPrice,
      currency: tour.currency || "GHS",
      method: bookingData.paymentMethod,
      provider: PaymentProvider.HUBTEL,
      callbackUrl: HUBTEL_CALLBACK_URL,
      description: `Payment for tour ${tour.title}`,
      customerPhone: bookingData.phoneNumber,
    };

    // 3. Validate payload with Zod

    // 4. Call universal payment controller
    const paymentResponse = await PaymentController.initializePayment(paymentPayload);

    // 5. If payment initiation succeeded, create booking with paymentStatus = PENDING
    if (paymentResponse.success) {
      const booking = await prisma.tour_bookings.create({
        data: {
          userId,
          paymentId: paymentResponse.paymentId, // link to payment record
          paymentStatus: PaymentStatus.PENDING,  // always pending until Hubtel callback
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
      return res.status(200).json({
        success: true,
        message: "Tour booking initiated. Awaiting payment confirmation.",
        bookingId: booking.id,
        paymentId: paymentResponse.paymentId,
      });
    }

      console.log("payment response ", paymentResponse)
    return res.status(400).json({
      success: false,
      message: "Payment initiation failed",
    });
  } catch (error) {
    console.error("Error initiating tour booking:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}



// Step 2: Hubtel callback handler
async hubtelCallbackController(req: Request, res: Response) {
  const body = req.body;

  try {
    const { ResponseCode, Message, Data } = body;

    // 1. Log Hubtel callback payload
    await prisma.hubtelDirectReceiveLog.create({
      data: {
        message: Message,
        responseCode: ResponseCode,
        amount: Data.Amount,
        charges: Data.Charges,
        amountAfterCharges: Data.AmountAfterCharges,
        amountCharged: Data.AmountCharged,
        description: Data.Description,
        clientReference: Data.ClientReference,
        transactionId: Data.TransactionId,
        externalTransactionId: Data.ExternalTransactionId,
        orderId: Data.OrderId,
        deliveryFee: Data.DeliveryFee ?? 0.0,
      },
    });

    // 2. Map ResponseCode to PaymentStatus
    let newStatus: PaymentStatus;
    switch (ResponseCode) {
      case "0000":
        newStatus = PaymentStatus.SUCCESS;
        break;
      case "2001":
        newStatus = PaymentStatus.FAILED;
        break;
      case "0001":
      default:
        newStatus = PaymentStatus.PENDING;
        break;
    }

    // 3. Update Payment record
    const payment = await prisma.payment.update({
      where: { reference: Data.ClientReference },
      data: { status: newStatus },
    });

    // 4. Update linked Tour Booking record
    const booking = await prisma.tour_bookings.update({
      where: { paymentId: payment.id },
      data: { paymentStatus: newStatus },
    });

    if (newStatus === 'SUCCESS')
    await UserTourController.copyItineraryToUserTables(payment.userId, booking.id, payment.targetId);

    return res.status(200).json({
      success: true,
      message: "Callback processed successfully",
      paymentStatus: newStatus,
    });
  } catch (error) {
    console.error("Hubtel callback error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}  




  //review a tour by user
  //get all tours booked by user


  //get all tours 


  
  
  
}
