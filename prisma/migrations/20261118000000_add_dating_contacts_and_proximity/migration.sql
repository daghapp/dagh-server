-- Dating contact discovery (privacy-preserving phone-hash matching) and
-- proximity alerts with per-pair cooldown tracking.

ALTER TABLE "discovery_preferences"
  ADD COLUMN IF NOT EXISTS "locationUpdatedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "contact_sync_consents" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "granted"      BOOLEAN NOT NULL DEFAULT true,
  "grantedAt"    TIMESTAMP(3),
  "revokedAt"    TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3),
  "contactCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contact_sync_consents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "contact_sync_consents_userId_key"
  ON "contact_sync_consents"("userId");

ALTER TABLE "contact_sync_consents"
  ADD CONSTRAINT "contact_sync_consents_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "contact_matches" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "matchedUserId" TEXT NOT NULL,
  "phoneHash"     TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contact_matches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "contact_matches_userId_matchedUserId_key"
  ON "contact_matches"("userId", "matchedUserId");

CREATE INDEX IF NOT EXISTS "contact_matches_matchedUserId_idx"
  ON "contact_matches"("matchedUserId");

ALTER TABLE "contact_matches"
  ADD CONSTRAINT "contact_matches_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_matches"
  ADD CONSTRAINT "contact_matches_matchedUserId_fkey"
  FOREIGN KEY ("matchedUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "dating_proximity_notifications" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "nearbyUserId" TEXT NOT NULL,
  "distanceKm"   DOUBLE PRECISION NOT NULL,
  "notifiedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dating_proximity_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "dating_proximity_notifications_userId_nearbyUserId_key"
  ON "dating_proximity_notifications"("userId", "nearbyUserId");

CREATE INDEX IF NOT EXISTS "dating_proximity_notifications_userId_notifiedAt_idx"
  ON "dating_proximity_notifications"("userId", "notifiedAt");

ALTER TABLE "dating_proximity_notifications"
  ADD CONSTRAINT "dating_proximity_notifications_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dating_proximity_notifications"
  ADD CONSTRAINT "dating_proximity_notifications_nearbyUserId_fkey"
  FOREIGN KEY ("nearbyUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
