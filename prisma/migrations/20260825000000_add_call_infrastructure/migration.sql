-- Drop legacy call_logs table FIRST (it depends on the old CallStatus enum)
DROP TABLE IF EXISTS "call_logs";

-- Now safe to drop and recreate CallStatus with spec-compliant values
DROP TYPE "CallStatus";
CREATE TYPE "CallStatus" AS ENUM ('INITIATING', 'RINGING', 'ANSWERED', 'DECLINED', 'CANCELLED', 'MISSED', 'ENDED', 'FAILED');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('IOS', 'ANDROID');

-- CreateTable: calls
CREATE TABLE "calls" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "callerId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "conversationId" TEXT,
    "callType" "CallType" NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'INITIATING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ringingAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedBy" TEXT,
    "failureReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "durationSec" INTEGER,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable: call_audit_logs
CREATE TABLE "call_audit_logs" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "priorState" "CallStatus" NOT NULL,
    "newState" "CallStatus" NOT NULL,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: user_devices
CREATE TABLE "user_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "expoPushToken" TEXT,
    "fcmToken" TEXT,
    "apnsToken" TEXT,
    "voipPushToken" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: calls
CREATE UNIQUE INDEX "calls_roomId_key" ON "calls"("roomId");
CREATE INDEX "calls_receiverId_status_idx" ON "calls"("receiverId", "status");
CREATE INDEX "calls_callerId_status_idx" ON "calls"("callerId", "status");
CREATE INDEX "calls_conversationId_createdAt_idx" ON "calls"("conversationId", "createdAt");
CREATE INDEX "calls_status_expiresAt_idx" ON "calls"("status", "expiresAt");

-- CreateIndex: call_audit_logs
CREATE INDEX "call_audit_logs_callId_idx" ON "call_audit_logs"("callId");

-- CreateIndex: user_devices
CREATE UNIQUE INDEX "user_devices_userId_deviceId_key" ON "user_devices"("userId", "deviceId");
CREATE INDEX "user_devices_userId_idx" ON "user_devices"("userId");
CREATE INDEX "user_devices_userId_enabled_idx" ON "user_devices"("userId", "enabled");

-- AddForeignKey: calls -> users (caller)
ALTER TABLE "calls" ADD CONSTRAINT "calls_callerId_fkey"
    FOREIGN KEY ("callerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: calls -> users (receiver)
ALTER TABLE "calls" ADD CONSTRAINT "calls_receiverId_fkey"
    FOREIGN KEY ("receiverId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: calls -> conversations
ALTER TABLE "calls" ADD CONSTRAINT "calls_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: call_audit_logs -> calls
ALTER TABLE "call_audit_logs" ADD CONSTRAINT "call_audit_logs_callId_fkey"
    FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: user_devices -> users
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
