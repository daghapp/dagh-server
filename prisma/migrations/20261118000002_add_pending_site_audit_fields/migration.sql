-- Add moderation audit fields to pending_sites (mirrors site_photos).
ALTER TABLE "pending_sites" ADD COLUMN "moderatedBy" TEXT;
ALTER TABLE "pending_sites" ADD COLUMN "moderatedAt" TIMESTAMP(3);
