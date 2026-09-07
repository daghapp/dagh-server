import { describe, it, expect } from "vitest";
import { deviceTokenPatch, DEVICE_TOKEN_FIELDS } from "../src/modules/devices/deviceTokenPatch.js";

describe("deviceTokenPatch", () => {
  it("covers all four token fields", () => {
    expect(DEVICE_TOKEN_FIELDS).toEqual([
      "expoPushToken",
      "fcmToken",
      "apnsToken",
      "voipPushToken",
    ]);
  });

  it("preserves omitted fields on update (does not erase previously stored tokens)", () => {
    const patch = deviceTokenPatch({ deviceId: "d1", platform: "ANDROID", fcmToken: "fcm-1" });
    expect(patch.update).toEqual({ fcmToken: "fcm-1" });
    expect("expoPushToken" in patch.update).toBe(false);
    expect("voipPushToken" in patch.update).toBe(false);
    expect("apnsToken" in patch.update).toBe(false);
  });

  it("clears a token on explicit null", () => {
    const patch = deviceTokenPatch({ deviceId: "d2", platform: "IOS", voipPushToken: null });
    expect(patch.update).toEqual({ voipPushToken: null });
  });

  it("treats empty strings as explicit null clears (no garbage tokens stored)", () => {
    const patch = deviceTokenPatch({ deviceId: "d3", platform: "IOS", voipPushToken: "" });
    expect(patch.update).toEqual({ voipPushToken: null });
  });

  it("replaces a changed token while preserving the rest", () => {
    const patch = deviceTokenPatch({
      deviceId: "d4",
      platform: "ANDROID",
      fcmToken: "new-token",
      expoPushToken: "ExponentPushToken[abc]",
    });
    expect(patch.update).toEqual({
      fcmToken: "new-token",
      expoPushToken: "ExponentPushToken[abc]",
    });
  });

  it("includes only present fields on create, defaulting the rest to null", () => {
    const patch = deviceTokenPatch({ deviceId: "d5", platform: "ANDROID", fcmToken: "fcm-2" });
    expect(patch.create).toEqual({ fcmToken: "fcm-2" });
    expect("expoPushToken" in patch.create).toBe(false);
    expect("voipPushToken" in patch.create).toBe(false);
  });
});
