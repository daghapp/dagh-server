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
 * Prefers the persisted `validationStep` when present.
 */
export function inferCurrentStep(
  state: VerificationStepState | null,
  storedValidationStep?: string | null,
): string {
  return (
    storedValidationStep ??
    (!state?.phone_number_verified
      ? STEP_PHONE_NUMBER_VERIFICATION
      : !state?.bio_profile_verification
        ? STEP_PROFILE_IMAGE_VERIFICATION
        : !state?.document_verification
          ? STEP_DOCUMENT_VERIFICATION
          : STEP_DOCUMENT_VERIFICATION)
  );
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
