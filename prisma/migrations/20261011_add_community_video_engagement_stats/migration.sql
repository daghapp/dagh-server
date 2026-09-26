-- Adds YouTube's public view/like counters to community video cards so the feed
-- can be ranked by "most watched" / "most liked". The counts come from the
-- channel sync (videos?part=statistics), not from VideoInteraction — those rows
-- only capture in-app activity and cannot report channel-wide engagement.
--
-- Defaults are 0 rather than NULL so the ORDER BY has no null group to reason
-- about; statsSyncedAt carries the "have we ever checked?" distinction instead.
--
-- IF NOT EXISTS / IF NOT EXISTS-guards throughout: these migrations have been
-- applied inconsistently (db push on some environments), and a bare ADD COLUMN
-- fails with 42701 and leaves the migration stuck in P3018.

ALTER TABLE "community_videos"
  ADD COLUMN IF NOT EXISTS "viewCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "community_videos"
  ADD COLUMN IF NOT EXISTS "likeCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "community_videos"
  ADD COLUMN IF NOT EXISTS "statsSyncedAt" TIMESTAMP(3);

-- Feed indexes. Every feed read filters on isPublished and then orders by one of
-- these columns, so without them the sort falls back to a full scan + sort of
-- the published set on each request.
CREATE INDEX IF NOT EXISTS "community_videos_isPublished_publishedAt_idx"
  ON "community_videos" ("isPublished", "publishedAt");

CREATE INDEX IF NOT EXISTS "community_videos_isPublished_viewCount_idx"
  ON "community_videos" ("isPublished", "viewCount");

CREATE INDEX IF NOT EXISTS "community_videos_isPublished_likeCount_idx"
  ON "community_videos" ("isPublished", "likeCount");
