# Android Push Notification Field — Documentation

## Location
`src/helpers/pushPayload.ts` — the `buildFcmMessage` and `buildExpoMessage` functions.

## Overview
Every push message includes an Android-specific block that controls channel routing, priority, and sound. The server picks the channel based on the payload type.

## Channel Routing

| Payload type | Android `channelId` | Sound | Priority |
|---|---|---|---|
| `INCOMING_CALL` | `"calls"` | `"call_ringtone"` | `high` |
| `CALL_STATE_CHANGED` | (none — data-only) | — | `high` |
| All other payloads (messages, etc.) | `"messages"` | `"default"` | `high` |

## FCM Structure (`buildFcmMessage`)

### Incoming-call branch (visible alert, TTL-bounded)
```ts
android: {
  priority: "high",
  ttl: <min(30000, remaining ring ms)>,
  notification: {
    channelId: "calls",
    sound: "call_ringtone",
    tag: "incoming-call-<callId>",
  },
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

| Field | Type | Values | Notes |
|---|---|---|---|
| `priority` | `string` | `"high"` | Always high for notifications |
| `notification.channelId` | `string` | `"calls"` / `"messages"` | Must match a channel created on the client |
| `notification.sound` | `string` (optional) | `"call_ringtone"` / `"default"` | Calls reference the ringtone; messages use the default |
| `notification.tag` | `string` (optional) | `"incoming-call-<callId>"` | Replaces any older alert for the same call while ringing |
| `ttl` | `number` (ms, optional) | `min(30000, remaining)` | Incoming calls only — bounds delivery to the ring window |

## Important note
The server only **references** these `channelId`s. The actual `createNotificationChannel("calls" | "messages")` registration must exist in the **client app** — if the channel isn't created there, Android falls back to default behavior.

## Expo mirror (`buildExpoMessage`)
The same two-channel split applies for Expo push, where calls use a custom `call_ringtone.wav`:
```ts
channelId: isCall ? "calls" : "messages",
sound: isCall ? "call_ringtone.wav" : "default",
```