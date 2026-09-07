# Frontend: Making Calls Work When the App Is Terminated

**Audience:** Frontend / mobile developer
**Scope:** What you must implement so incoming voice/video calls ring even when the app is **open**, **backgrounded**, or **fully terminated**.

This is the addendum to `docs/call-integration-guide.md` (which covers the baseline call flow — device registration, sockets, call REST API, in-app call screen). Use that guide for the core flow; use this one for the native/terminated-app pieces.

---

## 1. The deal up front

The backend now delivers call pushes over **three channels**, and which one reaches a device depends on what it registered:

| Platform                                       | Channel                                                                             | Terminated app behavior                                                                                                                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **iOS** with a `voipPushToken`                 | APNs **PushKit VoIP** push (read-only, delivered directly by the server)            | iOS **launches** the app to deliver it — this is the only channel that reliably rings a killed app                                                                                                              |
| **Android** with an `fcmToken`                 | FCM — **data-only** high-priority push for `INCOMING_CALL` and `CALL_STATE_CHANGED` | Your native `FirebaseMessagingService` / foreground service presents the call (full-screen intent / `CallStyle`); the server never posts a visible notification for calls so Android can't bypass your receiver |
| **iOS / Android** with only an `expoPushToken` | Expo push (visible banner)                                                          | Banner only; **no** call UI when terminated                                                                                                                                                                     |

**Your job:** make sure iOS devices register a `voipPushToken` and handle the PushKit push with CallKit. On Android the server sends a **data-only** incoming-call push (high priority, TTL-bounded to the ring window) so your own native call receiver decides how to present the call; your foreground service + full-screen intent add the native ringing UX.

---

## 2. Register the tokens the server needs

`POST /devices/register` (auth: bearer token):

```json
{
  "deviceId": "unique-per-installation-id",
  "platform": "IOS",
  "expoPushToken": "ExponentPushToken[...]",
  "voipPushToken": "HEX-APNS-VOIP-TOKEN" // iOS only — you MUST send this now
}
```

- **iOS:** the PushKit token is a 64-char hex string received from the `register` event. Send it as `voipPushToken`. Also keep sending `expoPushToken` (it remains the fallback for messages and for devices without a VoIP token).
- **Android:** send `fcmToken` (from Firebase) so calls go over FCM instead of Expo.
- Keep sending the same `deviceId` across launches; the server upserts.
- If an iOS device registered a `voipPushToken`, the server will deliver `INCOMING_CALL` pushes over VoIP and **won't** also send the Expo banner (avoids duplicates). `CALL_STATE_CHANGED` cleanup is delivered as an ordinary push, never over VoIP.

> On **logout**, call `DELETE /devices/:deviceId` (or use `PATCH` to disable) so stale tokens are not targeted.

---

## 3. Payloads you will receive

The call payload keys are the same across channels; on **iOS VoIP push** they arrive at the **top level of the push body** (in `notification.payload`).

### `INCOMING_CALL` (arrives when someone calls you)

```json
{
  "type": "INCOMING_CALL",
  "callId": "uuid",
  "callType": "VOICE" | "VIDEO",
  "callerId": "uuid",
  "callerName": "John Doe",
  "callerImageUrl": "https://…",        // omitted if caller has no photo
  "conversationId": "uuid",
  "expiresAt": "2026-09-05T12:01:00.000Z",
  "sequence": "1"
}
```

### `CALL_STATE_CHANGED` (the call you were ringing was declined/cancelled/missed/ended)

```json
{
  "type": "CALL_STATE_CHANGED",
  "callId": "uuid",
  "callType": "VOICE",
  "status": "DECLINED" | "CANCELLED" | "MISSED" | "ENDED" | "FAILED",
  "conversationId": "uuid",
  "sequence": "3",
  "occurredAt": "2026-09-05T12:02:30.000Z"
}
```

**Use `callId` + `sequence`** to dedupe: if you already handled a newer `sequence` for that `callId`, ignore the older push. A `CALL_STATE_CHANGED` means dismiss the ringing screen / end the CallKit call — there is nothing to accept.

---

## 4. iOS — PushKit + CallKit (required)

Requires a **native module** (Expo Go cannot do this). Libraries: `react-native-voip-push-notification` + `react-native-callkit`, or an eas/config plugin wrapping PushKit + `CXProvider`.

Flow:

1. **On launch**, register for VoIP pushes:
   ```js
   VoipPushNotification.register();
   ```
2. **On the `register` event**, save the token and send it to `POST /devices/register` as `voipPushToken` (see §2).
3. **On an incoming VoIP push**, the OS relaunches (if needed) your app and fires `notification`. **Immediately** report the call to CallKit:
   ```js
   VoipPushNotification.addEventListener("notification", (notification) => {
     const p = notification.payload; // { type, callId, callerName, callType, expiresAt, ... }

     const update = new CXCallUpdate();
     update.remoteHandle = new CXHandle({ type: "generic", value: p.callerName });
     update.localizedCallerName = p.callerName;
     update.hasVideo = p.callType === "VIDEO";

     cxProvider.reportNewIncomingCall(p.callId, update, (error) => {
       if (!error) {
         // Show your in-app incoming-call screen for the ANSWering path,
         // and start the ringback (sound, vibration) from your call-ui channel.
       }
     });
   });
   ```
   Rules that matter:
   - Report to CallKit **within ~5 seconds** of the push, or iOS may kill the app for misusing VoIP pushes.
   - Do **not** use VoIP pushes for anything other than real-time calling (rankings, etc.) or Apple will revoke VoIP entitlements.
   - Start ringtone playback **inside the PushKit handler** (background), not after you fire a JS timeout.
4. **Answer** → `POST /calls/:callId/answer`, then join the LiveKit room, then `reportOutgoingCall`/update CallKit state to connected.
5. **Decline / expiry** → `POST /calls/:callId/decline` (or let the server mark it missed).
6. **On `CALL_STATE_CHANGED` push** → if the `callId` matches a call you reported to CallKit, end it: `cxProvider.reportCall(withUUID:callId, endedAt: date, reason: .remoteEnded)` and dismiss any ringing UI. State-change cleanup is delivered over ordinary APNs/Expo, not a new VoIP push.
7. Always end the reported CallKit call when the call truly ends (both sides) so the lock screen doesn't get stuck.

> **Apple user force-quits the app (swipe-up in app switcher):** iOS will not relaunch the app for VoIP pushes until the user opens it manually. Your push will be accepted server-side but the call won't show. This is an OS policy you cannot work around — but note the **socket path covers the fore/background** case and the **CallKit missed-call UI** can be produced later from call history via `GET /calls/history`.

---

## 5. Android — data-only incoming-call FCM + native call receiver (required)

Requires a **native build** (Expo Go cannot do this). The server sends `INCOMING_CALL` as a **data-only** high-priority FCM message — no `notification` block, only the call `data` — so the app's own `FirebaseMessagingService` / headless handler controls call presentation. The server does NOT post a visible notification for native calls: a visible notification would be handled by Android itself and could bypass the custom call receiver. The message TTL is set to the remaining ring time (never exceeding the ring window) and the delivery is skipped entirely once the call has expired, so the ring can never outlive the ringing period. `CALL_STATE_CHANGED` also stays data-only so only your handler dismisses ringing state.

With `expo-notifications`:

- Register for push: `Notifications.getDevicePushTokenAsync()` (or FCM directly) → send as `fcmToken`.
- Create the **calls** channel with max importance, sound, and full-screen-intent behavior. When foregrounded, present the in-app call screen. When backgrounded/terminated, a native `FirebaseMessagingService.onBackgroundMessage` receives the data and must start a foreground service + present the full-screen intent / `CallStyle` notification (Android 12+) to the incoming-call activity:
  ```js
  await Notifications.setNotificationChannelAsync("calls", {
    name: "Calls",
    importance: Notifications.AndroidImportance.MAX,
    sound: "call_ringtone.wav",
    vibrationPattern: [0, 250, 250, 250],
  });
  ```
- Install a **headless/background handler** to react while killed:
  ```js
  Notifications.handleBackgroundNotificationAsync(async ({ notification }) => {
    const data = notification.request.content.data;
    if (data?.type === "INCOMING_CALL") {
      // START A FOREGROUND SERVICE + present the full-screen intent so the
      // call screen shows over the lock screen, or the OS may collapse it.
    }
    if (data?.type === "CALL_STATE_CHANGED") {
      // Dismiss the ringing notification / cancel ringing
    }
  });
  ```
- For the most robust killed-state ring, prefer a native `FirebaseMessagingService.onBackgroundMessage` that starts a persistent foreground service and shows a high-importance `CallStyle` notification (Android 12+) with a **full-screen intent** to the incoming-call activity.

> **Android OEM "battery optimization"** (Xiaomi, Samsung, etc.) can delay or block background wake. Educate users, or document that these devices need the app whitelisted. This is platform behavior, not a server bug.

---

## 6. When the app is OPEN (no change)

Connected sockets deliver `call.incoming` immediately; that path is untouched and always wins when the app is in the foreground.

## 7. Acceptance checklist

- [ ] iOS device registers `voipPushToken`; server responds with call via VoIP push (watch server logs / `call_push_deliveries` rows with `provider = VOIP`).
- [ ] Kill the iOS app (don't force-quit) → call a tester → lock screen shows CallKit incoming call with caller name + ringtone.
- [ ] Answer from the lock screen → joins room, audio/video works; decline/expiry dismisses the screen everywhere.
- [ ] Kill the Android app → call → lock screen shows full-screen call notification.
- [ ] Close one device after the call is answered on another; the first device's ringing screen dismisses (CALL_STATE_CHANGED — ordinary push on iOS, data-only FCM on Android).
- [ ] Message pushes still work and are **not** delivered over the VoIP channel.
