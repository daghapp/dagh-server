-- CreateEnum
CREATE TYPE "PushProvider" AS ENUM ('FCM', 'EXPO');

-- CreateEnum
CREATE TYPE "PushDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED');

-- CreateTable
CREATE TABLE "call_push_deliveries" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "provider" "PushProvider" NOT NULL,
    "payload" JSONB NOT NULL,
    "token" TEXT NOT NULL,
    "status" "PushDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedAt" TIMESTAMP(3),
    "receiptsFetchedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_push_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "call_push_deliveries_callId_deviceId_provider_key" ON "call_push_deliveries"("callId", "deviceId", "provider");

-- CreateIndex
CREATE INDEX "call_push_deliveries_status_lastAttemptAt_idx" ON "call_push_deliveries"("status", "lastAttemptAt");

-- CreateIndex
CREATE INDEX "call_push_deliveries_callId_idx" ON "call_push_deliveries"("callId");

-- CreateIndex
CREATE INDEX "call_push_deliveries_deviceId_idx" ON "call_push_deliveries"("deviceId");

-- AddForeignKey
ALTER TABLE "call_push_deliveries" ADD CONSTRAINT "call_push_deliveries_callId_fkey"
    FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;