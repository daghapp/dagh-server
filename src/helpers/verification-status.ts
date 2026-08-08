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
