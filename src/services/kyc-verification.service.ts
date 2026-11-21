import { prisma } from "../config/index.js";
import {
  STEP_PHONE_NUMBER_VERIFICATION,
  VERIFICATION_STEPS,
  getCompletedVerificationSteps,
  inferCurrentStep,
  isFullyVerified,
} from "../helpers/verification-status.js";

// ─────────────────────────────────────────
// KYC verification gate for tour-to-dating.
// The dating module (casual dating during a tour) is only unlocked once the
// user has completed every mandatory verification step (phone, profile image,
// documents). Unverified users are flagged and blocked from matching.
// ─────────────────────────────────────────

export class KYCVerificationError extends Error {
  statusCode: number;
  code: string;
  currentStep: string | null;
  details: { completedSteps: string[]; requiredSteps: readonly string[]; nextStep: string | null };

  constructor(
    message: string,
    currentStep: string | null = null,
    details: {
      completedSteps: string[];
      requiredSteps: readonly string[];
      nextStep: string | null;
    } = {
      completedSteps: [],
      requiredSteps: VERIFICATION_STEPS,
      nextStep: currentStep,
    },
  ) {
    super(message);
    this.name = "KYCVerificationError";
    this.statusCode = 403;
    this.code = "KYC_VERIFICATION_REQUIRED";
    this.currentStep = currentStep;
    this.details = details;
  }
}

export interface KYCVerdict {
  verified: boolean;
  profileExists: boolean;
  currentStep: string | null;
  completedSteps: string[];
}

/**
 * Resolve the authenticated user's KYC verification state. Returns a verdict
 * without throwing so callers can branch (proceed vs. block).
 */
export async function getKYCVerificationState(userId: string): Promise<KYCVerdict> {
  const userProfile = await prisma.userProfile.findUnique({ where: { userId } });

  if (!userProfile) {
    return {
      verified: false,
      profileExists: false,
      currentStep: STEP_PHONE_NUMBER_VERIFICATION,
      completedSteps: [],
    };
  }

  const verification = await prisma.profileVerification.findUnique({
    where: { userProfileId: userProfile.id },
  });

  const completedSteps = getCompletedVerificationSteps(verification);
  const verified = isFullyVerified(verification);

  return {
    verified,
    profileExists: true,
    currentStep: inferCurrentStep(verification, verification?.validationStep ?? null),
    completedSteps,
  };
}

/**
 * Verify the user is KYC-clean for dating. Throws KYCVerificationError (HTTP 403)
 * when any verification step is incomplete or rejected, which the controller
 * converts into a block response prompting the user to finish verification.
 */
export async function requireKYCVerification(userId: string): Promise<KYCVerdict> {
  const verdict = await getKYCVerificationState(userId);

  if (!verdict.verified) {
    throw new KYCVerificationError(
      "Complete identity verification to unlock casual dating on your tour.",
      verdict.currentStep,
      {
        completedSteps: verdict.completedSteps,
        requiredSteps: VERIFICATION_STEPS,
        nextStep: verdict.currentStep,
      },
    );
  }

  return verdict;
}
