import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";
import {
  STEP_PHONE_NUMBER_VERIFICATION,
  VERIFICATION_STEPS,
  buildVerificationSteps,
  getCompletedVerificationSteps,
  getRejectionReason,
  getStatusForStep,
  inferCurrentStep,
  type VerificationStepStatus,
} from "../../helpers/verification-status.js";

type CurrentStepResponse = {
  current_step: string;
  status: string;
  verification_message?: string | null;
};

export type VerificationStatusResponse = {
  verificationProfileExists: boolean;
  datingProfileExists: boolean;
  isVerified: boolean;
  currentStep: string;
  verificationMessage: string | null;
  steps: Record<string, { status: VerificationStepStatus; verificationMessage: string | null }>;
  completedSteps: string[];
};

/**
 * Comprehensive verification status for the authenticated user.
 * Returns the state of every verification step (phone, profile image, documents),
 * the current/inferred step, and whether the profile exists at all — so the
 * frontend can decide whether to start the flow or skip it for returning users.
 */
export async function getVerificationStatus(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;
    if (!userId) {
      return fail(res, 401, "Unauthorized");
    }

    const userProfile = await prisma.userProfile.findUnique({
      where: { userId },
    });

    const datingProfile = await prisma.datingProfile.findUnique({
      where: { userId },
    });

    if (!userProfile) {
      return ok(
        res,
        {
          verificationProfileExists: false,
          datingProfileExists: !!datingProfile,
          isVerified: false,
          currentStep: STEP_PHONE_NUMBER_VERIFICATION,
          verificationMessage: null,
          steps: buildVerificationSteps(null),
          completedSteps: [],
        },
        "Verification status retrieved successfully.",
      );
    }

    const verification = await prisma.profileVerification.findUnique({
      where: { userProfileId: userProfile.id },
    });

    const currentStep = inferCurrentStep(
      verification,
      (verification as { validationStep?: string } | null)?.validationStep,
    );

    const steps = buildVerificationSteps(verification);

    const completedSteps = getCompletedVerificationSteps(verification);

    const isVerified = completedSteps.length === VERIFICATION_STEPS.length;

    const payload: VerificationStatusResponse = {
      verificationProfileExists: true,
      datingProfileExists: !!datingProfile,
      isVerified,
      currentStep,
      verificationMessage:
        verification?.verification_message ?? getRejectionReason(currentStep, verification) ?? null,
      steps,
      completedSteps,
    };

    return ok(res, payload, "Verification status retrieved successfully.");
  } catch (error) {
    console.error("[getVerificationStatus]", error);
    return fail(res, 500, "Failed to retrieve verification status.");
  }
}

export async function getValidationStepStatus(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;
    const stepQuery = typeof req.query.step === "string" ? req.query.step : null;
    const requestedStep = stepQuery ?? null;

    if (!userId) {
      return fail(res, 401, "Unauthorized");
    }

    const userProfile = await prisma.userProfile.findUnique({
      where: { userId },
      include: { user: false },
    });

    if (!userProfile) {
      return fail(res, 404, "Profile not found");
    }

    const userVerification = await prisma.profileVerification.findUnique({
      where: { userProfileId: userProfile.id },
    });

    // If validationStep exists on ProfileVerification, use it.
    // If not, determine a default based on which fields are verified.
    // `validationStep` field exists in schema, but may not be reflected in generated Prisma types
    // until `prisma generate` is re-run. Access it safely.
    // If the caller provided ?step=..., respect it; otherwise use stored/inferred current step.
    const inferredCurrentStep = inferCurrentStep(
      userVerification,
      (userVerification as { validationStep?: string } | null)?.validationStep,
    );

    const validationStep = requestedStep ?? inferredCurrentStep;

    const status = getStatusForStep(validationStep, userVerification);

    const payload: CurrentStepResponse = {
      current_step: validationStep,
      status,
    };

    if (status === "REJECTED") {
      payload.verification_message = getRejectionReason(validationStep, userVerification);
    }

    return ok(res, payload, "Current validation step retrieved successfully.");
  } catch (error) {
    console.error("[getCurrentValidationStep]", error);
    return fail(res, 500, "Failed to retrieve current validation step.");
  }
}
