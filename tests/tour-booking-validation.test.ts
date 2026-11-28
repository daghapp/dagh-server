import { describe, expect, it } from "vitest";
import { validateTourBooking } from "../src/modules/tour-management/tour-booking-validation.js";

describe("tour booking validation", () => {
  const valid = {
    numberOfPeople: 2,
    tourStartDate: new Date("2099-01-01T00:00:00Z"),
    basePrice: 100,
    minimumBooking: 2,
  };

  it("accepts a valid future trip", () => {
    expect(validateTourBooking(valid)).toBeNull();
  });

  it("rejects past and invalid dates", () => {
    expect(validateTourBooking({ ...valid, tourStartDate: new Date(0) })).not.toBeNull();
    expect(validateTourBooking({ ...valid, tourStartDate: new Date("invalid") })).not.toBeNull();
  });

  it("enforces integer traveller counts and the minimum group size", () => {
    expect(validateTourBooking({ ...valid, numberOfPeople: 1 })).not.toBeNull();
    expect(validateTourBooking({ ...valid, numberOfPeople: 2.5 })).not.toBeNull();
  });

  it("rejects negative and nonfinite prices", () => {
    expect(validateTourBooking({ ...valid, basePrice: -1 })).not.toBeNull();
    expect(validateTourBooking({ ...valid, basePrice: Infinity })).not.toBeNull();
  });
});
