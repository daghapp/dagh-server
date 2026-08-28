import { describe, expect, it } from "vitest";
import {
  isDatingProfileComplete,
  resolveDatingProfileStatus,
} from "../src/helpers/dating-profile-status.js";

describe("isDatingProfileComplete", () => {
  it("returns false for no profile", () => {
    expect(isDatingProfileComplete(null)).toBe(false);
    expect(isDatingProfileComplete(undefined)).toBe(false);
  });

  it("returns false when there are no photos", () => {
    expect(isDatingProfileComplete({ photos: [], about: "bio", headline: "hi" })).toBe(false);
  });

  it("returns true with photos and a bio", () => {
    expect(isDatingProfileComplete({ photos: ["url"], about: "bio" })).toBe(true);
  });

  it("returns true with photos and a headline", () => {
    expect(isDatingProfileComplete({ photos: ["url"], headline: "hi" })).toBe(true);
  });

  it("returns true with photos and interests", () => {
    expect(isDatingProfileComplete({ photos: ["url"], interests: ["Cooking"] })).toBe(true);
  });

  it("returns false with photos only", () => {
    expect(isDatingProfileComplete({ photos: ["url"] })).toBe(false);
  });
});

describe("resolveDatingProfileStatus", () => {
  it("maps completeness to a status", () => {
    expect(resolveDatingProfileStatus({ photos: ["url"], about: "bio" })).toBe("COMPLETE");
    expect(resolveDatingProfileStatus({ photos: [] })).toBe("INCOMPLETE");
    expect(resolveDatingProfileStatus(null)).toBe("INCOMPLETE");
  });
});
