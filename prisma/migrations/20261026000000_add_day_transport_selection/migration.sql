-- Per-day car rental selection on the itinerary.
--
-- Lets the traveller confirm (or override) a specific verified car-rental
-- provider for a day. NULL keeps serving the read-time localTransport
-- recommendation.

-- AlterTable
ALTER TABLE "itinerary_days" ADD COLUMN "transportProviderId" TEXT;

-- AddForeignKey
ALTER TABLE "itinerary_days" ADD CONSTRAINT "itinerary_days_transportProviderId_fkey"
    FOREIGN KEY ("transportProviderId") REFERENCES "Provider"("provider_id") ON DELETE SET NULL ON UPDATE CASCADE;
