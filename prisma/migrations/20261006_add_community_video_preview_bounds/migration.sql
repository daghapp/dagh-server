-- Adds explicit preview bounds to community video cards so the stored teaserUrl
-- can be a genuinely clipped preview instead of a full-length embed link.
--
-- IF NOT EXISTS / DO-blocks throughout: these migrations have been applied
-- inconsistently (db push on some environments), and a bare ADD COLUMN fails
-- with 42701 and leaves the migration stuck in P3018.

ALTER TABLE "community_videos"
  ADD COLUMN IF NOT EXISTS "previewStartSeconds" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "community_videos"
  ADD COLUMN IF NOT EXISTS "previewDurationSeconds" INTEGER NOT NULL DEFAULT 45;

-- Close the existing leak: rows created by the channel sync stored the raw
-- full-length embed URL in teaserUrl. Append the clip bounds so those cards
-- stop handing out the whole video. Only touches bare embed URLs that have no
-- query string yet, which makes the statement re-runnable.
UPDATE "community_videos"
SET "teaserUrl" = "teaserUrl" || '?start=0&end=45&rel=0'
WHERE "teaserUrl" LIKE 'https://www.youtube.com/embed/%'
  AND "teaserUrl" NOT LIKE '%?%';
