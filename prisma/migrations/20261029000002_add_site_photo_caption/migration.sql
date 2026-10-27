-- Gallery items can now be text-only experience posts. Caption holds the
-- user's story/comment, and the image URL is optional.
ALTER TABLE "site_photos" ALTER COLUMN "url" DROP NOT NULL;
ALTER TABLE "site_photos" ADD COLUMN IF NOT EXISTS "caption" TEXT;
