import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import type { PostBioDocumentInput } from "../../validator/profile-bio-document-validator.js";
import type { BioDocumentType } from "../../../generated/prisma/client.js";

export async function postBioDocument(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized", data: null });
    }

    const body = req.body as PostBioDocumentInput;

    const updated = await prisma.userProfile.update({
      where: { userId },
      data: {
        bio_document_urls: body.bio_document_urls,
        bio_document_type: (body.bio_document_type as BioDocumentType | null | undefined) ?? null,
        bio_document_uploaded_at: new Date(),
      },
    });

    return res.status(200).json({
      success: true,
      message: "Bio documents updated successfully.",
      data: {
        bio_document_urls: updated.bio_document_urls,
        bio_document_type: updated.bio_document_type,
        bio_document_uploaded_at: updated.bio_document_uploaded_at,
      },
    });
  } catch (error) {
    console.error("[postBioDocument]", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update bio documents.",
      data: null,
    });
  }
}

