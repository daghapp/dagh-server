-- Repoint backfilled channel grants at the real channel.
--
-- 20261007_add_channel_unlocks backfilled one grant per existing subscriber from
-- their video_unlocks rows, keying it on:
--
--   COALESCE(NULLIF(current_setting('app.youtube_channel_id', true), ''), 'LEGACY')
--
-- That GUC is a deploy-time convention nobody sets, so the fallback won: on a
-- production database every backfilled row landed as channelId = 'LEGACY' instead
-- of UCj8dtl0Hf6AZIlfDIq7fHAg. Harmless today only because the service resolves
-- grants by userId alone — the moment access is filtered by channel, or a second
-- channel is added, those rows match nothing and every existing subscriber is
-- silently re-gated.
--
-- The original migration is left untouched: it is already applied, and editing it
-- would invalidate its recorded checksum. This runs immediately after it on any
-- fresh deploy, so 'LEGACY' is written and then corrected within the same
-- migrate deploy.

DO $$
DECLARE
    target_channel TEXT := 'UCj8dtl0Hf6AZIlfDIq7fHAg';
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'channel_unlocks') THEN
    -- Drop the placeholder first where the user already holds a real grant.
    -- Re-pointing in place would collide with channel_unlocks_userId_channelId_key
    -- and abort the whole deploy, which is the one outcome worse than a stale id.
    DELETE FROM "channel_unlocks" AS legacy
    USING "channel_unlocks" AS real
    WHERE legacy."channelId" = 'LEGACY'
      AND real."userId" = legacy."userId"
      AND real."channelId" = target_channel;

    UPDATE "channel_unlocks"
    SET "channelId" = target_channel
    WHERE "channelId" = 'LEGACY';
  END IF;
END$$;
