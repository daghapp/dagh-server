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
});

export type PostBioDocumentInput = z.infer<typeof postBioDocumentSchema>;
