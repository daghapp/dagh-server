import { describe, it, expect } from "vitest";
import {
  sanitizePushData,
  buildIncomingCallPayload,
  buildCallStatePayload,
  buildNewMessagePayload,
  buildExpoMessage,
  buildFcmMessage,
  buildVoipMessage,
  providerForDevice,
  isInvalidTokenError,
  isTransientProviderError,
  titleForPayload,
  bodyForPayload,
  messagePreviewBody,
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

describe("providerForDevice with VoIP", () => {
  const callPayload: PushPayload = {
    type: "INCOMING_CALL",
    callId: "call-1",
    callerName: "Ama",
    callType: "VOICE",
  };

  it("prefers the PushKit VoIP token for call payloads on iOS", () => {
    expect(
      providerForDevice(
        {
          id: "d5",
          platform: "IOS",
          fcmToken: null,
          expoPushToken: "ExponentPushToken[c]",
          voipPushToken: "AABBCCDD",
        },
        callPayload,
      ),
    ).toEqual({ provider: "VOIP", token: "AABBCCDD" });
  });

  it("uses VoIP for CALL_STATE_CHANGED payloads too", () => {
    expect(
      providerForDevice(
        { id: "d6", platform: "IOS", fcmToken: null, expoPushToken: null, voipPushToken: "EEFF" },
        { type: "CALL_STATE_CHANGED", callId: "call-1", status: "DECLINED" },
      ),
    ).toEqual({ provider: "VOIP", token: "EEFF" });
  });

  it("never uses VoIP for non-call payloads", () => {
    expect(
      providerForDevice(
        {
          id: "d7",
          platform: "IOS",
          fcmToken: null,
          expoPushToken: "ExponentPushToken[c]",
          voipPushToken: "AABBCCDD",
        },
        { type: "NEW_MESSAGE", messageId: "msg-1", conversationId: "conv-1" },
      ),
    ).toEqual({ provider: "EXPO", token: "ExponentPushToken[c]" });
  });

  it("keeps the Expo fallback when payload is omitted (backward compatible)", () => {
    expect(
      providerForDevice({
        id: "d8",
        platform: "IOS",
        fcmToken: null,
        expoPushToken: "ExponentPushToken[c]",
        voipPushToken: "AABBCCDD",
      }),
    ).toEqual({ provider: "EXPO", token: "ExponentPushToken[c]" });
  });

  it("does not apply VoIP to Android even with a voipPushToken", () => {
    expect(
      providerForDevice(
        {
          id: "d9",
          platform: "ANDROID",
          fcmToken: "fcm-1",
          expoPushToken: null,
          voipPushToken: "AABB",
        },
        callPayload,
      ),
    ).toEqual({ provider: "FCM", token: "fcm-1" });
  });
});

describe("buildVoipMessage", () => {
  it("builds a voip push with .voip topic and call data at the top level", () => {
    const payload: PushPayload = {
      type: "INCOMING_CALL",
      callId: "call-1",
      callType: "VOICE",
      callerName: "Ama",
    };
    const msg = buildVoipMessage("AABBCCDD", payload, "com.dagh.app.voip");
    expect(msg.to).toBe("AABBCCDD");
    expect(msg.pushType).toBe("voip");
    expect(msg.topic).toBe("com.dagh.app.voip");
    expect(msg.body.aps["content-available"]).toBe(1);
    expect(msg.body.callId).toBe("call-1");
    expect(msg.body.callerName).toBe("Ama");
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

  it("bounds delivery with a TTL when provided", () => {
    const msg = buildExpoMessage("ExponentPushToken[x]", payload, 30);
    expect(msg.ttl).toBe(30);
    const unbounded = buildExpoMessage("ExponentPushToken[x]", payload);
    expect(unbounded.ttl).toBeUndefined();
  });
});

describe("buildFcmMessage", () => {
  it("builds a high-priority visible incoming-call message with calls channel", () => {
    const payload: PushPayload = { type: "INCOMING_CALL", callId: "call-1", callerName: "Ama" };
    const msg = buildFcmMessage("fcm-1", payload);
    expect(msg.token).toBe("fcm-1");
    expect(msg.data).toEqual(payload);
    expect(msg.android.priority).toBe("high");
    expect(msg.apns.headers["apns-priority"]).toBe("10");
    expect(msg.notification).toBeDefined();
    expect(msg.android.notification).toBeDefined();
    expect(msg.android.notification!.channelId).toBe("calls");
    expect(msg.android.notification!.sound).toBe("call_ringtone");
    expect(msg.android.notification!.tag).toBe("incoming-call-call-1");
  });

  it("applies the incoming-call TTL when provided", () => {
    const payload: PushPayload = { type: "INCOMING_CALL", callId: "call-2" };
    const msg = buildFcmMessage("fcm-1", payload, 30_000);
    expect(msg.android.ttl).toBe(30_000);
  });

  it("keeps CALL_STATE_CHANGED silent and data-only", () => {
    const payload: PushPayload = { type: "CALL_STATE_CHANGED", callId: "call-1", status: "MISSED" };
    const msg = buildFcmMessage("fcm-1", payload);
    expect(msg.data).toEqual(payload);
    expect(msg.notification).toBeUndefined();
    expect(msg.android.notification).toBeUndefined();
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

  it("flags APNs VoIP token errors as invalid tokens", () => {
    expect(isInvalidTokenError("APNs 400: BadDeviceToken")).toBe(true);
    expect(isInvalidTokenError("APNs 404: MissingDeviceToken")).toBe(true);
    expect(isInvalidTokenError("APNs 410: Unregistered")).toBe(true);
    expect(isInvalidTokenError("APNs 400: DeviceTokenNotForTopic")).toBe(true);
  });

  it("flags transient failures for retry", () => {
    expect(isTransientProviderError(new Error("socket hang up: timeout"))).toBe(true);
    expect(isTransientProviderError("messaging/server-unavailable")).toBe(true);
    expect(isTransientProviderError(new Error("DeviceNotRegistered"))).toBe(false);
  });

  it("flags APNs transient failures for retry", () => {
    expect(isTransientProviderError("APNs 503: ServiceUnavailable")).toBe(true);
    expect(isTransientProviderError("APNs 429: TooManyRequests")).toBe(true);
    expect(isTransientProviderError("APNs 500: InternalServerError")).toBe(true);
    expect(isTransientProviderError("APNs network: connect ECONNREFUSED 127.0.0.1")).toBe(true);
    expect(isTransientProviderError("APNs 410: Unregistered")).toBe(false);
  });
});

describe("buildNewMessagePayload", () => {
  const message = {
    id: "msg-123",
    type: "TEXT",
    content: "Hello, how are you?",
  };
  const sender = {
    id: "sender-1",
    fullName: "Simply Mark",
    profile: { bio_profile_image_url: "https://example.com/photo.jpg" },
  };

  it("carries type NEW_MESSAGE and all required tap-to-open fields", () => {
    const payload = buildNewMessagePayload(message, sender, "conv-1");
    expect(payload.type).toBe("NEW_MESSAGE");
    expect(payload.messageId).toBe("msg-123");
    expect(payload.conversationId).toBe("conv-1");
    expect(payload.senderId).toBe("sender-1");
    expect(payload.senderName).toBe("Simply Mark");
    expect(payload.senderAvatarUrl).toBe("https://example.com/photo.jpg");
    expect(payload.senderImageUrl).toBe("https://example.com/photo.jpg");
    expect(payload.messageType).toBe("TEXT");
    expect(payload.previewBody).toBe("Hello, how are you?");
    expect(payload.route).toBe("/(connect)/chat/[id]");
    expect(payload.schemaVersion).toBe("1");
    expect(Object.values(payload).every((v) => typeof v === "string")).toBe(true);
  });

  it("omits senderAvatarUrl when the sender has no public profile photo", () => {
    const payload = buildNewMessagePayload(
      message,
      { id: "sender-2", fullName: "B", profile: { bio_profile_image_url: null, profileUrl: null } },
      "conv-1",
    );
    expect("senderAvatarUrl" in payload).toBe(false);
    expect("senderImageUrl" in payload).toBe(false);
  });

  it("uses correct messageType for IMAGE", () => {
    const payload = buildNewMessagePayload(
      { id: "msg-2", type: "IMAGE", content: null },
      sender,
      "conv-1",
    );
    expect(payload.messageType).toBe("IMAGE");
  });
});

describe("messagePreviewBody", () => {
  it("returns sanitized text for TEXT messages", () => {
    expect(messagePreviewBody("TEXT", "Hello there")).toBe("Hello there");
  });

  it("truncates long text to ~120 chars", () => {
    const longText = "A".repeat(200);
    expect(messagePreviewBody("TEXT", longText).length).toBeLessThanOrEqual(120);
  });

  it("strips HTML markup from text", () => {
    expect(messagePreviewBody("TEXT", "<b>Hello</b> world")).toBe("Hello world");
  });

  it("collapses whitespace", () => {
    expect(messagePreviewBody("TEXT", "Hello   world")).toBe("Hello world");
  });

  it("returns fixed strings for media types", () => {
    expect(messagePreviewBody("VOICE_NOTE")).toBe("Sent a voice message");
    expect(messagePreviewBody("IMAGE")).toBe("Sent a photo");
    expect(messagePreviewBody("VIDEO")).toBe("Sent a video");
    expect(messagePreviewBody("DOCUMENT")).toBe("Sent a document");
  });

  it("returns fallback for unknown types", () => {
    expect(messagePreviewBody("UNKNOWN_TYPE")).toBe("New message");
  });

  it("returns fallback when TEXT has no content", () => {
    expect(messagePreviewBody("TEXT")).toBe("New message");
  });
});

describe("titleForPayload / bodyForPayload for messages", () => {
  it("returns sender name as title for NEW_MESSAGE", () => {
    const payload: PushPayload = {
      type: "NEW_MESSAGE",
      senderName: "Simply Mark",
      messageType: "TEXT",
    };
    expect(titleForPayload(payload)).toBe("Simply Mark");
  });

  it("returns sanitized content as body for TEXT messages", () => {
    const payload: PushPayload = {
      type: "NEW_MESSAGE",
      messageType: "TEXT",
      previewBody: "Hello!",
    };
    expect(bodyForPayload(payload)).toBe("Hello!");
  });

  it("returns fixed body for IMAGE messages", () => {
    const payload: PushPayload = {
      type: "NEW_MESSAGE",
      messageType: "IMAGE",
      previewBody: "Sent a photo",
    };
    expect(bodyForPayload(payload)).toBe("Sent a photo");
  });

  it("returns fixed body for VOICE_NOTE messages", () => {
    const payload: PushPayload = {
      type: "NEW_MESSAGE",
      messageType: "VOICE_NOTE",
      previewBody: "Sent a voice message",
    };
    expect(bodyForPayload(payload)).toBe("Sent a voice message");
  });

  it("returns fixed body for VIDEO messages", () => {
    const payload: PushPayload = {
      type: "NEW_MESSAGE",
      messageType: "VIDEO",
      previewBody: "Sent a video",
    };
    expect(bodyForPayload(payload)).toBe("Sent a video");
  });
});

describe("buildExpoMessage for messages", () => {
  const payload: PushPayload = {
    type: "NEW_MESSAGE",
    senderName: "Simply Mark",
    messageType: "TEXT",
    messageId: "msg-1",
    conversationId: "conv-1",
    senderId: "sender-1",
  };

  it("uses messages channel and default sound for NEW_MESSAGE", () => {
    const msg = buildExpoMessage("ExponentPushToken[x]", payload);
    expect(msg.channelId).toBe("messages");
    expect(msg.sound).toBe("default");
    expect(msg.title).toBe("Simply Mark");
    expect(msg.priority).toBe("high");
    expect(msg.data).toEqual(payload);
  });

  it("still uses calls channel and ringtone for INCOMING_CALL", () => {
    const callPayload: PushPayload = {
      type: "INCOMING_CALL",
      callType: "VOICE",
      callerName: "Ama",
    };
    const msg = buildExpoMessage("ExponentPushToken[y]", callPayload);
    expect(msg.channelId).toBe("calls");
    expect(msg.sound).toBe("call_ringtone.wav");
  });
});

describe("buildFcmMessage for messages", () => {
  it("builds a visible notification with data payload for NEW_MESSAGE", () => {
    const payload: PushPayload = {
      type: "NEW_MESSAGE",
      senderName: "Simply Mark",
      messageType: "TEXT",
      content: "Hello",
    };
    const msg = buildFcmMessage("fcm-1", payload);
    expect(msg.token).toBe("fcm-1");
    expect(msg.notification).toBeDefined();
    expect(msg.notification!.title).toBe("Simply Mark");
    expect(msg.notification!.body).toBe("Hello");
    expect(msg.data).toEqual(payload);
    expect(msg.android.notification).toBeDefined();
    expect(msg.android.notification!.channelId).toBe("messages");
    expect(msg.android.notification!.sound).toBe("default");
  });

  it("builds a visible incoming-call alert on the calls channel", () => {
    const payload: PushPayload = {
      type: "INCOMING_CALL",
      callId: "call-1",
      callerName: "Ama",
      callType: "VOICE",
    };
    const msg = buildFcmMessage("fcm-2", payload);
    expect(msg.token).toBe("fcm-2");
    expect(msg.data).toEqual(payload);
    expect(msg.android.priority).toBe("high");
    expect(msg.notification).toBeDefined();
    expect(msg.android.notification).toBeDefined();
    expect(msg.android.notification!.channelId).toBe("calls");
    expect(msg.android.notification!.sound).toBe("call_ringtone");
  });

  it("keeps CALL_STATE_CHANGED data-only too", () => {
    const payload: PushPayload = { type: "CALL_STATE_CHANGED", callId: "call-1", status: "MISSED" };
    const msg = buildFcmMessage("fcm-3", payload);
    expect(msg.data).toEqual(payload);
    expect(msg.notification).toBeUndefined();
    expect(msg.android.notification).toBeUndefined();
  });
});
