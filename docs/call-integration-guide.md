# Voice & Video Calling — Frontend Integration Guide

This guide covers everything the frontend needs to implement WhatsApp-style voice and video calls. The backend is complete and deployed to Neon.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Dependencies](#dependencies)
3. [Device Registration](#device-registration)
4. [Call Lifecycle (REST)](#call-lifecycle-rest)
5. [Socket Events](#socket-events)
6. [LiveKit Integration](#livekit-integration)
7. [Push Notifications](#push-notifications)
8. [Incoming Call Screen](#incoming-call-screen)
9. [Active Call Screen](#active-call-screen)
10. [Call History](#call-history)
11. [Native Platform Integration](#native-platform-integration)
12. [Error Handling](#error-handling)
13. [Testing Checklist](#testing-checklist)

---

## Architecture Overview

```
┌──────────────┐     REST API      ┌──────────────┐
│  Mobile App  │ ───────────────── │  Backend API  │
│  (Expo)      │ ◄──────────────── │  (Express)    │
└──────┬───────┘                   └──────┬────────┘
       │                                  │
       │  Socket.IO                       │  Socket.IO
       │  (signaling +                    │  (fan-out to
       │   call events)                   │   participants)
       │                                  │
       ├──► call.incoming                 ├──► call.incoming
       ├──► call.answered                 ├──► call.answered
       ├──► call.declined                 ├──► call.declined
       ├──► call.cancelled                ├──► call.cancelled
       ├──► call.ended                    ├──► call.ended
       ├──► call.missed                   ├──► call.missed
       │                                  │
       │  LiveKit SDK                     │  LiveKit Server
       │  (media transport)               │  (WebRTC SFU)
       └──────────────────────────────────┘
```

**Key principle:** Call lifecycle (initiate, answer, decline, cancel, end) is handled via **REST endpoints**. Socket events are for **real-time notifications** and **WebRTC signaling relay**. LiveKit handles **media transport** after participants join a room.

---

## Dependencies

```bash
npx expo install livekit-client expo-notifications expo-device expo-constants
```

Optional for native calling:
```bash
npx expo install react-native-callkit  # iOS CallKit (via expo module)
# Or use @react-native-voip-push-notification + expo-callkit
```

---

## Device Registration

Register the device for push notifications on **every app launch (after login)**. The server upserts on `(userId, deviceId)` and refreshes the tokens and `lastSeenAt` each time, so a re-registered installation is always preferred. Never identify an installation only by its push token — tokens rotate, so always send the stable `deviceId`.

### Register Device

```typescript
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";

interface RegisterDeviceParams {
  platform: "IOS" | "ANDROID";
  expoPushToken?: string;
  fcmToken?: string;
  apnsToken?: string;
  voipPushToken?: string;
}

async function registerDevice(params: RegisterDeviceParams) {
  const deviceId = await getOrCreateDeviceId(); // persist in AsyncStorage, stable per install

  const response = await fetch(`${API_URL}/devices/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      deviceId,
      platform,
      expoPushToken,
      fcmToken,
      apnsToken,
      voipPushToken,
    }),
  });

  return response.json();
}
```

### Get Push Token

```typescript
async function getPushToken(): Promise<{ expoToken?: string; fcmToken?: string; voipToken?: string }> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== "granted") return {};

  if (Platform.OS === "android") {
    // Installed APK (production or EAS dev client): native FCM device token.
    // The server sends a visible high-priority notification for incoming calls
    // and data-only for state changes, so background delivery works without JS.
    const token = await Notifications.getDevicePushTokenAsync();
    return { fcmToken: token.data };
  }

  // iOS: Expo push token (delivered via APNs).
  const expoToken = await Notifications.getExpoPushTokenAsync({
    projectId: Constants.expoConfig?.extra?.eas?.projectId,
  });
  return { expoToken: expoToken.data };
}
```

> **Expo Go vs installed APK:** Expo Go produces a different push token than a
> production/EAS build for the same phone. Both are separate installations with
> separate `deviceId`s — the backend targets whatever the APK registered. If
> calls only arrive in Expo Go, the APK is not registering its own FCM/Expo
> token (or that token is being rejected by FCM).
>
> **iOS VoIP (true lock-screen calling):** register the PushKit VoIP token via a
> native module during startup and include it as `voipPushToken` (see
> [Native Platform Integration](#native-platform-integration)). Report VoIP
> pushes to CallKit immediately.

### Unregister Device

Call on logout:
```typescript
async function unregisterDevice(deviceId: string) {
  await fetch(`${API_URL}/devices/${deviceId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
```
The server also disables every device for the user during `POST /auth/logout`, and
automatically disables + removes any push token a provider later rejects
(`DeviceNotRegistered`).

---

## Call Lifecycle (REST)

All call state transitions go through REST. The server atomically validates permissions and state before each transition.

### 1. Initiate Call

```typescript
interface InitiateCallParams {
  receiverId: string;
  conversationId?: string;
  callType: "VOICE" | "VIDEO";
}

async function initiateCall(params: InitiateCallParams) {
  const idempotencyKey = crypto.randomUUID(); // prevent duplicate calls on retry

  const response = await fetch(`${API_URL}/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(params),
  });

  const data = await response.json();

  if (!data.success) {
    throw new CallError(data.error.code, data.error.message);
  }

  return {
    call: data.data.call,       // { id, roomId, status, expiresAt, ... }
    token: data.data.token,     // LiveKit JWT token
    serviceUrl: data.data.serviceUrl, // wss://livekit.example.com
  };
}
```

### 2. Answer Call

```typescript
async function answerCall(callId: string) {
  const response = await fetch(`${API_URL}/calls/${callId}/answer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();
  if (!data.success) throw new CallError(data.error.code, data.error.message);

  return {
    callId: data.data.callId,
    roomId: data.data.roomId,
    status: data.data.status,     // "ANSWERED"
    token: data.data.token,       // LiveKit JWT for receiver
    serviceUrl: data.data.serviceUrl,
  };
}
```

### 3. Decline Call

```typescript
async function declineCall(callId: string) {
  const response = await fetch(`${API_URL}/calls/${callId}/decline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return response.json();
}
```

### 4. Cancel Call

```typescript
async function cancelCall(callId: string) {
  const response = await fetch(`${API_URL}/calls/${callId}/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return response.json();
}
```

### 5. End Call

```typescript
async function endCall(callId: string) {
  const response = await fetch(`${API_URL}/calls/${callId}/end`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return response.json();
}
```

### 6. Get LiveKit Token (for rejoining or refreshing)

```typescript
async function getCallToken(callId: string) {
  const response = await fetch(`${API_URL}/calls/${callId}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();
  if (!data.success) throw new CallError(data.error.code, data.error.message);

  return {
    token: data.data.token,
    serviceUrl: data.data.serviceUrl,
    expiresIn: data.data.expiresIn, // 120 seconds
  };
}
```

### 7. Get Call State

```typescript
async function getCallState(callId: string) {
  const response = await fetch(`${API_URL}/calls/${callId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return response.json();
}
```

---

## Socket Events

Connect to Socket.IO with the access token (existing pattern). Listen for call events.

### Setup

```typescript
import { io } from "socket.io-client";

const socket = io(API_URL, {
  auth: { token: accessToken },
});

// Listen for call events
socket.on("call.incoming", handleIncomingCall);
socket.on("call.ringing", handleRinging);
socket.on("call.answered", handleCallAnswered);
socket.on("call.answered_elsewhere", handleAnsweredElsewhere);
socket.on("call.declined", handleCallDeclined);
socket.on("call.cancelled", handleCallCancelled);
socket.on("call.ended", handleCallEnded);
socket.on("call.missed", handleCallMissed);
socket.on("call.failed", handleCallFailed);

// WebRTC signaling (for non-LiveKit or fallback)
socket.on("call:signal_received", handleSignalReceived);
socket.on("call:switch_video_requested", handleSwitchVideoRequested);
socket.on("call:switch_video_responded", handleSwitchVideoResponded);
socket.on("call:peer_state_changed", handlePeerStateChanged);
```

### Event Payloads

All events include `sequence` (monotonically increasing) so clients can ignore stale events.

```typescript
// call.incoming — shown on incoming call screen
{
  callId: string,
  callType: "VOICE" | "VIDEO",
  conversationId: string | null,
  caller: {
    id: string,
    fullName: string,
    profileImageUrl: string | null,
  },
  status: "RINGING",
  expiresAt: string,       // ISO timestamp — call auto-expires
  sequence: number,
  occurredAt: string,
}

// call.answered — caller receives this when receiver answers
{
  callId: string,
  roomId: string,
  status: "ANSWERED",
  sequence: number,
  occurredAt: string,
}

// call.declined / call.cancelled / call.ended / call.missed
{
  callId: string,
  callType: "VOICE" | "VIDEO",
  status: "DECLINED" | "CANCELLED" | "ENDED" | "MISSED",
  sequence: number,
  occurredAt: string,
}

// call.ended (from answered state)
{
  callId: string,
  roomId: string,
  callType: "VOICE" | "VIDEO",
  status: "ENDED",
  durationSec: number,
  endedBy: string,
  sequence: number,
  occurredAt: string,
}

// call:peer_state_changed — mid-call controls
{
  fromUserId: string,
  roomId: string,
  isMuted: boolean,
  isVideoOff: boolean,
  isSpeakerOn: boolean,
}
```

---

## LiveKit Integration

After answer, both participants join the same LiveKit room using the tokens from the REST endpoints.

### Join Room on Answer

```typescript
import { Room, RoomEvent, Track, ConnectionState } from "livekit-client";

let room: Room | null = null;

async function joinCallRoom(token: string, serviceUrl: string): Promise<Room> {
  room = new Room({
    adaptiveStream: true,
    dynacast: true,
  });

  // Listen for events
  room.on(RoomEvent.Connected, () => {
    console.log("Connected to LiveKit room");
  });

  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    // Attach remote track to UI
    if (track.kind === Track.Kind.Video) {
      // Render video track
    } else if (track.kind === Track.Kind.Audio) {
      // Play audio track
    }
  });

  room.on(RoomEvent.Disconnected, () => {
    console.log("Disconnected from LiveKit room");
  });

  // Connect and publish local tracks
  await room.connect(serviceUrl, token);

  // Enable camera and microphone
  await room.localParticipant.setCameraEnabled(true);
  await room.localParticipant.setMicrophoneEnabled(true);

  return room;
}

// Caller: join immediately (while ringing)
// The caller gets a token from POST /calls response
async function callerJoinCall(callResult: { token: string; serviceUrl: string }) {
  await joinCallRoom(callResult.token, callResult.serviceUrl);
}

// Receiver: join after answering
async function receiverJoinCall(answerResult: { token: string; serviceUrl: string }) {
  await joinCallRoom(answerResult.token, answerResult.serviceUrl);
}
```

### Leave Room

```typescript
async function leaveCall() {
  if (room) {
    await room.disconnect();
    room = null;
  }
}
```

### Mid-Call Controls

```typescript
// Toggle mute
async function toggleMute(isMuted: boolean) {
  if (room) {
    await room.localParticipant.setMicrophoneEnabled(!isMuted);
  }
  // Notify peer
  socket.emit("call:state_change", {
    targetUserId: peerUserId,
    roomId,
    isMuted: !isMuted,
    isVideoOff,
    isSpeakerOn,
  });
}

// Toggle camera
async function toggleCamera(isVideoOff: boolean) {
  if (room) {
    await room.localParticipant.setCameraEnabled(!isVideoOff);
  }
  socket.emit("call:state_change", {
    targetUserId: peerUserId,
    roomId,
    isMuted,
    isVideoOff: !isVideoOff,
    isSpeakerOn,
  });
}

// Request voice → video upgrade
async function requestVideoUpgrade(targetUserId: string, roomId: string) {
  socket.emit("call:switch_video_request", { targetUserId, roomId });
}

// Respond to video upgrade request
async function respondVideoUpgrade(targetUserId: string, roomId: string, accepted: boolean) {
  socket.emit("call:switch_video_respond", { targetUserId, roomId, accepted });
}
```

---

## Push Notifications

### Handle Foreground Notifications

```typescript
import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Listen for incoming notifications
Notifications.addNotificationReceivedListener((notification) => {
  const data = notification.request.content.data;

  if (data.type === "CALL_STATE_CHANGED") {
    // Call no longer ringing — dismiss any incoming-call UI for this callId
    dismissIncomingCall(data.callId);
    return;
  }

  if (data.type === "INCOMING_CALL") {
    // Show incoming call UI overlay
    showIncomingCallScreen({
      callId: data.callId,
      callType: data.callType,
      callerId: data.callerId,
      callerName: data.callerName,
      callerImageUrl: data.callerImageUrl,
      conversationId: data.conversationId,
      expiresAt: data.expiresAt,
    });
  }
});

// Handle notification tap (app was backgrounded/terminated)
Notifications.addNotificationResponseReceivedListener((response) => {
  const data = response.notification.request.content.data;

  if (data.type === "INCOMING_CALL") {
    // Navigate to call screen and fetch call state
    navigateToCall(data.callId);
  }
});
```

### Notification Payload Structure

All notification metadata lives **inside `data`**, never only in the visible title/body. The `callId` is always the ID returned by `POST /calls` and is used to fetch the authoritative state via `GET /calls/:callId`.

**`INCOMING_CALL`** — delivered to every enabled device registered to the **receiver** (never the caller):

```json
{
  "type": "INCOMING_CALL",
  "callId": "call-uuid",
  "callType": "VOICE",
  "callerId": "caller-user-id",
  "callerName": "Ama Mensah",
  "callerImageUrl": "https://example.com/public-photo.jpg",
  "conversationId": "conversation-uuid",
  "expiresAt": "2026-08-29T12:01:00.000Z"
}
```

**`CALL_STATE_CHANGED`** — pushed to **both participants** when a call becomes `DECLINED`, `CANCELLED`, `MISSED`, `ENDED`, or `FAILED`, so the app can dismiss the ringing overlay/notification and cancel any countdown:

```json
{
  "type": "CALL_STATE_CHANGED",
  "callId": "call-uuid",
  "callType": "VOICE",
  "status": "CANCELLED",
  "conversationId": "conversation-uuid",
  "sequence": 3,
  "occurredAt": "2026-08-29T12:01:30.000Z"
}
```

### Delivery channels

- **Android (installed APK):** for `INCOMING_CALL` the server sends a **visible high-priority FCM notification** — `data` + `notification` + `android.priority: "high"` + `android.notification { channelId: "calls", sound: "call_ringtone", tag: "incoming-call-<callId>" }` — so the ring displays even if the app is backgrounded/killed and JavaScript never wakes. `CALL_STATE_CHANGED` is **data-only** (high priority, no `notification` block) so only the app handler dismisses ringing state. Delivery TTL is bounded to `min(30000ms, remaining ring time)` and a delivery is skipped entirely once `expiresAt` has passed, so incoming-call alerts never outlive the ringing window.
- **iOS + Android-in-Expo-Go:** an Expo push message with `channelId: "calls"`, `priority: "high"`, and `sound: "call_ringtone.wav"`.
- **True iOS lock-screen calling:** the server delivers an **APNs VoIP push (PushKit)** directly to the device's registered `voipPushToken` over HTTP/2 — no third-party provider involved. The OS launches the app even when terminated; the app then reports the incoming call to CallKit. The push body carries the full `INCOMING_CALL` / `CALL_STATE_CHANGED` payload at the top level (see [Native Platform Integration](#native-platform-integration)). Requires the APNs key variables in `.env` (`APPLE_APNS_KEY_ID`, `APPLE_APNS_TEAM_ID`, `APPLE_BUNDLE_ID`, `APPLE_APNS_P8_KEY`).

The backend records a delivery row per (call, device, provider), processes Expo delivery receipts, retries transient failures with backoff, and removes tokens the provider flags as invalid (`DeviceNotRegistered` / APNs `BadDeviceToken` / `Unregistered`). A successful HTTP request to Expo only means the message was accepted — the receipt determines whether it reached APNs/FCM. APNs VoIP pushes are synchronous (HTTP status 200 = delivered).

---

## Incoming Call Screen

The full flow for receiving a call:

```typescript
// 1. Socket receives call.incoming OR push notification arrives
// 2. Show incoming call UI with caller info + Answer/Decline buttons
// 3. Start a countdown timer to expiresAt (auto-dismiss when expired)
// 4. On Answer: call POST /calls/:callId/answer, then join LiveKit room
// 5. On Decline: call POST /calls/:callId/decline
// 6. On timeout: dismiss UI (server will emit call.missed / send CALL_STATE_CHANGED)
// 7. Dismiss the incoming screen whenever a CALL_STATE_CHANGED push or
//    call.cancelled / call.declined / call.missed / call.ended socket event arrives

interface IncomingCallState {
  callId: string;
  callType: "VOICE" | "VIDEO";
  caller: {
    id: string;
    fullName: string;
    profileImageUrl: string | null;
  };
  expiresAt: Date;
}

function IncomingCallScreen({ call, onAnswer, onDecline }: {
  call: IncomingCallState;
  onAnswer: () => void;
  onDecline: () => void;
}) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      const left = call.expiresAt.getTime() - Date.now();
      if (left <= 0) {
        clearInterval(timer);
        // Auto-dismiss — server will emit call.missed
        return;
      }
      setRemaining(Math.ceil(left / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [call.expiresAt]);

  return (
    <View>
      <Image source={{ uri: call.caller.profileImageUrl }} />
      <Text>{call.caller.fullName}</Text>
      <Text>{call.callType === "VIDEO" ? "Video Call" : "Voice Call"}</Text>
      <Text>Incoming call... ({remaining}s)</Text>

      <Button title="Decline" onPress={onDecline} color="red" />
      <Button title="Answer" onPress={onAnswer} color="green" />
    </View>
  );
}
```

---

## Active Call Screen

```typescript
function ActiveCallScreen({ callId, roomId, token, serviceUrl }: {
  callId: string;
  roomId: string;
  token: string;
  serviceUrl: string;
}) {
  const [room, setRoom] = useState<Room | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    // Join LiveKit room
    joinCallRoom(token, serviceUrl).then(setRoom);

    // Duration timer
    const timer = setInterval(() => setDuration(d => d + 1), 1000);

    return () => {
      clearInterval(timer);
      leaveCall();
    };
  }, []);

  const handleEnd = async () => {
    await endCall(callId);
    leaveCall();
    navigation.goBack();
  };

  return (
    <View>
      {/* Remote video */}
      <RemoteVideoView room={room} />

      {/* Local video (picture-in-picture) */}
      <LocalVideoView room={room} />

      {/* Controls */}
      <View>
        <Button
          title={isMuted ? "Unmute" : "Mute"}
          onPress={() => toggleMute(isMuted)}
        />
        <Button
          title={isVideoOff ? "Show Camera" : "Hide Camera"}
          onPress={() => toggleCamera(isVideoOff)}
        />
        <Button
          title="End Call"
          onPress={handleEnd}
          color="red"
        />
      </View>

      <Text>{formatDuration(duration)}</Text>
    </View>
  );
}
```

---

## Call History

```typescript
interface CallHistoryEntry {
  id: string;
  direction: "INCOMING" | "OUTGOING";
  callType: "VOICE" | "VIDEO";
  status: string;
  otherUser: {
    id: string;
    fullName: string;
    profileImageUrl: string | null;
  };
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSec: number;
}

async function getCallHistory(cursor?: string, limit = 20) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);

  const response = await fetch(`${API_URL}/calls/history?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return response.json();
  // Returns { calls: CallHistoryEntry[], nextCursor: string | null }
}
```

---

## Native Platform Integration

### iOS — PushKit + CallKit (for lock-screen calling)

This requires a **native module** (not Expo Go). Use `expo-module` or a config plugin.

**Flow:**
1. Register for VoIP pushes via PushKit
2. Report incoming VoIP push to CallKit immediately
3. CallKit shows native incoming call UI on lock screen
4. On "Accept" → answer via REST + join LiveKit
5. On "Decline" → decline via REST
6. Report end call to CallKit on hang-up

**Key: iOS requires VoIP pushes to be reported to CallKit promptly. Do NOT use VoIP pushes for anything other than real-time calling.**

```typescript
// Pseudocode — requires native module
import VoipPushNotification from "react-native-voip-push-notification";
import { CXProvider, CXCallUpdate, CXAction } from "react-native-callkit";

// On app start
VoipPushNotification.register();

VoipPushNotification.addEventListener("register", (token) => {
  // Send voipPushToken to POST /devices/register
});

VoipPushNotification.addEventListener("notification", (notification) => {
  const { callId, callerName, callType, expiresAt } = notification.payload;

  // Report to CallKit immediately
  const callUpdate = new CXCallUpdate();
  callUpdate.remoteHandle = new CXHandle(callerName);
  callUpdate.hasVideo = callType === "VIDEO";

  cxProvider.reportNewIncomingCall(callId, callUpdate, (error) => {
    if (!error) {
      // Show incoming call UI, wait for user action
    }
  });
});
```

### Android — FCM + CallStyle + Full-Screen Intent

Requires a **native build** (not Expo Go). Use `expo-module` or expo notifications config plugin.

**Flow:**
1. Receive the FCM high-priority notification (visible `INCOMING_CALL` alert + `data`; `CALL_STATE_CHANGED` arrives data-only)
2. Create high-importance notification channel for calls
3. Use `CallStyle` notification (Android 12+)
4. Set full-screen intent for lock-screen behavior
5. On "Answer" → answer via REST + join LiveKit
6. On "Decline" → decline via REST

```typescript
// Pseudocode — handled by expo-notifications + native module
import * as Notifications from "expo-notifications";

// Configure the calls notification channel (Android).
// The server targets channelId "calls" for incoming call pushes.
async function setupCallChannel() {
  await Notifications.setNotificationChannelAsync("calls", {
    name: "Calls",
    importance: Notifications.AndroidImportance.MAX,
    sound: "call_ringtone.wav",
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#FF0000",
  });
}

// When INCOMING_CALL push arrives, show full-screen intent
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    if (notification.request.content.data?.type === "INCOMING_CALL") {
      // Android: full-screen intent shows even on lock screen
      return {
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      };
    }
    if (notification.request.content.data?.type === "CALL_STATE_CHANGED") {
      // Nothing visual to show — used only to dismiss the incoming screen
      return { shouldShowAlert: false, shouldPlaySound: false, shouldSetBadge: false };
    }
    return { shouldShowAlert: false, shouldPlaySound: false, shouldSetBadge: false };
  },
});
```

> **Foreground vs background handling:** the server already builds the **visible
> `INCOMING_CALL` FCM notification** (with `notification` + `calls` channel +
> `call_ringtone` + full-screen intent via channel importance) so the ring shows
> even when the app is backgrounded/killed. On Android, `handleNotification`
> (foreground) can drive the in-app call screen from `data` and call
> `Notifications.setFullScreenIntent`-style behavior via the calls channel.
> `CALL_STATE_CHANGED` is **data-only**, so a killed app will not wake on state
> changes — dismissals rely on the socket while the app is running; the OS
> removes the incoming-call notification automatically once the call window
> (TTL) expires.

---

## Error Handling

### Error Codes

The server returns structured errors:

```typescript
class CallError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
```

| Code | HTTP | Meaning | Action |
|------|------|---------|--------|
| `CALL_NOT_FOUND` | 404 | Call doesn't exist or user not a participant | Dismiss call UI |
| `NOT_CALL_PARTICIPANT` | 403 | User is not caller or receiver | Dismiss call UI |
| `NOT_MATCHED` | 403 | Users are not matched | Show error, cannot call |
| `USER_BLOCKED` | 403 | Users blocked each other | Show error, cannot call |
| `RECIPIENT_BUSY` | 409 | Recipient in another call | Show "User is busy" |
| `CALL_ALREADY_ACTIVE` | 409 | Caller already in a call | Dismiss, show active call |
| `CALL_ALREADY_ANSWERED` | 409 | Call answered by another device | Close incoming UI |
| `CALL_ALREADY_ENDED` | 409 | Call already ended | Dismiss call UI |
| `CALL_EXPIRED` | 409 | Call expired (40s timeout) | Dismiss call UI |
| `INVALID_CALL_STATE` | 409 | Wrong state for this action | Re-fetch call state |
| `LIVEKIT_TOKEN_FAILED` | 500 | Token generation failed | Retry or show error |
| `RATE_LIMITED` | 429 | Too many calls | Show "try again later" |

### Key Rules

- **Always fetch `GET /calls/:callId`** before answering to get current state
- **Idempotent operations:** calling `POST /calls/:callId/end` on an already-ended call returns the ended call (no error)
- **Sequence numbers:** socket events include `sequence` — ignore events with lower sequence than the latest seen
- **Expiry timer:** the call auto-expires after ~40 seconds. Show a countdown and auto-dismiss when it reaches 0

---

## Testing Checklist

### Basic Flow
- [ ] Initiate voice call → recipient sees incoming call
- [ ] Initiate video call → recipient sees incoming call with video type
- [ ] Answer → both join LiveKit room, audio/video works
- [ ] Decline → caller sees "declined" status
- [ ] Cancel → recipient's incoming UI closes
- [ ] End (either side) → call terminates, duration shown
- [ ] No answer → becomes MISSED after timeout

### Background/Terminated
- [ ] Recipient app backgrounded → push notification received
- [ ] Recipient app terminated → push notification received, tap opens app
- [ ] Recipient device locked → native call UI shown (iOS/Android)

### Edge Cases
- [ ] Duplicate initiate (same idempotency key) → returns same call
- [ ] Recipient already in another call → 409 RECIPIENT_BUSY
- [ ] Caller already in another call → 409 CALL_ALREADY_ACTIVE
- [ ] Answer from multiple devices → first wins, others get ANSWERED_ELSEWHERE
- [ ] Cancel races with answer → one succeeds, other gets 409
- [ ] Expired token → 409 CALL_EXPIRED
- [ ] Blocked users → 403 USER_BLOCKED
- [ ] Unmatched users → 403 NOT_MATCHED

### Multi-Device
- [ ] Answer on device A → device B shows ANSWERED_ELSEWHERE
- [ ] End on device A → device B call terminates
- [ ] Decline on device A → both devices stop ringing

### Call History
- [ ] After call completes, history shows correct direction/type/status/duration
- [ ] Pagination works with cursor

### Push Notifications
- [ ] FCM delivery works on Android (installed APK)
- [ ] FCM visible incoming-call notification rings on a backgrounded/terminated app (installed APK) and the TTL-bounded alert disappears after the ring window
- [ ] Expo push works on iOS
- [ ] Incoming-call push goes to every registered **receiver** device, never the caller's
- [ ] `CALL_STATE_CHANGED` push arrives on both devices for DECLINED / CANCELLED / MISSED / ENDED / FAILED and dismisses the ringing UI
- [ ] Invalid/stale push token auto-disables the device (Expo `DeviceNotRegistered`)
- [ ] Registering on every launch refreshes `lastSeenAt`; reinstallation replaces the old device record

---

## Environment Variables (for reference)

The server expects these env vars. Your app doesn't need to know them, but they affect behavior:

```bash
# LiveKit (media transport)
LIVEKIT_URL=wss://your-instance.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...

# Firebase (FCM for Android: visible call alerts + data)
FIREBASE_PROJECT_ID=...
FIREBASE_PRIVATE_KEY=...
FIREBASE_CLIENT_EMAIL=...

# API
API_URL=https://your-api.example.com
```

> The server needs no Expo secret — `expo-server-sdk` targets each device's Expo
> push token directly. Expo itself needs your EAS `projectId` on the client
> (`getExpoPushTokenAsync({ projectId })`), exported from `app.json` under
> `extra.eas.projectId`. FCM tokens are obtained client-side from
> `expo-notifications`/native FCM; only the Firebase service account
> (`FIREBASE_*`) is used server-side.

---

## Summary of Server Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/calls` | Initiate call |
| `GET` | `/calls/history` | Call history (cursor pagination) |
| `GET` | `/calls/:callId` | Get call state |
| `POST` | `/calls/:callId/answer` | Answer call |
| `POST` | `/calls/:callId/decline` | Decline call |
| `POST` | `/calls/:callId/cancel` | Cancel outgoing call |
| `POST` | `/calls/:callId/end` | End active call |
| `POST` | `/calls/:callId/token` | Get LiveKit token |
| `POST` | `/devices/register` | Register device for push |
| `DELETE` | `/devices/:deviceId` | Unregister device |

All endpoints require `Authorization: Bearer <token>` header.
