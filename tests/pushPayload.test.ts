import { describe, it, expect } from "vitest";
import {
  sanitizePushData,
  buildIncomingCallPayload,
  buildCallStatePayload,
  buildExpoMessage,
  buildFcmMessage,
  providerForDevice,
  isInvalidTokenError,
  isTransientProviderError,
  titleForPayload,
  bodyForPayload,
  type PushPayload,
} from "../src/helpers/pushPayload.js";

describe("sanitizePushData", () => {
  it("drops null and undefined values", () => {
    const out = sanitizePushData({ a: "x", b: null, c: undefined });
    expect(out).toEqual({ a: "x" });
    expect(Object.values(out).every((v) => typeof v === "string")).toBe(true);
  });

  it("stringifies numbers, booleans, and objects", () => {
    const out = sanitizePushData({ n: 42, ok: true, obj: { nested: 1 } });
    expect(out.n).toBe("42");
    expect(out.ok).toBe("true");
    expect(JSON.parse(out.obj)).toEqual({ nested: 1 });
  });
});

describe("buildIncomingCallPayload", () => {
  const call = {
    id: "call-123",
    callType: "VOICE" as const,
    conversationId: "conv-1",
    expiresAt: new Date("2026-08-29T12:01:00.000Z"),
  };
  const caller = {
    id: "caller-1",
    fullName: "Ama Mensah",
    profile: { bio_profile_image_url: "https://example.com/photo.jpg" },
  };

  it("carries type INCOMING_CALL and the exact call ID inside data", () => {
    const payload = buildIncomingCallPayload(call, caller);
    expect(payload.type).toBe("INCOMING_CALL");
    expect(payload.callId).toBe("call-123");
    expect(payload.callerId).toBe("caller-1");
    expect(payload.callerName).toBe("Ama Mensah");
    expect(payload.conversationId).toBe("conv-1");
    expect(payload.expiresAt).toBe("2026-08-29T12:01:00.000Z");
    expect(Object.values(payload).every((v) => typeof v === "string")).toBe(true);
  });

  it("omits image URL when the caller has no public profile photo", () => {
    const payload = buildIncomingCallPayload(call, {
      id: "caller-2",
      fullName: "B",
      profile: { bio_profile_image_url: null, profileUrl: null },
    });
    expect("callerImageUrl" in payload).toBe(false);
  });
});

describe("buildCallStatePayload", () => {
  it("reports the terminal status and version", () => {
    const payload = buildCallStatePayload({
      id: "call-1",
      callType: "VIDEO",
      status: "CANCELLED",
      conversationId: null,
      version: 3,
    });
    expect(payload.type).toBe("CALL_STATE_CHANGED");
    expect(payload.status).toBe("CANCELLED");
    expect(payload.sequence).toBe("3");
    expect(payload.callId).toBe("call-1");
  });
});

describe("providerForDevice", () => {
  it("prefers the native FCM token on Android", () => {
    expect(
      providerForDevice({
        id: "d1",
        platform: "ANDROID",
        fcmToken: "fcm-1",
        expoPushToken: "ExponentPushToken[a]",
      }),
    ).toEqual({ provider: "FCM", token: "fcm-1" });
  });

  it("falls back to the Expo token on Android without FCM", () => {
    expect(
      providerForDevice({
        id: "d2",
        platform: "ANDROID",
        fcmToken: null,
        expoPushToken: "ExponentPushToken[b]",
      }),
    ).toEqual({ provider: "EXPO", token: "ExponentPushToken[b]" });
  });

  it("uses the Expo token on iOS", () => {
    expect(
      providerForDevice({
        id: "d3",
        platform: "IOS",
        fcmToken: null,
        expoPushToken: "ExponentPushToken[c]",
      }),
    ).toEqual({ provider: "EXPO", token: "ExponentPushToken[c]" });
  });

  it("returns null when no usable token exists", () => {
    expect(
      providerForDevice({ id: "d4", platform: "ANDROID", fcmToken: null, expoPushToken: null }),
    ).toBeNull();
  });
});

describe("buildExpoMessage", () => {
  const payload: PushPayload = { type: "INCOMING_CALL", callId: "call-1", callerName: "Ama" };

  it("adds high priority, calls channel, and ringtone for incoming calls", () => {
    const msg = buildExpoMessage("ExponentPushToken[x]", payload);
    expect(msg.channelId).toBe("calls");
    expect(msg.priority).toBe("high");
    expect(msg.sound).toBe("call_ringtone.wav");
    expect(msg.title).toBe("Incoming voice call");
    expect(msg.body).toBe("Ama is calling...");
    expect(msg.data).toEqual(payload);
  });
});

describe("buildFcmMessage", () => {
  it("builds a high-priority data-only message", () => {
    const payload: PushPayload = { type: "INCOMING_CALL", callId: "call-1" };
    const msg = buildFcmMessage("fcm-1", payload);
    expect(msg.token).toBe("fcm-1");
    expect(msg.data).toEqual(payload);
    expect(msg.android.priority).toBe("high");
    expect(msg.apns.headers["apns-priority"]).toBe("10");
  });
});

describe("titleForPayload / bodyForPayload", () => {
  it("differentiates video vs voice", () => {
    expect(titleForPayload({ type: "INCOMING_CALL", callType: "VIDEO" })).toBe(
      "Incoming video call",
    );
    expect(titleForPayload({ type: "INCOMING_CALL", callType: "VOICE" })).toBe(
      "Incoming voice call",
    );
    expect(bodyForPayload({ type: "CALL_STATE_CHANGED", status: "MISSED" })).toBe("Missed call");
    expect(bodyForPayload({ type: "CALL_STATE_CHANGED", status: "CANCELLED" })).toBe(
      "Call cancelled",
    );
  });
});

describe("error classification", () => {
  it("flags device-registration errors as invalid tokens", () => {
    expect(isInvalidTokenError(new Error("DeviceNotRegistered"))).toBe(true);
    expect(isInvalidTokenError({ message: "messaging/registration-token-not-registered" })).toBe(
      true,
    );
    expect(isInvalidTokenError("expo: device not registered")).toBe(true);
    expect(isInvalidTokenError(new Error("Connection reset"))).toBe(false);
  });

  it("flags transient failures for retry", () => {
    expect(isTransientProviderError(new Error("socket hang up: timeout"))).toBe(true);
    expect(isTransientProviderError("messaging/server-unavailable")).toBe(true);
    expect(isTransientProviderError(new Error("DeviceNotRegistered"))).toBe(false);
  });
});
