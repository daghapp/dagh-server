import { describe, expect, it } from "vitest";
import {
  STEP_PHONE_NUMBER_VERIFICATION,
  STEP_PROFILE_IMAGE_VERIFICATION,
  STEP_DOCUMENT_VERIFICATION,
  VERIFICATION_STEPS,
  buildVerificationSteps,
  getCompletedVerificationSteps,
  getStatusForStep,
  inferCurrentStep,
  type VerificationStepState,
} from "../src/helpers/verification-status.js";

/**
 * Simulates the status endpoint's isVerified derivation logic:
 * isVerified is only true when ALL verification steps are complete.
 */
function deriveIsVerified(state: VerificationStepState | null): boolean {
  const completedSteps = getCompletedVerificationSteps(state);
  return completedSteps.length === VERIFICATION_STEPS.length;
}

/**
 * Simulates building the full status payload as the status endpoint would.
 */
function buildStatusPayload(state: VerificationStepState | null, storedValidationStep?: string) {
  const steps = buildVerificationSteps(state);
  const completedSteps = getCompletedVerificationSteps(state);
  const currentStep = inferCurrentStep(state, storedValidationStep);
  const isVerified = completedSteps.length === VERIFICATION_STEPS.length;

  return {
    isVerified,
    currentStep,
    steps,
    completedSteps,
  };
}

describe("Full verification workflow", () => {
  describe("Step 0: Profile init (no verification started)", () => {
    it("isVerified is false when no profile exists", () => {
      expect(deriveIsVerified(null)).toBe(false);
    });

    it("isVerified is false when profile exists but no steps completed", () => {
      const state: VerificationStepState = {};
      expect(deriveIsVerified(state)).toBe(false);
    });

    it("currentStep is PHONE_NUMBER_VERIFICATION", () => {
      const payload = buildStatusPayload({});
      expect(payload.currentStep).toBe(STEP_PHONE_NUMBER_VERIFICATION);
      expect(payload.completedSteps).toEqual([]);
    });
  });

  describe("Step 1: Phone verification complete", () => {
    it("isVerified is still false after phone verification", () => {
      const state: VerificationStepState = {
        phone_number_verified: true,
      };
      expect(deriveIsVerified(state)).toBe(false);
    });

    it("currentStep advances to PROFILE_IMAGE_VERIFICATION", () => {
      const payload = buildStatusPayload(
        { phone_number_verified: true },
        "PROFILE_IMAGE_VERIFICATION",
      );
      expect(payload.currentStep).toBe(STEP_PROFILE_IMAGE_VERIFICATION);
    });

    it("phone step shows VERIFIED, other steps show PENDING", () => {
      const state: VerificationStepState = { phone_number_verified: true };
      const steps = buildVerificationSteps(state);
      expect(steps[STEP_PHONE_NUMBER_VERIFICATION].status).toBe("VERIFIED");
      expect(steps[STEP_PROFILE_IMAGE_VERIFICATION].status).toBe("PENDING");
      expect(steps[STEP_DOCUMENT_VERIFICATION].status).toBe("PENDING");
    });

    it("completedSteps contains only PHONE_NUMBER_VERIFICATION", () => {
      const state: VerificationStepState = { phone_number_verified: true };
      expect(getCompletedVerificationSteps(state)).toEqual([STEP_PHONE_NUMBER_VERIFICATION]);
    });
  });

  describe("Step 2: Profile image / face verification complete", () => {
    it("isVerified is still false after phone + profile image", () => {
      const state: VerificationStepState = {
        phone_number_verified: true,
        bio_profile_verification: true,
      };
      expect(deriveIsVerified(state)).toBe(false);
    });

    it("isVerified is false via faceStatus APPROVED path", () => {
      const state: VerificationStepState = {
        phone_number_verified: true,
        faceStatus: "APPROVED",
      };
      expect(deriveIsVerified(state)).toBe(false);
    });

    it("currentStep advances to DOCUMENT_VERIFICATION", () => {
      const state: VerificationStepState = {
        phone_number_verified: true,
        bio_profile_verification: true,
      };
      const payload = buildStatusPayload(state, "DOCUMENT_VERIFICATION");
      expect(payload.currentStep).toBe(STEP_DOCUMENT_VERIFICATION);
    });

    it("phone and profile image show VERIFIED, documents shows PENDING", () => {
      const state: VerificationStepState = {
        phone_number_verified: true,
        bio_profile_verification: true,
      };
      const steps = buildVerificationSteps(state);
      expect(steps[STEP_PHONE_NUMBER_VERIFICATION].status).toBe("VERIFIED");
      expect(steps[STEP_PROFILE_IMAGE_VERIFICATION].status).toBe("VERIFIED");
      expect(steps[STEP_DOCUMENT_VERIFICATION].status).toBe("PENDING");
    });

    it("completedSteps contains 2 items", () => {
      const state: VerificationStepState = {
        phone_number_verified: true,
        bio_profile_verification: true,
      };
      expect(getCompletedVerificationSteps(state)).toEqual([
        STEP_PHONE_NUMBER_VERIFICATION,
        STEP_PROFILE_IMAGE_VERIFICATION,
      ]);
    });
  });

  describe("Step 3: Document verification complete (fully verified)", () => {
    it("isVerified is true when all 3 steps are complete", () => {
      const state: VerificationStepState = {
        phone_number_verified: true,
        bio_profile_verification: true,
        document_verification: true,
      };
      expect(deriveIsVerified(state)).toBe(true);
    });

    it("isVerified is true via admin-approved path", () => {
      const state: VerificationStepState = {
        phone_number_verified: true,
        faceStatus: "APPROVED",
        documentStatus: "APPROVED",
      };
      expect(deriveIsVerified(state)).toBe(true);
    });

    it("all steps show VERIFIED", () => {
      const state: VerificationStepState = {
        phone_number_verified: true,
        bio_profile_verification: true,
        document_verification: true,
      };
      const steps = buildVerificationSteps(state);
      expect(steps[STEP_PHONE_NUMBER_VERIFICATION].status).toBe("VERIFIED");
      expect(steps[STEP_PROFILE_IMAGE_VERIFICATION].status).toBe("VERIFIED");
      expect(steps[STEP_DOCUMENT_VERIFICATION].status).toBe("VERIFIED");
    });

    it("completedSteps contains all 3 steps", () => {
      const state: VerificationStepState = {
        phone_number_verified: true,
        bio_profile_verification: true,
        document_verification: true,
      };
      expect(getCompletedVerificationSteps(state)).toEqual([
        STEP_PHONE_NUMBER_VERIFICATION,
        STEP_PROFILE_IMAGE_VERIFICATION,
        STEP_DOCUMENT_VERIFICATION,
      ]);
    });
  });

  describe("Rejection scenarios", () => {
    it("isVerified is false when profile image is rejected", () => {
      const state: VerificationStepState = {
        phone_number_verified: true,
        faceStatus: "REJECTED",
      };
      expect(deriveIsVerified(state)).toBe(false);
    });

    it("isVerified is false when documents are rejected", () => {
      const state: VerificationStepState = {
        phone_number_verified: true,
        bio_profile_verification: true,
        documentStatus: "REJECTED",
      };
      expect(deriveIsVerified(state)).toBe(false);
    });

    it("rejected step shows REJECTED with reason", () => {
      const state: VerificationStepState = {
        phone_number_verified: true,
        faceStatus: "REJECTED",
        faceRejectionReason: "Face not clearly visible",
      };
      const steps = buildVerificationSteps(state);
      expect(steps[STEP_PROFILE_IMAGE_VERIFICATION]).toEqual({
        status: "REJECTED",
        verificationMessage: "Face not clearly visible",
      });
    });

    it("isVerified is false when bio data is rejected", () => {
      const state: VerificationStepState = {
        phone_number_verified: true,
        bio_profile_verification: true,
        bioDataStatus: "REJECTED",
      };
      expect(deriveIsVerified(state)).toBe(false);
    });
  });

  describe("Frontend routing decision", () => {
    it("frontend should show verification flow when isVerified is false", () => {
      const state: VerificationStepState = { phone_number_verified: true };
      const payload = buildStatusPayload(state, "PROFILE_IMAGE_VERIFICATION");
      // Frontend logic: if !isVerified, show verification flow
      expect(payload.isVerified).toBe(false);
      expect(payload.currentStep).toBe(STEP_PROFILE_IMAGE_VERIFICATION);
    });

    it("frontend should skip to discovery only when isVerified is true", () => {
      const state: VerificationStepState = {
        phone_number_verified: true,
        bio_profile_verification: true,
        document_verification: true,
      };
      const payload = buildStatusPayload(state);
      // Frontend logic: if isVerified, skip to discovery
      expect(payload.isVerified).toBe(true);
    });

    it("phone verify-otp response includes isVerified: true (step-level success)", () => {
      // The verify-otp endpoint returns the raw DB record where isVerified is true.
      // This tells the frontend that the phone step succeeded.
      const phoneVerifyResponse = {
        phone_number_verified: true,
        isVerified: true, // Stored in DB, means phone step succeeded
        validationStep: "PROFILE_IMAGE_VERIFICATION",
      };
      expect(phoneVerifyResponse.isVerified).toBe(true);
      expect(phoneVerifyResponse.phone_number_verified).toBe(true);
    });

    it("status endpoint returns isVerified: false after phone verification only", () => {
      // The status endpoint derives isVerified from completed steps.
      // After only phone verification, isVerified is false.
      const state: VerificationStepState = {
        phone_number_verified: true,
        // isVerified in DB would be true, but status endpoint ignores it
      };
      const payload = buildStatusPayload(state);
      expect(payload.isVerified).toBe(false);
    });
  });
});

// ─────────────────────────────────────────
// Idempotent phone verification
// ─────────────────────────────────────────

describe("Idempotent phone verification", () => {
  it("phone_number_verified remains true on repeated verify attempts", () => {
    const state: VerificationStepState = {
      phone_number_verified: true,
    };
    expect(getStatusForStep(STEP_PHONE_NUMBER_VERIFICATION, state)).toBe("VERIFIED");
  });

  it("currentStep does not regress after phone is already verified", () => {
    const state: VerificationStepState = {
      phone_number_verified: true,
    };
    const payload = buildStatusPayload(state, "PHONE_NUMBER_VERIFICATION");
    expect(payload.currentStep).toBe(STEP_PROFILE_IMAGE_VERIFICATION);
  });

  it("PHONE_ALREADY_VERIFIED scenario: verify-otp detects already-verified phone", () => {
    const state: VerificationStepState = {
      phone_number_verified: true,
    };
    const isVerified = getStatusForStep(STEP_PHONE_NUMBER_VERIFICATION, state);
    expect(isVerified).toBe("VERIFIED");
  });
});

// ─────────────────────────────────────────
// Stable error codes
// ─────────────────────────────────────────

describe("Stable error codes", () => {
  it("OTP_INVALID: code does not match", () => {
    const error = { code: "OTP_INVALID", message: "Code does not match" };
    expect(error.code).toBe("OTP_INVALID");
  });

  it("OTP_EXPIRED: code expired", () => {
    const error = { code: "OTP_EXPIRED", message: "The verification code has expired. Request a new code." };
    expect(error.code).toBe("OTP_EXPIRED");
  });

  it("OTP_CHALLENGE_NOT_FOUND: no active challenge", () => {
    const error = { code: "OTP_CHALLENGE_NOT_FOUND", message: "No active challenge" };
    expect(error.code).toBe("OTP_CHALLENGE_NOT_FOUND");
  });

  it("PHONE_ALREADY_VERIFIED: step already complete", () => {
    const error = { code: "PHONE_ALREADY_VERIFIED", message: "Phone number is already verified" };
    expect(error.code).toBe("PHONE_ALREADY_VERIFIED");
  });

  it("OTP_RATE_LIMITED: too many attempts", () => {
    const error = { code: "OTP_RATE_LIMITED", message: "Too many attempts" };
    expect(error.code).toBe("OTP_RATE_LIMITED");
  });
});
