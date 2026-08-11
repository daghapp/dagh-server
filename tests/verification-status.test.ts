import { describe, expect, it } from "vitest";
import {
  STEP_PHONE_NUMBER_VERIFICATION,
  STEP_PROFILE_IMAGE_VERIFICATION,
  STEP_DOCUMENT_VERIFICATION,
  getStatusForStep,
  getRejectionReason,
  type VerificationStepState,
} from "./verification-status.js";

describe("getStatusForStep", () => {
  it("reports PENDING for phone before verification", () => {
    expect(getStatusForStep(STEP_PHONE_NUMBER_VERIFICATION, null)).toBe("PENDING");
  });

  it("reports VERIFIED for phone once verified", () => {
    expect(
      getStatusForStep(STEP_PHONE_NUMBER_VERIFICATION, { phone_number_verified: true }),
    ).toBe("VERIFIED");
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
    expect(
      getStatusForStep(STEP_DOCUMENT_VERIFICATION, { documentStatus: "REJECTED" }),
    ).toBe("REJECTED");
    expect(
      getStatusForStep(STEP_DOCUMENT_VERIFICATION, { bioDataStatus: "REJECTED" }),
    ).toBe("REJECTED");
  });

  it("reports VERIFIED for documents when document is approved", () => {
    const state: VerificationStepState = { documentStatus: "APPROVED" };
    expect(getStatusForStep(STEP_DOCUMENT_VERIFICATION, state)).toBe("VERIFIED");
  });

  it("reports VERIFIED for documents when document_verification is true", () => {
    const state: VerificationStepState = { document_verification: true };
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
    expect(getRejectionReason(STEP_PROFILE_IMAGE_VERIFICATION, state)).toBe(
      "Verification failed",
    );
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
