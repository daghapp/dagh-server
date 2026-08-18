export const STEP_PHONE_NUMBER_VERIFICATION = "PHONE_NUMBER_VERIFICATION";
export const STEP_PROFILE_IMAGE_VERIFICATION = "PROFILE_IMAGE_VERIFICATION";
export const STEP_DOCUMENT_VERIFICATION = "DOCUMENT_VERIFICATION";

export type VerificationStepStatus = "PENDING" | "VERIFIED" | "REJECTED";

export interface VerificationStepState {
  phone_number_verified?: boolean;
  bio_profile_verification?: boolean;
  document_verification?: boolean;
  faceStatus?: string | null;
  documentStatus?: string | null;
  bioDataStatus?: string | null;
  faceRejectionReason?: string | null;
  documentRejectionReason?: string | null;
  bioDataRejectionReason?: string | null;
  verification_message?: string | null;
}

export function getStatusForStep(
  step: string,
  state: VerificationStepState | null,
): VerificationStepStatus {
  if (step === STEP_PHONE_NUMBER_VERIFICATION) {
    return state?.phone_number_verified ? "VERIFIED" : "PENDING";
  }

  if (step === STEP_PROFILE_IMAGE_VERIFICATION) {
    if (state?.faceStatus === "REJECTED") {
      return "REJECTED";
    }
    if (state?.bio_profile_verification || state?.faceStatus === "APPROVED") {
      return "VERIFIED";
    }
    return "PENDING";
  }

  if (step === STEP_DOCUMENT_VERIFICATION) {
    if (state?.documentStatus === "REJECTED" || state?.bioDataStatus === "REJECTED") {
      return "REJECTED";
    }
    if (state?.document_verification || state?.documentStatus === "APPROVED") {
      return "VERIFIED";
    }
    return "PENDING";
  }

  return "PENDING";
}

export function getRejectionReason(
  step: string,
  state: VerificationStepState | null,
): string | null {
  if (!state) {
    return null;
  }

  let reason: string | null | undefined;
  if (step === STEP_PROFILE_IMAGE_VERIFICATION) {
    reason = state.faceRejectionReason;
  } else if (step === STEP_DOCUMENT_VERIFICATION) {
    reason = state.documentRejectionReason ?? state.bioDataRejectionReason;
  }

  return reason ?? state.verification_message ?? null;
}

export const VERIFICATION_STEPS = [
  STEP_PHONE_NUMBER_VERIFICATION,
  STEP_PROFILE_IMAGE_VERIFICATION,
  STEP_DOCUMENT_VERIFICATION,
] as const;

/**
 * Infer the current verification step from stored progress.
 * When a persisted `validationStep` is provided and still actionable, use it.
 * When it is already verified, advance to the next step.
 * Falls back to iterating through all steps when no stored step is set.
 */
export function inferCurrentStep(
  state: VerificationStepState | null,
  storedValidationStep?: string | null,
): string {
  // If the admin/client explicitly set a step, check if it still needs action.
    const validSteps = VERIFICATION_STEPS as readonly string[];
    if (storedValidationStep && validSteps.includes(storedValidationStep)) {
    const storedStatus = getStatusForStep(storedValidationStep, state);
    if (storedStatus === "PENDING" || storedStatus === "REJECTED") {
      return storedValidationStep;
    }
    // Stored step is already verified — find the next actionable step after it.
    const storedIndex = (VERIFICATION_STEPS as readonly string[]).indexOf(storedValidationStep);
    for (let i = storedIndex + 1; i < VERIFICATION_STEPS.length; i++) {
      const status = getStatusForStep(VERIFICATION_STEPS[i], state);
      if (status === "PENDING" || status === "REJECTED") {
        return VERIFICATION_STEPS[i];
      }
    }
  }

  // Default: iterate from the beginning and find the first actionable step.
  for (const step of VERIFICATION_STEPS) {
    const status = getStatusForStep(step, state);
    if (status === "PENDING" || status === "REJECTED") {
      return step;
    }
  }
  return STEP_DOCUMENT_VERIFICATION; // Default if all verified
}

export type StepVerificationStatus = {
  status: VerificationStepStatus;
  verificationMessage: string | null;
};

/**
 * Build the status of every verification step from a single state object.
 */
export function buildVerificationSteps(
  state: VerificationStepState | null,
): Record<string, StepVerificationStatus> {
  return VERIFICATION_STEPS.reduce<Record<string, StepVerificationStatus>>((acc, step) => {
    const status = getStatusForStep(step, state);
    acc[step] = {
      status,
      verificationMessage: status === "REJECTED" ? getRejectionReason(step, state) : null,
    };
    return acc;
  }, {});
}

export function getCompletedVerificationSteps(state: VerificationStepState | null): string[] {
  return VERIFICATION_STEPS.filter((step) => getStatusForStep(step, state) === "VERIFIED");
}
