import { describe, expect, it } from "vitest";
import {
  STEP_PHONE_NUMBER_VERIFICATION,
  STEP_PROFILE_IMAGE_VERIFICATION,
  STEP_DOCUMENT_VERIFICATION,
  getStatusForStep,
  getRejectionReason,
  buildVerificationSteps,
  getCompletedVerificationSteps,
  inferCurrentStep,
  type VerificationStepState,
} from "../src/helpers/verification-status.js";

describe("getStatusForStep", () => {
  it("reports PENDING for phone before verification", () => {
    expect(getStatusForStep(STEP_PHONE_NUMBER_VERIFICATION, null)).toBe("PENDING");
  });

  it("reports VERIFIED for phone once verified", () => {
    expect(getStatusForStep(STEP_PHONE_NUMBER_VERIFICATION, { phone_number_verified: true })).toBe(
      "VERIFIED",
    );
  });

  it("reports REJECTED for profile image when face is rejected", () => {
    const state: VerificationStepState = { faceStatus: "REJECTED" };
    expect(getStatusForStep(STEP_PROFILE_IMAGE_VERIFICATION, state)).toBe("REJECTED");
  });

  it("reports VERIFIED for profile image when face is approved", () => {
    const state: VerificationStepState = { faceStatus: "APPROVED" };
    expect(getStatusForStep(STEP_PROFILE_IMAGE_VERIFICATION, state)).toBe("VERIFIED");
  });

  it("reports VERIFIED for profile image when bio_profile_verification is true", () => {
    const state: VerificationStepState = { bio_profile_verification: true };
    expect(getStatusForStep(STEP_PROFILE_IMAGE_VERIFICATION, state)).toBe("VERIFIED");
  });

  it("reports PENDING for profile image before any review", () => {
    expect(getStatusForStep(STEP_PROFILE_IMAGE_VERIFICATION, {})).toBe("PENDING");
  });

  it("reports REJECTED for documents when document or bio data is rejected", () => {
    expect(getStatusForStep(STEP_DOCUMENT_VERIFICATION, { documentStatus: "REJECTED" })).toBe(
      "REJECTED",
    );
    expect(getStatusForStep(STEP_DOCUMENT_VERIFICATION, { bioDataStatus: "REJECTED" })).toBe(
      "REJECTED",
    );
  });

  it("reports VERIFIED for documents when document is approved", () => {
    const state: VerificationStepState = { documentStatus: "APPROVED" };
    expect(getStatusForStep(STEP_DOCUMENT_VERIFICATION, state)).toBe("VERIFIED");
  });

  it("reports VERIFIED for documents when document_verification is true", () => {
    const state: VerificationStepState = { document_verification: true };
    expect(getStatusForStep(STEP_DOCUMENT_VERIFICATION, state)).toBe("VERIFIED");
  });

  it("reports VERIFIED for documents when bio data is approved", () => {
    const state: VerificationStepState = { bioDataStatus: "APPROVED" };
    expect(getStatusForStep(STEP_DOCUMENT_VERIFICATION, state)).toBe("VERIFIED");
  });

  it("reports PENDING for documents before any review", () => {
    expect(getStatusForStep(STEP_DOCUMENT_VERIFICATION, {})).toBe("PENDING");
  });

  it("falls back to PENDING for unknown steps", () => {
    expect(getStatusForStep("UNKNOWN_STEP", {})).toBe("PENDING");
  });
});

describe("getRejectionReason", () => {
  it("returns the face rejection reason for the profile image step", () => {
    const state: VerificationStepState = {
      faceStatus: "REJECTED",
      faceRejectionReason: "Face not clearly visible",
    };
    expect(getRejectionReason(STEP_PROFILE_IMAGE_VERIFICATION, state)).toBe(
      "Face not clearly visible",
    );
  });

  it("falls back to verification_message when no step reason exists", () => {
    const state: VerificationStepState = {
      faceStatus: "REJECTED",
      verification_message: "Verification failed",
    };
    expect(getRejectionReason(STEP_PROFILE_IMAGE_VERIFICATION, state)).toBe("Verification failed");
  });

  it("prefers document over bio data rejection reason", () => {
    const state: VerificationStepState = {
      documentStatus: "REJECTED",
      documentRejectionReason: "Expired document",
      bioDataRejectionReason: "Bad bio data",
    };
    expect(getRejectionReason(STEP_DOCUMENT_VERIFICATION, state)).toBe("Expired document");
  });

  it("returns null when there is no state", () => {
    expect(getRejectionReason(STEP_PHONE_NUMBER_VERIFICATION, null)).toBeNull();
  });

  it("returns null when the step is not reviewable", () => {
    expect(getRejectionReason(STEP_PHONE_NUMBER_VERIFICATION, {})).toBeNull();
  });
});

describe("inferCurrentStep", () => {
  it("starts at phone verification when nothing is verified", () => {
    expect(inferCurrentStep({})).toBe(STEP_PHONE_NUMBER_VERIFICATION);
  });

  it("moves to profile image once the phone is verified", () => {
    expect(inferCurrentStep({ phone_number_verified: true })).toBe(STEP_PROFILE_IMAGE_VERIFICATION);
  });

  it("moves to documents once bio profile is verified", () => {
    expect(inferCurrentStep({ phone_number_verified: true, bio_profile_verification: true })).toBe(
      STEP_DOCUMENT_VERIFICATION,
    );
  });

  it("prefers the persisted validationStep", () => {
    expect(inferCurrentStep({}, "DOCUMENT_VERIFICATION")).toBe(STEP_DOCUMENT_VERIFICATION);
  });

  it("does not skip an unapproved image step just because a URL was submitted", () => {
    expect(
      inferCurrentStep(
        { phone_number_verified: true, faceStatus: "PENDING" },
        "PROFILE_IMAGE_VERIFICATION",
      ),
    ).toBe(STEP_PROFILE_IMAGE_VERIFICATION);
  });

  it("defaults to documents when every step is done", () => {
    expect(
      inferCurrentStep({
        phone_number_verified: true,
        bio_profile_verification: true,
        document_verification: true,
      }),
    ).toBe(STEP_DOCUMENT_VERIFICATION);
  });
});

describe("buildVerificationSteps", () => {
  it("reports every step PENDING with no state", () => {
    const steps = buildVerificationSteps(null);
    for (const step of Object.values(steps)) {
      expect(step.status).toBe("PENDING");
      expect(step.verificationMessage).toBeNull();
    }
  });

  it("marks a REJECTED step with its rejection message", () => {
    const steps = buildVerificationSteps({
      documentStatus: "REJECTED",
      documentRejectionReason: "Expired document",
    });
    expect(steps[STEP_DOCUMENT_VERIFICATION]).toEqual({
      status: "REJECTED",
      verificationMessage: "Expired document",
    });
  });

  it("leaves verificationMessage null for VERIFIED steps", () => {
    const steps = buildVerificationSteps({ phone_number_verified: true });
    expect(steps[STEP_PHONE_NUMBER_VERIFICATION]).toEqual({
      status: "VERIFIED",
      verificationMessage: null,
    });
  });
});

describe("getCompletedVerificationSteps", () => {
  it("returns only VERIFIED steps", () => {
    expect(getCompletedVerificationSteps({ phone_number_verified: true })).toEqual([
      STEP_PHONE_NUMBER_VERIFICATION,
    ]);
  });

  it("returns an empty array when nothing is verified", () => {
    expect(getCompletedVerificationSteps(null)).toEqual([]);
  });
});
