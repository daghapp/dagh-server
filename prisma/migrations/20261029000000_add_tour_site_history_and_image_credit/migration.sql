-- Destination detail content: long-form history and photo attribution.
ALTER TABLE "tour_sites" ADD COLUMN IF NOT EXISTS "history" TEXT;
ALTER TABLE "tour_sites" ADD COLUMN IF NOT EXISTS "imageCredit" TEXT;
