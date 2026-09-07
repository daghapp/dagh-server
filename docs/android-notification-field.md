# Android Push Notification Field — Documentation

## Location

`src/helpers/pushPayload.ts` — the `buildFcmMessage` and `buildExpoMessage` functions.

## Overview

Every push message includes an Android-specific block that controls channel routing, priority, and sound. The server picks the channel based on the payload type.

## Channel Routing

| Payload type                        | Android `channelId` | Sound       | Priority |
| ----------------------------------- | ------------------- | ----------- | -------- |
| `INCOMING_CALL`                     | (none — data-only)  | —           | `high`   |
| `CALL_STATE_CHANGED`                | (none — data-only)  | —           | `high`   |
| All other payloads (messages, etc.) | `"messages"`        | `"default"` | `high`   |

## FCM Structure (`buildFcmMessage`)

### Incoming-call branch (data-only, TTL-bounded)

Native incoming calls use a **data-only** FCM message so the app's own call receiver presents the call. Android handling of a `notification` block would bypass the custom receiver, so no notification object is included.

```ts
android: {
  priority: "high",
  ttl: <remaining ring ms>,
  // no notification block — data-only so the native call receiver owns presentation
}
```

### Call-state-changed branch (silent cleanup)

```ts
android: {
  priority: "high",
  // no notification block — data-only so only the app dismisses ringing state
}
```

### Other branch

```ts
android: {
  priority: "high",
  notification: { channelId: "messages", sound: "default" },
}
```

## Field breakdown

| Field                    | Type                    | Values                          | Notes                                                                                                 |
| ------------------------ | ----------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `priority`               | `string`                | `"high"`                        | Always high for notifications                                                                         |
| `notification.channelId` | `string`                | `"calls"` / `"messages"`        | Must match a channel created on the client. **Only messages use this** — incoming calls are data-only |
| `notification.sound`     | `string` (optional)     | `"call_ringtone"` / `"default"` | Used for visible message notifications                                                                |
| `notification.tag`       | `string` (optional)     | `"incoming-call-<callId>"`      | No longer used — incoming calls are data-only                                                         |
| `ttl`                    | `number` (ms, optional) | `remaining ring ms`             | Incoming calls only — TTL equals the remaining ring time (never exceeds it)                           |

## Important note

The server only **references** these `channelId`s. The actual `createNotificationChannel("calls" | "messages")` registration must exist in the **client app** — if the channel isn't created there, Android falls back to default behavior.

## Expo mirror (`buildExpoMessage`)

The same two-channel split applies for Expo push, where calls use a custom `call_ringtone.wav`:

```ts
channelId: isCall ? "calls" : "messages",
sound: isCall ? "call_ringtone.wav" : "default",
```
