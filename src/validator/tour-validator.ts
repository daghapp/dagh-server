import { z } from "zod";

// Itinerary Activity Schema
export const itineraryActivitySchema = z.object({
  activityTime: z.string().optional(),
  activity: z.string().max(255).optional(),
  durationMinutes: z.number().int().positive().optional(),
  included: z.boolean().optional(),
  cost: z.number().nonnegative().optional(),
  locationName: z.string().max(255).optional(),
  locationAddress: z.string().optional(),
});

// Tour Itinerary Schema
export const tourItinerarySchema = z.object({
  dayNumber: z.number().int().positive().optional(),
  title: z.string().max(255).optional(),
  description: z.string().optional(),
  breakfast: z.boolean().optional(),
  lunch: z.boolean().optional(),
  dinner: z.boolean().optional(),
  accommodationName: z.string().max(255).optional(),
  accommodationType: z.string().max(100).optional(),
  accommodationRating: z.number().min(0).max(5).optional(),
  activities: z.array(itineraryActivitySchema).optional(),
});

// User Tour Itinerary Activity Schema
export const userItineraryActivitySchema = z.object({
  activityTime: z.string().optional(),
  activity: z.string().max(255).optional(),
  durationMinutes: z.number().int().positive().optional(),
  included: z.boolean().optional(),
  cost: z.number().nonnegative().optional(),
  locationName: z.string().max(255).optional(),
  locationAddress: z.string().optional(),
});

// User Tour Itinerary Schema
export const userTourItinerarySchema = z.object({
  dayNumber: z.number().int().positive().optional(),
  title: z.string().max(255).optional(),
  description: z.string().optional(),
  breakfast: z.boolean().optional(),
  lunch: z.boolean().optional(),
  dinner: z.boolean().optional(),
  accommodationName: z.string().max(255).optional(),
  accommodationType: z.string().max(100).optional(),
  accommodationRating: z.number().min(0).max(5).optional(),
  activities: z.array(userItineraryActivitySchema).optional(),
});

// Tour Location Schema
const tourLocationSchema = z.object({
  name: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  region: z.string().max(100).optional(),
  description: z.string().optional(),
  visitDuration: z.number().int().positive().optional(),
  photos: z.array(z.string().url()).optional(),
});

// Tour Media Schema
const tourMediaSchema = z.object({
  mediaType: z.enum(["image", "video"]).optional(),
  url: z.string().url().optional(),
});

// Heritage Element Schema
const heritageElementSchema = z.object({
  type: z.enum(["ancestral", "historical", "cultural", "tribal"]).optional(),
  value: z.string().optional(),
});

// Pricing Include Schema
const pricingIncludeSchema = z.object({
  item: z.string().optional(),
});

// Pricing Exclude Schema
const pricingExcludeSchema = z.object({
  item: z.string().optional(),
});

// Group Discount Schema
const groupDiscountSchema = z.object({
  minSize: z.number().int().positive().optional(),
  discountPercentage: z.number().min(0).max(100).optional(),
});

// Seasonal Pricing Schema
const seasonalPricingSchema = z.object({
  season: z.string().max(100).optional(),
  startDate: z.string().datetime().or(z.date()).optional(),
  endDate: z.string().datetime().or(z.date()).optional(),
  priceModifier: z.number().optional(),
});

// Tour Guide Schema
const tourGuideSchema = z.object({
  guideId: z.string().optional(),
  name: z.string().max(255).optional(),
  photo: z.string().url().optional(),
  bio: z.string().optional(),
});

// Main Tour Package Schema
export const tourSchema = z.object({
  title: z.string().min(1, "Title is required").max(255),
  slug: z.string().max(255).optional(),
  description: z.string().optional(),
  shortDescription: z.string().optional(),
  category: z.string().max(100).optional(),
  subcategory: z.string().max(100).optional(),
  durationDays: z.number().int().positive().optional(),
  durationNights: z.number().int().nonnegative().optional(),
  basePrice: z.number().positive().optional(),
  currency: z.string().max(10).default("GHS"),
  status: z.enum(["draft", "published", "archived", "pending_review"]).default("draft"),
  featured: z.boolean().default(false),
  trending: z.boolean().default(false),
  cancellationPolicy: z.string().optional(),
  bookingDeadline: z.number().int().positive().optional(),
  minimumBooking: z.number().int().positive().optional(),
  accessibility: z.string().optional(),
  coverImage: z.string().url().optional(),
  heritageDnaTesting: z.boolean().default(false),
  itineraries: z.array(tourItinerarySchema).optional(),
  locations: z.array(tourLocationSchema).optional(),
  media: z.array(tourMediaSchema).optional(),
  heritageElements: z.array(heritageElementSchema).optional(),
  pricingIncludes: z.array(pricingIncludeSchema).optional(),
  pricingExcludes: z.array(pricingExcludeSchema).optional(),
  groupDiscounts: z.array(groupDiscountSchema).optional(),
  seasonalPricing: z.array(seasonalPricingSchema).optional(),
  guides: z.array(tourGuideSchema).optional(),
});

// Update Tour Schema (partial validation)
export const updateTourSchema = tourSchema.partial();

// Tour Booking Schema
export const tourBookingSchema = z.object({
  tourId: z.string().uuid("Invalid tour ID"),
  numberOfPeople: z.number().int().positive("Number of people must be positive"),
  bookingDate: z.string().datetime().or(z.date()),
  tourStartDate: z.string().datetime().or(z.date()),
  specialRequests: z.string().optional(),
  returnURL: z.string(),
  // paymentMethodId: z.string().uuid().optional(),
});

export const tourBookingSchema_momo = z.object({
  tourId: z.string().uuid("Invalid tour ID"),
  numberOfPeople: z.number().int().positive("Number of people must be positive"),
  bookingDate: z.string().datetime().or(z.date()),
  tourStartDate: z.string().datetime().or(z.date()),
  specialRequests: z.string().optional(),
  paymentMethod: z.enum(["MTN_MOMO", "TELECEL_MOMO", "AT_MOMO"]),
  phoneNumber: z.string().regex(/^233\d{9}$/, "Phone must be a valid Ghana MSISDN"),
});

// Tour Review Schema
export const tourReviewSchema = z.object({
  tourId: z.string().uuid("Invalid tour ID"),
  overallRating: z.number().min(1).max(5, "Rating must be between 1 and 5"),
  experienceRating: z.number().min(1).max(5).optional(),
  guideRating: z.number().min(1).max(5).optional(),
  valueForMoneyRating: z.number().min(1).max(5).optional(),
  organizationRating: z.number().min(1).max(5).optional(),
  heritageRating: z.number().min(1).max(5).optional(),
  title: z.string().max(255).optional(),
  review: z.string().min(10, "Review must be at least 10 characters").optional(),
});

// Tour Report Schema
export const tourReportSchema = z.object({
  tourId: z.string().uuid("Invalid tour ID"),
  reportType: z.enum(["fraud", "misleading", "safety_concern", "inappropriate_content", "other"]),
  description: z.string().min(20, "Please provide a detailed description (minimum 20 characters)"),
});

export type TourSchema = z.infer<typeof tourSchema>;
export type UpdateTourSchema = z.infer<typeof updateTourSchema>;
export type TourBookingSchema = z.infer<typeof tourBookingSchema>;
export type TourBookingSchema_MOMO = z.infer<typeof tourBookingSchema_momo>;
export type TourReviewSchema = z.infer<typeof tourReviewSchema>;
export type TourReportSchema = z.infer<typeof tourReportSchema>;
export type ItineraryActivitySchema = z.infer<typeof itineraryActivitySchema>;
export type TourItinerarySchema = z.infer<typeof tourItinerarySchema>;
