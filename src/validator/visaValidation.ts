import { VisaPackageType } from '../../generated/prisma/client.js';
import { z } from 'zod';

export const placeOfLodgingSchema = z.object({
  type: z.enum(['hotel', 'private', 'other']),
  name: z.string().min(1, 'Lodging name is required'),
  address: z.string().min(1, 'Address is required'),
});

export const contactSchema = z.object({
  email: z.string().email('Invalid email format'),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format'),
});

export const createVisaApplicationSchema = z.object({
  body: z.object({
    passportNumber: z.string().regex(/^[A-Z0-9]{6,12}$/, 'Invalid passport number format'),
    nationality: z.string().min(2, 'Nationality is required'),
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
    passportExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
    purposeOfVisit: z.string().min(1, 'Purpose of visit is required'),
    arrivalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
    placeOfLodging: placeOfLodgingSchema,
    contact: contactSchema,
  }),
});

export const documentUploadSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid application ID format'),
  }),
  body: z.object({
    documentType: z.enum(['ITINERARY', 'PASSPORT_SCAN', 'VISA_PHOTO', 'PROOF_OF_ACCOMMODATION', 'TRAVEL_INSURANCE']),
    fileUrl: z.string().url('Invalid URL format'),
  }),
});

export const passportScanSchema = z.object({
  body: z.object({
    imageUrl: z.string().url('Invalid URL format').optional(),
    passportNumber: z.string().regex(/^[A-Z0-9]{6,12}$/, 'Invalid passport number format'),
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    nationality: z.string().min(2, 'Nationality is required'),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
    expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  }),
});

export const applicationIdSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid application ID format'),
  }),
});

export const updateStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid application ID format'),
  }),
  body: z.object({
    visaNumber: z.string().optional(),
  }),
});

export const getAllApplicationsSchema = z.object({
  query: z.object({
    status: z.enum(['PENDING', 'REVIEW', 'APPROVED', 'REJECTED']).optional(),
    page: z.string().regex(/^\d+$/).transform(Number).optional(),
    limit: z.string().regex(/^\d+$/).transform(Number).optional(),
  }),
});

export const visaOnArrivalDataSchema = z.object({
  passport_image_url: z.string().url("Invalid passport image URL"),
  bio_page_image_url: z.string().url("Invalid bio page image URL"),
  flight_itenary_image_url: z.string().url("Invalid flight itinerary image URL"),
  passport_number: z.string().regex(/^[A-Z0-9]{6,12}$/, "Invalid passport number"),
  purpose_of_trip: z.string().min(3, "Purpose of trip required"),
  // date_of_departure: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, "Invalid date format (YYYY-MM-DDTHH:MM:SS)"),
  // date_of_arrival: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, "Invalid date format (YYYY-MM-DDTHH:MM:SS)")
  date_of_departure: z.iso.datetime(),
  date_of_arrival: z.iso.datetime()
});


export const initiateVisaPaymentSchema = z.object({
    // requestId: z.string().uuid('Invalid application ID format'),
    packageType: z.enum(VisaPackageType)
})



export type VisaOnArrivalDataSchema = z.infer<typeof visaOnArrivalDataSchema>;
export type InitiateVisaPaymentSchema = z.infer<typeof initiateVisaPaymentSchema>;