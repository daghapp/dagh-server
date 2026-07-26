# Backend Chat & WebRTC Call Feature Documentation

## Overview

This document describes the backend architecture, database schema, REST API endpoints, and Socket.IO real-time signaling pipeline for **Chat (Text & Voice Notes)** and **Audio/Video Calling (WebRTC)** in the **DAGH (Diaspora Affairs Ghana)** server.

---

## 1. System Architecture & Component Diagram

```
                                  ┌───────────────────────────┐
                                  │    Mobile / Web Frontend  │
                                  └─────────────┬─────────────┘
                                                │
                       ┌────────────────────────┼────────────────────────┐
                       │ REST API (JWT Auth)    │ Socket.IO (Real-time)  │ Cloudinary Storage
                       ▼                        ▼                        ▼
              ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
              │ Express Server   │    │ Socket Server    │    │ Voice Note Files │
              │  - Conversations │    │  - Chat Events   │    │  (Audio Upload)  │
              │  - Matches       │    │  - Call Signal   │    └──────────────────┘
              │  - Block/Report  │    │  - WebRTC RTC    │
              │  - Call Tokens   │    │  - Presence      │
              └────────┬─────────┘    └─────────┬────────┘
                       │                        │
                       ▼                        ▼
              ┌──────────────────────────────────────────┐
              │  PostgreSQL Database (Prisma ORM)        │
              │  - User & UserProfile                    │
              │  - Conversation & Message                │
              │  - UserMatch                             │
              │  - UserBlock & UserReport                │
              │  - CallLog                               │
              └──────────────────────────────────────────┘
```

---

## 2. Database Schema Changes (`prisma/schema.prisma`)

### Enums
- **`MessageType`**: `TEXT`, `VOICE_NOTE`, `IMAGE`, `VIDEO`, `CALL_LOG`
- **`CallType`**: `VOICE`, `VIDEO`
- **`CallStatus`**: `MISSED`, `COMPLETED`, `DECLINED`, `BUSY`, `CANCELLED`
- **`MatchStatus`**: `PENDING`, `MATCHED`, `UNMATCHED`

### Models Added / Updated
```prisma
model Message {
  id             String       @id @default(uuid())
  conversationId String?
  senderId       String
  receiverId     String
  type           MessageType  @default(TEXT)
  content        String?
  mediaUrl       String?
  mediaDuration  Int?         // Voice note duration in seconds
  isRead         Boolean      @default(false)
  readAt         DateTime?
  createdAt      DateTime     @default(now())

  conversation   Conversation? @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  sender         User          @relation("SentMessages", fields: [senderId], references: [id], onDelete: Cascade)
  receiver       User          @relation("ReceivedMessages", fields: [receiverId], references: [id], onDelete: Cascade)
}

model Conversation {
  id            String    @id @default(uuid())
  participants  String[]
  lastMessage   String?
  lastMessageAt DateTime?
  messages      Message[]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @default(now()) @updatedAt
}

model UserMatch {
  id        String      @id @default(uuid())
  userId    String
  matchedId String
  status    MatchStatus @default(MATCHED)
  createdAt DateTime    @default(now())

  user    User @relation("UserMatches", fields: [userId], references: [id], onDelete: Cascade)
  matched User @relation("TargetMatches", fields: [matchedId], references: [id], onDelete: Cascade)
}

model UserBlock {
  id        String   @id @default(uuid())
  blockerId String
  blockedId String
  createdAt DateTime @default(now())

  blocker User @relation("Blocker", fields: [blockerId], references: [id], onDelete: Cascade)
  blocked User @relation("Blocked", fields: [blockedId], references: [id], onDelete: Cascade)
}

model UserReport {
  id         String   @id @default(uuid())
  reporterId String
  targetId   String
  reason     String
  details    String?
  createdAt  DateTime @default(now())

  reporter User @relation("Reporter", fields: [reporterId], references: [id], onDelete: Cascade)
  target   User @relation("ReportedUser", fields: [targetId], references: [id], onDelete: Cascade)
}

model CallLog {
  id          String     @id @default(uuid())
  callerId    String
  receiverId  String
  callType    CallType
  status      CallStatus @default(MISSED)
  roomId      String
  startedAt   DateTime   @default(now())
  endedAt     DateTime?
  durationSec Int?       @default(0)

  caller   User @relation("OutgoingCalls", fields: [callerId], references: [id], onDelete: Cascade)
  receiver User @relation("IncomingCalls", fields: [receiverId], references: [id], onDelete: Cascade)
}
```

---

## 3. REST API Endpoint Specifications

All endpoints require JWT Bearer Authentication (`Authorization: Bearer <token>`).

### Messages & Matches (`/messages`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/messages` | Send a text/media message (`receiverId`, `content`, `type`, `mediaUrl`, `mediaDuration`). |
| `POST` | `/messages/voice-note` | Upload voice note audio file (`multipart/form-data`: `audio` file, `receiverId`, `mediaDuration`). |
| `GET` | `/messages/matches` | Get active user matches for the "New Matches" carousel. |
| `GET` | `/messages/conversations` | Get user conversations with unread message counts, preview text, and partner profile details. |
| `GET` | `/messages/conversations/:conversationId` | Fetch messages in a conversation and mark incoming messages as read. |
| `PATCH` | `/messages/:messageId/read` | Mark a specific message as read. |
| `POST` | `/messages/block` | Block a user (`blockedId`). Prevents calls & messages. |
| `DELETE`| `/messages/block/:blockedId` | Unblock a user. |
| `POST` | `/messages/report` | Report a user for safety (`targetId`, `reason`, `details`). |

### Calls (`/calls`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/calls/history` | Get incoming/outgoing call history logs. |
| `POST` | `/calls/token` | Generate WebRTC RTC session token (`roomId`, `callType`). |

---

## 4. Socket.IO Real-Time & WebRTC Call Signaling

Socket connection requires JWT authentication token in handshake auth (`auth: { token }`).

### Chat Socket Events
- **`new_message`**: Emitted to receiver socket room (`user:<receiverId>`) when a message or voice note is sent.
- **`message_sent`**: Emitted to sender socket room confirming delivery.
- **`typing`**: Client sends `{ receiverId, isTyping: true|false }`. Server emits `user_typing` to target user.
- **`mark_read`**: Client sends `{ messageId }`. Server updates DB and emits `message_read` to sender.

### Call Socket Events
- **`call:initiate`**:
  - Client emits `{ receiverId, callType: "VOICE" | "VIDEO" }`.
  - Server verifies block status, creates `CallLog`, emits `call:incoming` to receiver's socket room with caller profile (fullName, profileImage), and `call:initiated` to caller.
- **`call:accept`**:
  - Receiver emits `{ callLogId, roomId }`.
  - Server joins room, marks start time, emits `call:accepted` to caller and `call:started` to room.
- **`call:decline`**:
  - Receiver emits `{ callLogId, roomId }`.
  - Server sets `CallLog` status to `DECLINED`, emits `call:declined` to caller.
- **`call:end`**:
  - Client emits `{ callLogId, roomId }`.
  - Server calculates duration, updates `CallLog` status to `COMPLETED` or `CANCELLED`, emits `call:ended`, and creates a `CALL_LOG` message bubble in chat ("📞 Call ended • 2m 15s").
- **`call:signal`**:
  - Client emits `{ targetUserId, signalData, roomId }` (SDP Offer, SDP Answer, or ICE Candidates).
  - Server relays `call:signal_received` to `targetUserId`.
- **`call:state_change`**:
  - Client emits `{ targetUserId, roomId, isMuted, isVideoOff, isSpeakerOn }`.
  - Server relays `call:peer_state_changed` to target user.

### Presence Socket Events
- **`presence:status`**: Server broadcasts `{ userId, isOnline: true|false, lastActiveAt }` on user connect/disconnect.
- **`presence:check`**: Client emits `{ targetUserId }`. Server responds with `presence:info` (`isOnline`).

---

## 5. File Structure Summary

```
src/
├── helpers/
│   └── safety.ts                 # isUserBlocked helper (shared by controller + sockets)
├── middleware/
│   └── audioUpload.ts            # Multer + Cloudinary audio storage + error handler
├── modules/
│   └── messages/
│       ├── messages.controller.ts # Chat, voice note, match, block & report handlers
│       └── calls.controller.ts    # Call logs and WebRTC token generator
├── routes/
│   ├── message.routes.ts          # REST endpoints for /messages
│   └── calls.routes.ts            # REST endpoints for /calls
├── sockets/
│   ├── socketHandlers.ts          # Main Socket.IO connection, presence, and typing handlers
│   └── callSocket.ts              # WebRTC call signaling socket handlers
└── validator/
    └── messageValidation.ts       # Zod validation schemas (with conditional refinement)
prisma/
└── schema.prisma                  # Prisma models & enums
```

---

## 6. How to Test & Verify

1. **Build the TypeScript application:**
   ```bash
   npm run build
   ```
2. **Run Prisma Migrations:**
   ```bash
   npx prisma migrate dev --name add_chat_and_call_features
   ```
3. **Start Development Server:**
   ```bash
   npm run dev
   ```
4. **Access Interactive Swagger Docs:**
   Open `http://localhost:5000/api-docs` to view and test all `/messages` and `/calls` REST endpoints.

---

## 7. Known Limitations & TODOs

- **In-memory call state**: `activeCalls` Map in `callSocket.ts` is lost on server restart. Calls stuck as `MISSED`. For production, persist to Redis or use a dedicated call state store.
- **RTC token is a placeholder**: `generateRtcToken` returns an HMAC token, not a real WebRTC provider token (LiveKit, Daily.co, Twilio). Integrate with a provider for production.
- **UserMatch has no creation endpoint**: `getNewMatches` queries `UserMatch` but nothing creates records. Add a matching/swipe feature or remove the endpoint.
- **Single-peer calls only**: Current signaling assumes 1:1 calls. Group calls require additional room management.
