import { describe, expect, it } from "vitest";
import {
  buildAnnouncementPayload,
  buildExpoMessage,
  bodyForPayload,
  titleForPayload,
} from "../src/helpers/pushPayload.js";
import {
  createAnnouncementSchema,
  isEligibleForCategory,
} from "../src/validator/announcementValidation.js";

describe("buildAnnouncementPayload", () => {
  it("carries the announcement identity and only flat string values", () => {
    const payload = buildAnnouncementPayload({
      id: "ann-1",
      title: "Service update",
      body: "Scheduled maintenance tonight.",
      category: "ANNOUNCEMENT",
      route: "/notifications",
    });

    expect(payload).toEqual({
      type: "ANNOUNCEMENT",
      announcementId: "ann-1",
      title: "Service update",
      body: "Scheduled maintenance tonight.",
      category: "ANNOUNCEMENT",
      route: "/notifications",
      schemaVersion: "1",
    });
    expect(Object.values(payload).every((value) => typeof value === "string")).toBe(true);
  });

  it("renders title and body for Expo/FCM visible notifications", () => {
    const payload = buildAnnouncementPayload({
      id: "ann-2",
      title: "New feature",
      body: "Try the new itinerary planner.",
      category: "PROMOTION",
      route: null,
    });

    expect(titleForPayload(payload)).toBe("New feature");
    expect(bodyForPayload(payload)).toBe("Try the new itinerary planner.");

    const message = buildExpoMessage("ExponentPushToken[x]", payload);
    expect(message.title).toBe("New feature");
    expect(message.body).toBe("Try the new itinerary planner.");
    expect(message.data).toEqual(payload);
  });
});

describe("isEligibleForCategory", () => {
  it("sends service announcements unless the user opted out", () => {
    expect(isEligibleForCategory("ANNOUNCEMENT", null)).toBe(true);
    expect(
      isEligibleForCategory("ANNOUNCEMENT", {
        announcementsEnabled: true,
        promotionsEnabled: false,
      }),
    ).toBe(true);
    expect(
      isEligibleForCategory("ANNOUNCEMENT", {
        announcementsEnabled: false,
        promotionsEnabled: true,
      }),
    ).toBe(false);
  });

  it("requires explicit opt-in for promotions", () => {
    expect(isEligibleForCategory("PROMOTION", null)).toBe(false);
    expect(
      isEligibleForCategory("PROMOTION", {
        announcementsEnabled: true,
        promotionsEnabled: false,
      }),
    ).toBe(false);
    expect(
      isEligibleForCategory("PROMOTION", {
        announcementsEnabled: false,
        promotionsEnabled: true,
      }),
    ).toBe(true);
  });
});

describe("createAnnouncementSchema", () => {
  const base = {
    title: "Service update",
    body: "We will be briefly offline tonight.",
    category: "ANNOUNCEMENT" as const,
    audience: "ACTIVE" as const,
    sendNow: true,
  };

  it("accepts an immediate broadcast with defaults", () => {
    const parsed = createAnnouncementSchema.safeParse({
      title: "  Service update  ",
      body: "  We will be briefly offline tonight.  ",
      category: "ANNOUNCEMENT",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.title).toBe("Service update");
    expect(parsed.data.body).toBe("We will be briefly offline tonight.");
    expect(parsed.data.audience).toBe("ACTIVE");
    expect(parsed.data.sendNow).toBe(true);
  });

  it("requires a future scheduledAt when sendNow is false", () => {
    expect(createAnnouncementSchema.safeParse({ ...base, sendNow: false }).success).toBe(false);

    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(
      createAnnouncementSchema.safeParse({
        ...base,
        sendNow: false,
        scheduledAt: future,
      }).success,
    ).toBe(true);
  });

  it("rejects a scheduledAt in the past and conflicting sendNow/scheduledAt", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(
      createAnnouncementSchema.safeParse({
        ...base,
        sendNow: false,
        scheduledAt: past,
      }).success,
    ).toBe(false);
    expect(
      createAnnouncementSchema.safeParse({
        ...base,
        sendNow: true,
        scheduledAt: new Date(Date.now() + 60_000).toISOString(),
      }).success,
    ).toBe(false);
  });

  it("rejects unknown categories, overlong copy, and external routes", () => {
    expect(createAnnouncementSchema.safeParse({ ...base, category: "SALE" }).success).toBe(false);
    expect(createAnnouncementSchema.safeParse({ ...base, title: "x".repeat(121) }).success).toBe(
      false,
    );
    expect(createAnnouncementSchema.safeParse({ ...base, body: "x".repeat(501) }).success).toBe(
      false,
    );
    expect(
      createAnnouncementSchema.safeParse({ ...base, route: "https://example.com" }).success,
    ).toBe(false);
    expect(createAnnouncementSchema.safeParse({ ...base, route: "/notifications" }).success).toBe(
      true,
    );
  });
});
