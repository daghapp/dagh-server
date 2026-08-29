-- Tour-to-dating integration
-- Add casual-dating opt-in on tour requests, travel-context fields on dating
-- profiles, and a junction table linking selected dating profiles to a tour.

-- TourRequest: user opted in to casual-dating recommendations for this trip.
ALTER TABLE "tour_requests" ADD COLUMN "casualDatingInterest" BOOLEAN NOT NULL DEFAULT false;

-- DatingProfile: where the user plans to travel / be available and the window
-- during which their profile should surface for schedule-overlap matching.
ALTER TABLE "dating_profiles"
  ADD COLUMN "travelLocationLat" DOUBLE PRECISION,
  ADD COLUMN "travelLocationLng" DOUBLE PRECISION,
  ADD COLUMN "availableFrom" TIMESTAMP(3),
  ADD COLUMN "availableTo" TIMESTAMP(3);

-- Junction: dating profiles the user selects to merge into a tour itinerary
-- as social / leisure blocks.
CREATE TABLE "tour_request_dating_selections" (
    "id" TEXT NOT NULL,
    "tourRequestId" TEXT NOT NULL,
    "datingProfileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_request_dating_selections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tour_request_dating_selections_tourRequestId_datingProfileId_key"
  ON "tour_request_dating_selections"("tourRequestId", "datingProfileId");

CREATE INDEX "tour_request_dating_selections_tourRequestId_idx"
  ON "tour_request_dating_selections"("tourRequestId");

ALTER TABLE "tour_request_dating_selections"
  ADD CONSTRAINT "tour_request_dating_selections_tourRequestId_fkey"
  FOREIGN KEY ("tourRequestId") REFERENCES "tour_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tour_request_dating_selections"
  ADD CONSTRAINT "tour_request_dating_selections_datingProfileId_fkey"
  FOREIGN KEY ("datingProfileId") REFERENCES "dating_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
