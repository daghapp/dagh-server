import { z } from "zod";
import { BioDocumentType } from "../../generated/prisma/client.js";

export const bioDocumentTypeEnum = z.nativeEnum(BioDocumentType);

export const postBioDocumentSchema = z.object({
  // Stored in prisma as `bio_document_urls`
  bio_document_urls: z
    .array(z.string().url({ message: "Each bio document URL must be a valid URL" }))
    .min(1, { message: "bio_document_urls must contain at least 1 url" }),

  // Stored in prisma as `bio_document_type`
  bio_document_type: bioDocumentTypeEnum.optional().nullable(),

  // ID document number (Ghana Card number, passport number, etc.)
  bio_document_number: z
    .string()
    .min(1, { message: "bio_document_number is required" })
    .max(50, { message: "bio_document_number must be 50 characters or less" }),
});

export type PostBioDocumentInput = z.infer<typeof postBioDocumentSchema>;
