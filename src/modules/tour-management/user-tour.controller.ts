//review  of a tour by user
//book a tour by user
//cancel a tour booking by user
//get all tours by user
//get tour details by tour id
//get all tours with filtering
//report scam tour by user
import { Request, Response } from "express";
import { randomBytes } from "crypto";
import { prisma } from "../../config/index.js";
import { TourBookingSchema, TourBookingSchema_MOMO } from "../../validator/index.js";
import sendEmail from "../../config/resend.config.js";
import {
  PaymentProvider,
  PaymentStatus,
  PaymentTargetType,
} from "../../../generated/prisma/client.js";
import {
  HUBTEL_CALLBACK_URL,
  HUBTEL_CANCELLATION_URL,
  HUBTEL_RETURN_URL,
} from "../../services/payment.service.js";
import * as paymentService from "../../services/payment.service.js";
import { paymentStatusFromHubtel } from "../../helpers/payment.js";
import { ok, created, fail, paginated } from "../../helpers/response.js";
import { isPaymentsEnabled } from "../../config/payments.js";

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

      const where: Record<string, unknown> = {};

      if (category) where.category = category as string;
      if (subcategory) where.subcategory = subcategory as string;
      if (status) where.status = status as string;
      if (featured !== undefined) where.featured = featured === "true";
      if (trending !== undefined) where.trending = trending === "true";
      if (durationDays) where.durationDays = Number(durationDays);

      if (minPrice || maxPrice) {
        const priceFilter: Record<string, number> = {};
        if (minPrice) priceFilter.gte = Number(minPrice);
        if (maxPrice) priceFilter.lte = Number(maxPrice);
        where.basePrice = priceFilter;
      }

      if (search) {
        where.OR = [
          { title: { contains: search as string, mode: "insensitive" } },
          { description: { contains: search as string, mode: "insensitive" } },
          { shortDescription: { contains: search as string, mode: "insensitive" } },
        ];
      }

      const pageNum = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1;
      const limitNum = Number.isFinite(Number(limit))
        ? Math.min(100, Math.max(1, Number(limit)))
        : 10;
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

      return paginated(res, tours, total, pageNum, limitNum);
    } catch (error) {
      console.error("Error fetching tours:", error);
      return fail(res, 500, "Failed to fetch tours");
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
        select: { basePrice: true, currency: true, id: true },
      });

      if (!tour || !tour.basePrice) {
        return fail(res, 404, "Tour not found or price not available");
      }

      // Calculate total price
      const totalPrice = Number(tour.basePrice) * bookingData.numberOfPeople;

      // Generate unique booking reference
      const bookingReference = `TBK-${Date.now()}-${randomBytes(4).toString("hex").toUpperCase()}`;

      let paymentId: string | null = null;
      let paymentStatus: PaymentStatus = PaymentStatus.SUCCESS;
      let checkoutUrl: string | null = null;
      let paymentData = null;
      let feeWaived = totalPrice === 0;

      if (totalPrice > 0) {
        // When the kill-switch is off, bypass the checkout and book for free. Tour
        // bookings are a pass-through to operators, but the product decision is
        // to waive them during outages (see docs/disabling-payments.md §4).
        const paymentsOff = !(await isPaymentsEnabled());
        if (paymentsOff) {
          feeWaived = true;
          paymentStatus = PaymentStatus.SUCCESS;
        } else {
          const paymentResponse = await paymentService.initializePayment({
            totalAmount: totalPrice,
            description: "Payment for tour: " + tour.id,
            returnUrl: HUBTEL_RETURN_URL || "",
            callbackUrl: HUBTEL_CALLBACK_URL || "",
            cancellationUrl: HUBTEL_CANCELLATION_URL || "",
            targetType: PaymentTargetType.TOUR_BOOKING,
            targetId: tour.id,
            userId: userId,
            currency: tour.currency || "GHS",
          });

          if (!paymentResponse.success)
            return fail(
              res,
              500,
              "Failed to book tour",
              paymentResponse.error || paymentResponse.message,
            );

          paymentId = paymentResponse.paymentId;
          paymentStatus = paymentResponse.paymentStatus as PaymentStatus;
          paymentData = paymentResponse.data;
          checkoutUrl = paymentResponse.data?.data?.checkoutUrl || null;
        }
      }

      const newBooking = await prisma.tour_bookings.create({
        data: {
          userId: userId,
          tourId: bookingData.tourId,
          numberOfPeople: bookingData.numberOfPeople,
          bookingDate: new Date(bookingData.bookingDate),
          tourStartDate: new Date(bookingData.tourStartDate),
          bookingReference,
          totalPrice,
          paymentId,
          paymentStatus,
          feeWaived,
          currency: tour.currency || "GHS",
          specialRequests: bookingData.specialRequests,
        },
      });

      // Copy default itinerary into user-specific tables (non-critical, log on failure)
      try {
        await UserTourController.copyItineraryToUserTables(
          userId,
          newBooking.id,
          bookingData.tourId,
        );
      } catch (itineraryError) {
        console.error("Failed to copy itinerary for booking:", newBooking.id, itineraryError);
      }

      //send email after successful booking
      try {
        await sendEmail({
          email: req.user?.email as string,
          subject: "Tour Booking Confirmation",
          html: `<p>Dear ${req.user?.fullName as string},</p>
            <p>Your booking has been successfully confirmed.</p>
            <p>Thank you for choosing our tour!</p>`,
        });
      } catch (emailError) {
        console.error("Failed to send booking confirmation email:", emailError);
      }

      return created(res, { paymentData, checkoutUrl, booking: newBooking });
    } catch (error) {
      console.error("Error booking tour:", error);
      return fail(res, 500, "Failed to book tour");
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
        return fail(res, 404, "User not found");
      }
      const bookings = await prisma.tour_bookings.findMany({
        where: { userId },
        include: { tour: true },
        orderBy: { createdAt: "desc" },
      });
      return ok(res, bookings);
    } catch (error) {
      console.error("Error fetching user bookings:", error);
      return fail(
        res,
        500,
        "Failed to fetch user bookings",
        error instanceof Error ? error.message : "Unknown error",
      );
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
        return fail(res, 404, "Booking not found");
      }

      if (booking.userId !== userId) {
        return fail(res, 403, "You don't have permission to cancel this booking");
      }

      if (booking.status === "CANCELLED") {
        return fail(res, 400, "Booking is already cancelled");
      }

      const updatedBooking = await prisma.tour_bookings.update({
        where: { id: bookingId },
        data: { status: "CANCELLED" },
      });

      //send email after successful cancellation
      try {
        await sendEmail({
          email: req.user?.email as string,
          subject: "Tour Booking Cancellation Confirmation",
          html: `<p>Dear ${req.user?.fullName as string},</p>
            <p>Your booking has been successfully cancelled.</p>
            <p>Thank you for your understanding.</p>`,
        });
      } catch (emailError) {
        console.error("Failed to send cancellation email:", emailError);
      }

      return ok(res, updatedBooking, "Booking cancelled successfully");
    } catch (error) {
      console.error("Error cancelling tour booking:", error);

      return fail(res, 500, "Failed to cancel tour booking");
    }
  }

  // PATCH: Update a user's custom itinerary
  async updateUserItinerary(req: Request, res: Response) {
    try {
      const userId = req.user?.id as string;
      const { itineraryId } = req.params; // user_tour_itineraries.id
      const updates = req.body; // validated against userTourItinerarySchema

      // Check if itinerary exists and belongs to this user
      const itinerary = await prisma.user_tour_itineraries.findUnique({
        where: { id: itineraryId as string },
        include: { activities: true },
      });

      if (!itinerary) {
        return fail(res, 404, "Itinerary not found");
      }
      if (itinerary.userId !== userId) {
        return fail(res, 403, "Not authorized to edit this itinerary");
      }

      // Update itinerary details
      const updatedItinerary = await prisma.user_tour_itineraries.update({
        where: { id: itineraryId as string },
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

      return ok(res, updatedItinerary, "Itinerary updated successfully");
    } catch (error) {
      console.error("Error updating itinerary:", error);
      return fail(res, 500, "Failed to update itinerary");
    }
  }

  async initiateTourBookingMoMo(req: Request, res: Response) {
    // const { tourId, numberOfPeople, phoneNumber, fullName, paymentMethod } = req.body;
    try {
      const userId = req.user?.id as string;
      const bookingData = req.body as TourBookingSchema_MOMO;

      // Fetch tour details to get the price
      const tour = await prisma.tour_packages.findUnique({
        where: { id: bookingData.tourId },
        select: { basePrice: true, currency: true, title: true },
      });

      if (!tour || !tour.basePrice) {
        return fail(res, 404, "Tour not found or price not available");
      }

      // Calculate total price
      const totalPrice = Number(tour.basePrice) * bookingData.numberOfPeople;

      // Generate unique booking reference
      const bookingReference = `TBK-${Date.now()}-${randomBytes(4).toString("hex").toUpperCase()}`;

      // 2. Build universal payment request body
      const paymentPayload = {
        userId,
        targetType: PaymentTargetType.TOUR_BOOKING,
        targetId: bookingData.tourId,
        amount: totalPrice,
        currency: tour.currency || "GHS",
        method: bookingData.paymentMethod,
        provider: PaymentProvider.HUBTEL,
        callbackUrl: HUBTEL_CALLBACK_URL || "",
        description: `Payment for tour ${tour.title}`,
        customerPhone: bookingData.phoneNumber,
      };

      // 3. Validate payload with Zod

      // 4. Call universal payment controller — skip when kill-switch is off.
      const paymentsOff = !(await isPaymentsEnabled());
      if (paymentsOff) {
        const booking = await prisma.tour_bookings.create({
          data: {
            userId,
            paymentId: null,
            paymentStatus: PaymentStatus.SUCCESS,
            feeWaived: true,
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
        return ok(
          res,
          { bookingId: booking.id, paymentId: null, checkoutUrl: null, freeMode: true },
          "Payments are temporarily disabled. Tour booked for free.",
        );
      }

      const paymentResponse = await paymentService.initializePaymentMOMO(paymentPayload);

      // 5. If payment initiation succeeded, create booking with paymentStatus = PENDING
      if (paymentResponse.success) {
        const booking = await prisma.tour_bookings.create({
          data: {
            userId,
            paymentId: paymentResponse.paymentId, // link to payment record
            paymentStatus: PaymentStatus.PENDING, // always pending until Hubtel callback
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
        try {
          await sendEmail({
            email: req.user?.email as string,
            subject: "Tour Booking Confirmation",
            html: `<p>Dear ${req.user?.fullName as string},</p>
            <p>Your booking has been successfully confirmed.</p>
            <p>Thank you for choosing our tour!</p>`,
          });
        } catch (emailError) {
          console.error("Failed to send booking confirmation email:", emailError);
        }
        return ok(
          res,
          { bookingId: booking.id, paymentId: paymentResponse.paymentId },
          "Tour booking initiated. Awaiting payment confirmation.",
        );
      }

      return fail(res, 400, "Payment initiation failed");
    } catch (error) {
      console.error("Error initiating tour booking:", error);
      return fail(res, 500, "Internal server error");
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
      const newStatus = paymentStatusFromHubtel(ResponseCode);

      // 3. Update Payment record (guard against retried/unknown references → P2025)
      const existingPayment = await prisma.payment.findUnique({
        where: { reference: Data.ClientReference },
      });
      if (!existingPayment) {
        return fail(res, 404, "Payment not found");
      }

      const payment = await prisma.payment.update({
        where: { reference: Data.ClientReference },
        data: { status: newStatus },
      });

      // 4. Update linked Tour Booking record (non-fatal: callback may be for
      // a non-tour payment target, e.g. membership/subscription)
      let booking: { id: string } | null = null;
      try {
        booking = await prisma.tour_bookings.update({
          where: { paymentId: payment.id },
          data: { paymentStatus: newStatus },
        });
      } catch (bookingError) {
        console.error("No tour booking linked to payment:", payment.id, bookingError);
      }

      if (newStatus === "SUCCESS" && booking) {
        try {
          await UserTourController.copyItineraryToUserTables(
            payment.userId,
            booking.id,
            payment.targetId,
          );
        } catch (itineraryError) {
          console.error("Failed to copy itinerary in callback:", itineraryError);
        }
      }

      return ok(res, { paymentStatus: newStatus }, "Callback processed successfully");
    } catch (error) {
      console.error("Hubtel callback error:", error);
      return fail(res, 500, "Internal server error");
    }
  }

  async getTourDetails(req: Request, res: Response) {
    try {
      const { tourId } = req.params;

      const tour = await prisma.tour_packages.findUnique({
        where: { id: tourId as string },
        include: {
          // Nested relations
          tour_itineraries: {
            include: {
              itinerary_activities: true,
            },
          },
          tour_locations: true,
          tour_media: true,
          pricing_includes: true,
          pricing_excludes: true,
          bookings: {
            include: {
              user: {
                select: {
                  id: true,
                  fullName: true,
                  email: true,
                },
              },
              userTourItineraries: {
                include: {
                  activities: true,
                },
              },
            },
          },
        },
      });

      if (!tour) {
        return fail(res, 404, "Tour not found");
      }

      return ok(res, tour, "Tour details retrieved successfully");
    } catch (error) {
      console.error("Error fetching tour details:", error);
      return fail(res, 500, "Failed to fetch tour details");
    }
  }
}
