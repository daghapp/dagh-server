-- AlterTable
-- IF NOT EXISTS: production already had this column (db push / earlier apply),
-- so a plain ADD COLUMN failed with 42701 and left the migration in P3018.
ALTER TABLE "video_interactions" ADD COLUMN IF NOT EXISTS "durationMs" INTEGER;