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

Register the device for push notifications on every app launch (after login).

### Register Device

```typescript
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";

interface RegisterDeviceParams {
  platform: "IOS" | "ANDROID";
  expoPushToken?: string;
  fcmToken?: string;
}

async function registerDevice({ platform, expoPushToken, fcmToken }: RegisterDeviceParams) {
  const deviceId = await getOrCreateDeviceId(); // persist in AsyncStorage

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
    }),
  });

  return response.json();
}
```

### Get Push Token

```typescript
async function getPushToken(): Promise<{ expoToken?: string; fcmToken?: string }> {
  if (Platform.OS === "android") {
    // FCM for Android (native builds only)
    const token = await Notifications.getDevicePushTokenAsync();
    return { fcmToken: token.data };
  }

  // Expo push token for iOS (or FCM if using native build)
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== "granted") return {};

  const expoToken = await Notifications.getExpoPushTokenAsync({
    projectId: Constants.expoConfig?.extra?.eas?.projectId,
  });

  return { expoToken: expoToken.data };
}
```

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

The server sends these payloads. The app should NOT include any secrets or tokens.

```json
{
  "type": "INCOMING_CALL",
  "callId": "call-uuid",
  "callType": "VIDEO",
  "callerId": "caller-id",
  "callerName": "Ama Mensah",
  "callerImageUrl": "https://public-dating-photo",
  "conversationId": "conversation-id",
  "expiresAt": "2026-08-24T15:01:00.000Z"
}
```

---

## Incoming Call Screen

The full flow for receiving a call:

```typescript
// 1. Socket receives call.incoming OR push notification arrives
// 2. Show incoming call UI with caller info + Answer/Decline buttons
// 3. Start a countdown timer to expiresAt (auto-dismiss when expired)
// 4. On Answer: call POST /calls/:callId/answer, then join LiveKit room
// 5. On Decline: call POST /calls/:callId/decline
// 6. On timeout: dismiss UI (server will emit call.missed)

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
1. Receive FCM high-priority data message
2. Create high-importance notification channel for calls
3. Use `CallStyle` notification (Android 12+)
4. Set full-screen intent for lock-screen behavior
5. On "Answer" → answer via REST + join LiveKit
6. On "Decline" → decline via REST

```typescript
// Pseudocode — handled by expo-notifications + native module
import * as Notifications from "expo-notifications";

// Configure notification channel for calls (Android)
async function setupCallChannel() {
  await Notifications.setNotificationChannelAsync("incoming-calls", {
    name: "Incoming Calls",
    importance: Notifications.AndroidImportance.MAX,
    sound: "ringtone.wav",
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
    return { shouldShowAlert: false, shouldPlaySound: false, shouldSetBadge: false };
  },
});
```

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
- [ ] FCM delivery works on Android
- [ ] Expo push works on iOS
- [ ] Invalid push token auto-disables device
- [ ] Missed call push sent to caller

---

## Environment Variables (for reference)

The server expects these env vars. Your app doesn't need to know them, but they affect behavior:

```bash
# LiveKit (media transport)
LIVEKIT_URL=wss://your-instance.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...

# Firebase (FCM for Android)
FIREBASE_PROJECT_ID=...
FIREBASE_PRIVATE_KEY=...
FIREBASE_CLIENT_EMAIL=...

# API
API_URL=https://your-api.example.com
```

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
