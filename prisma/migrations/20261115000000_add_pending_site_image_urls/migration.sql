-- Add multi-image support columns to pending_sites
ALTER TABLE "pending_sites" ADD COLUMN IF NOT EXISTS "imageUrl2" TEXT;
ALTER TABLE "pending_sites" ADD COLUMN IF NOT EXISTS "imageUrl3" TEXT;
ALTER TABLE "pending_sites" ADD COLUMN IF NOT EXISTS "imageUrl4" TEXT;
