-- Admin push broadcasts with explicit consent for promotional content.

ALTER TABLE "user_notification_preferences"
  ADD COLUMN IF NOT EXISTS "announcementsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "promotionsEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "announcements" (
  "id"             TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "body"           TEXT NOT NULL,
  "category"       TEXT NOT NULL,
  "audience"       TEXT NOT NULL DEFAULT 'ACTIVE',
  "route"          TEXT,
  "status"         TEXT NOT NULL DEFAULT 'DRAFT',
  "scheduledAt"    TIMESTAMP(3),
  "startedAt"      TIMESTAMP(3),
  "completedAt"    TIMESTAMP(3),
  "createdBy"      TEXT NOT NULL,
  "recipientCount" INTEGER NOT NULL DEFAULT 0,
  "deviceCount"    INTEGER NOT NULL DEFAULT 0,
  "sentCount"      INTEGER NOT NULL DEFAULT 0,
  "failedCount"    INTEGER NOT NULL DEFAULT 0,
  "skippedCount"   INTEGER NOT NULL DEFAULT 0,
  "lastError"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "announcements_status_scheduledAt_idx"
  ON "announcements"("status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "announcements_createdAt_idx"
  ON "announcements"("createdAt");

CREATE TABLE IF NOT EXISTS "announcement_deliveries" (
  "id"                TEXT NOT NULL,
  "announcementId"    TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "deviceId"          TEXT NOT NULL,
  "provider"          TEXT NOT NULL,
  "status"            TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount"      INTEGER NOT NULL DEFAULT 0,
  "providerMessageId" TEXT,
  "errorCode"         TEXT,
  "availableAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt"            TIMESTAMP(3),
  "receiptsFetchedAt" TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "announcement_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "announcement_deliveries_announcementId_deviceId_provider_key"
  ON "announcement_deliveries"("announcementId", "deviceId", "provider");
CREATE INDEX IF NOT EXISTS "announcement_deliveries_announcementId_status_availableAt_idx"
  ON "announcement_deliveries"("announcementId", "status", "availableAt");
CREATE INDEX IF NOT EXISTS "announcement_deliveries_status_availableAt_idx"
  ON "announcement_deliveries"("status", "availableAt");
CREATE INDEX IF NOT EXISTS "announcement_deliveries_provider_status_receiptsFetchedAt_idx"
  ON "announcement_deliveries"("provider", "status", "receiptsFetchedAt");

ALTER TABLE "announcement_deliveries"
  ADD CONSTRAINT "announcement_deliveries_announcementId_fkey"
  FOREIGN KEY ("announcementId") REFERENCES "announcements"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
