import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import type { PostBioDocumentInput } from "../../validator/profile-bio-document-validator.js";
import type { BioDocumentType } from "../../../generated/prisma/client.js";
import { ok, fail } from "../../helpers/response.js";
import { ensureUserProfile } from "../../helpers/ensure-user-profile.js";

export async function postBioDocument(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;
    if (!userId) {
      return fail(res, 401, "Unauthorized");
    }

    const body = req.body as PostBioDocumentInput;

    await ensureUserProfile(userId);

    const existingDoc = await prisma.userProfile.findUnique({
      where: { bio_document_number: body.bio_document_number },
      select: { userId: true },
    });

    if (existingDoc && existingDoc.userId !== userId) {
      return fail(
        res,
        409,
        "This document number has already been used to verify another account.",
      );
    }

    const updated = await prisma.userProfile.update({
      where: { userId },
      data: {
        bio_document_urls: body.bio_document_urls,
        bio_document_type: (body.bio_document_type as BioDocumentType | null | undefined) ?? null,
        bio_document_number: body.bio_document_number,
        bio_document_uploaded_at: new Date(),
      },
    });

    await prisma.profileVerification.upsert({
      where: { userProfileId: updated.id },
      update: { validationStep: "DOCUMENT_VERIFICATION" },
      create: { userProfileId: updated.id, validationStep: "DOCUMENT_VERIFICATION" },
    });

    return ok(
      res,
      {
        bio_document_urls: updated.bio_document_urls,
        bio_document_type: updated.bio_document_type,
        bio_document_number: updated.bio_document_number,
        bio_document_uploaded_at: updated.bio_document_uploaded_at,
      },
      "Bio documents updated successfully.",
    );
  } catch (error) {
    console.error("[postBioDocument]", error);
    return fail(res, 500, "Failed to update bio documents.");
  }
}
