-- Channel-scoped community video access.
--
-- A YouTube subscription is granted per CHANNEL, not per video. Until now the
-- only access record was video_unlocks (userId, videoId), so confirming a
-- subscription unlocked exactly the one card the user happened to tap — every
-- other video from the same channel stayed locked, and the app had to re-run the
-- whole OAuth round-trip for each one (the verdict cache lapses after an hour
-- and the gate fails closed on an absent verdict).
--
-- This adds channel_unlocks: one row per (user, channel), written once on a
-- positive server-side verdict and never re-checked. It is the record that
-- actually unlocks the feed, and it automatically covers videos published after
-- the subscription — which a fan-out of video_unlocks rows could not.
--
-- video_unlocks is deliberately left in place: it answers a per-video question
-- (how many unlocks this card got, and the SUBSCRIBE_INTENT → UNLOCK conversion
-- funnel) that a channel-level grant cannot.
--
-- Every statement is guarded so the migration is safely re-runnable, matching
-- 20261004_add_payment_gateway_config and 20261005_add_subscription_access_grants.

-- CreateTable
CREATE TABLE IF NOT EXISTS "channel_unlocks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "channel_unlocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "channel_unlocks_userId_channelId_key"
  ON "channel_unlocks"("userId", "channelId");

CREATE INDEX IF NOT EXISTS "channel_unlocks_userId_idx"
  ON "channel_unlocks"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'channel_unlocks_userId_fkey'
  ) THEN
    ALTER TABLE "channel_unlocks"
      ADD CONSTRAINT "channel_unlocks_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

-- Backfill: a user who already holds any per-video unlock has demonstrably been
-- verified as subscribed, so collapse their scattered rows into one channel
-- grant. Without this, existing subscribers would keep seeing every video except
-- the one they originally tapped locked.
--
-- Idempotent by construction: the NOT EXISTS guard means a re-run inserts
-- nothing, and it cannot clobber a grant already made through the new path.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'video_unlocks') THEN
    INSERT INTO "channel_unlocks" ("id", "userId", "channelId", "unlockedAt", "verifiedAt")
    SELECT
      md5(random()::text || clock_timestamp()::text || vu."userId"),
      vu."userId",
      COALESCE(NULLIF(current_setting('app.youtube_channel_id', true), ''), 'LEGACY'),
      MIN(vu."unlockedAt"),
      MIN(vu."unlockedAt")
    FROM "video_unlocks" vu
    GROUP BY vu."userId"
    HAVING MIN(vu."unlockedAt") IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "channel_unlocks" cu WHERE cu."userId" = vu."userId"
      );
  END IF;
END$$;
