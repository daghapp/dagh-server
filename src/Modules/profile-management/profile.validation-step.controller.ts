import { Request, Response } from "express";
import { prisma } from "../../config/index.js";

const STEP_PHONE_NUMBER_VERIFICATION = "phonenumber_verification";
const STEP_PROFILE_IMAGE_VERIFICATION = "profile_image_validation";
const STEP_DOCUMENT_VERIFICATION = "document_verification";

type CurrentStepResponse = {
  current_step: string;
  status: string;
};

function getStatusForStep(args: {
  step: string;
  userProfile: any;
  userVerification: any | null;
}): string {
  const { step, userProfile, userVerification } = args;

  if (step === STEP_PHONE_NUMBER_VERIFICATION) {
    return !!userVerification?.phone_number_verified ? "VERIFIED" : "PENDING";
  }

  if (step === STEP_DOCUMENT_VERIFICATION) {
    // Note: field name in schema is `document_verificaiton` (typo kept)
    return !!userVerification?.document_verificaiton ? "VERIFIED" : "PENDING";
  }

  if (step === STEP_PROFILE_IMAGE_VERIFICATION) {
    return !!userVerification?.bio_profile_verification ? "VERIFIED" : "PENDING";
  }

  // Fallback: if step is unknown, report not started.
  return "PENDING";
}

export async function getValidationStepStatus(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;
    const stepQuery = typeof req.query.step === "string" ? req.query.step : null;
    const requestedStep = stepQuery ?? null;


    if (!userId) {

      return res.status(401).json({ success: false, message: "Unauthorized", data: null });
    }

    const userProfile = await prisma.userProfile.findUnique({
      where: { userId },
      include: { user: false },
    });

    if (!userProfile) {
      return res.status(404).json({ success: false, message: "Profile not found", data: null });
    }

    const userVerification = await prisma.profileVerification.findUnique({
      where: { userProfileId: userProfile.id },
    });

    // If validationStep exists on ProfileVerification, use it.
    // If not, determine a default based on which fields are verified.
    // `validationStep` field exists in schema, but may not be reflected in generated Prisma types
    // until `prisma generate` is re-run. Access it safely.
    // If the caller provided ?step=..., respect it; otherwise use stored/inferred current step.
    const inferredCurrentStep =
      (userVerification as any)?.validationStep ??

      (!userVerification?.phone_number_verified
        ? STEP_PHONE_NUMBER_VERIFICATION
        : !userVerification?.bio_profile_verification
          ? STEP_PROFILE_IMAGE_VERIFICATION
          : !userVerification?.document_verificaiton
            ? STEP_DOCUMENT_VERIFICATION
            : STEP_DOCUMENT_VERIFICATION);

    const validationStep = requestedStep ?? inferredCurrentStep;



    const status = getStatusForStep({
      step: validationStep,
      userProfile,
      userVerification,
    });

    const payload: CurrentStepResponse = {
      current_step: validationStep,
      status,
    };

    return res.status(200).json({
      success: true,
      message: "Current validation step retrieved successfully.",
      data: payload,
    });
  } catch (error) {
    console.error("[getCurrentValidationStep]", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve current validation step.",
      data: null,
    });
  }
}

