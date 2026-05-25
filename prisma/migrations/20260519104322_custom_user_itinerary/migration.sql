-- CreateTable
CREATE TABLE "user_tour_itineraries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "dayNumber" INTEGER,
    "title" VARCHAR(255),
    "description" TEXT,
    "breakfast" BOOLEAN,
    "lunch" BOOLEAN,
    "dinner" BOOLEAN,
    "accommodationName" TEXT,
    "accommodationType" TEXT,
    "accommodationRating" DECIMAL(65,30),

    CONSTRAINT "user_tour_itineraries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tour_itineraries_activities" (
    "id" TEXT NOT NULL,
    "userItineraryId" TEXT NOT NULL,
    "activityTime" TEXT,
    "activity" TEXT,
    "durationMinutes" INTEGER,
    "included" BOOLEAN,
    "cost" DECIMAL(65,30),
    "locationName" TEXT,
    "locationAddress" TEXT,

    CONSTRAINT "user_tour_itineraries_activities_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "user_tour_itineraries" ADD CONSTRAINT "user_tour_itineraries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tour_itineraries" ADD CONSTRAINT "user_tour_itineraries_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "tour_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tour_itineraries_activities" ADD CONSTRAINT "user_tour_itineraries_activities_userItineraryId_fkey" FOREIGN KEY ("userItineraryId") REFERENCES "user_tour_itineraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
