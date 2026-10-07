-- Waived/free tour bookings previously wrote the shared sentinel 'FREE_BOOKING'
-- into the unique paymentId column, so the second waiver collided with a
-- "Unique constraint failed" (500). Track waivers with a dedicated flag and keep
-- paymentId NULL (NULLs do not collide in a Postgres unique index).

-- AlterTable
ALTER TABLE "tour_bookings" ADD COLUMN "feeWaived" BOOLEAN NOT NULL DEFAULT FALSE;

-- Clean up any rows already holding the sentinel.
UPDATE "tour_bookings"
SET "feeWaived" = TRUE, "paymentId" = NULL
WHERE "paymentId" = 'FREE_BOOKING';