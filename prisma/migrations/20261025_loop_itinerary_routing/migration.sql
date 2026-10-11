-- Dynamic loop-based itinerary generation.
--
-- Adds the user-selected routing hub, the Accra overnight cost kill-switch, and
-- per-day / per-itinerary metadata used to render descriptive day headers and
-- the region cascade without cross-regional backtracking.

-- AlterTable
ALTER TABLE "tour_requests"
    ADD COLUMN "startRegion" TEXT,
    ADD COLUMN "allowAccraOvernight" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "itineraries"
    ADD COLUMN "routeRegions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "accraNights" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "itinerary_days"
    ADD COLUMN "title" TEXT,
    ADD COLUMN "region" TEXT;
