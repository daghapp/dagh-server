-- User-submitted sites now capture the same detail fields as the production
-- catalogue so approval carries history and photo attribution through.
ALTER TABLE "pending_sites" ADD COLUMN IF NOT EXISTS "history" TEXT;
ALTER TABLE "pending_sites" ADD COLUMN IF NOT EXISTS "imageCredit" TEXT;
