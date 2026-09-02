-- CreateTable
CREATE TABLE "message_push_deliveries" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
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

    CONSTRAINT "message_push_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messagesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_push_deliveries_messageId_deviceId_key" ON "message_push_deliveries"("messageId", "deviceId");

-- CreateIndex
CREATE INDEX "message_push_deliveries_status_lastAttemptAt_idx" ON "message_push_deliveries"("status", "lastAttemptAt");

-- CreateIndex
CREATE INDEX "message_push_deliveries_messageId_idx" ON "message_push_deliveries"("messageId");

-- CreateIndex
CREATE INDEX "message_push_deliveries_deviceId_idx" ON "message_push_deliveries"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "user_notification_preferences_userId_key" ON "user_notification_preferences"("userId");

-- AddForeignKey
ALTER TABLE "message_push_deliveries" ADD CONSTRAINT "message_push_deliveries_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
