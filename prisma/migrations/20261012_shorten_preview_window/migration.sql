-- Shortens the locked-viewer teaser from the old 45s default to 30s.
--
-- Two separate changes, because the code default and the stored rows are not the
-- same thing. DEFAULT_PREVIEW_DURATION_SECONDS in src/services/youtube.service.ts
-- governs cards created from here on (both the channel sync and the admin create
-- path read it), while rows written before this migration keep whatever integer
-- they were stored with. The channel sync deliberately does NOT rewrite preview
-- bounds on cards it already knows about, so without the UPDATE below a
-- published feed would stay at 45s indefinitely and the shorter default would
-- only ever apply to future uploads.
--
-- The UPDATE is deliberately narrow: it touches only rows still sitting on the
-- old default, so a card whose bounds an admin set by hand keeps them — and the
-- sync will not clobber that later either.
--
-- Guarded because these migrations have been applied inconsistently across
-- environments (db push on some). A bare ALTER/UPDATE against a database that
-- never received the preview-bounds migration fails with 42703 and leaves this
-- migration stuck in P3018.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'community_videos'
      AND column_name = 'previewDurationSeconds'
  ) THEN
    ALTER TABLE "community_videos"
      ALTER COLUMN "previewDurationSeconds" SET DEFAULT 30;

    UPDATE "community_videos"
    SET "previewDurationSeconds" = 30
    WHERE "previewDurationSeconds" = 45;
  END IF;
END $$;
