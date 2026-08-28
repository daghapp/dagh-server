-- CreateEnum
CREATE TYPE "TourType" AS ENUM ('GROUP', 'SINGLE');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "DayType" AS ENUM ('PREPARATION', 'TOURING', 'DEPARTURE');

-- CreateEnum
CREATE TYPE "SiteCategory" AS ENUM ('NATURE', 'CULTURAL', 'HISTORICAL', 'BEACH', 'WILDLIFE', 'RELIGIOUS', 'SCENIC');

-- CreateTable
CREATE TABLE "tour_sites" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "imageUrl" TEXT,
    "category" "SiteCategory" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tourType" "TourType" NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "primaryPlaceOfStay" TEXT NOT NULL DEFAULT 'East Legon, Accra',
    "proofOfAccommodationUrl" TEXT,
    "relocationInterest" BOOLEAN NOT NULL DEFAULT false,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_request_sites" (
    "id" TEXT NOT NULL,
    "tourRequestId" TEXT NOT NULL,
    "tourSiteId" TEXT NOT NULL,

    CONSTRAINT "tour_request_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itineraries" (
    "id" TEXT NOT NULL,
    "tourRequestId" TEXT NOT NULL,
    "isFeasible" BOOLEAN NOT NULL,
    "feasibilityError" TEXT,
    "totalDays" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "itineraries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itinerary_days" (
    "id" TEXT NOT NULL,
    "itineraryId" TEXT NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "dayType" "DayType" NOT NULL,
    "relocationRequired" BOOLEAN NOT NULL DEFAULT false,
    "suggestedHotel" TEXT,

    CONSTRAINT "itinerary_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itinerary_day_sites" (
    "id" TEXT NOT NULL,
    "itineraryDayId" TEXT NOT NULL,
    "tourSiteId" TEXT NOT NULL,
    "visitOrder" INTEGER NOT NULL,

    CONSTRAINT "itinerary_day_sites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tour_request_sites_tourRequestId_tourSiteId_key" ON "tour_request_sites"("tourRequestId", "tourSiteId");

-- CreateIndex
CREATE UNIQUE INDEX "itineraries_tourRequestId_key" ON "itineraries"("tourRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "itinerary_days_itineraryId_dayNumber_key" ON "itinerary_days"("itineraryId", "dayNumber");

-- CreateIndex
CREATE UNIQUE INDEX "itinerary_day_sites_itineraryDayId_visitOrder_key" ON "itinerary_day_sites"("itineraryDayId", "visitOrder");

-- CreateIndex
CREATE UNIQUE INDEX "itinerary_day_sites_itineraryDayId_tourSiteId_key" ON "itinerary_day_sites"("itineraryDayId", "tourSiteId");

-- AddForeignKey
ALTER TABLE "tour_requests" ADD CONSTRAINT "tour_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_request_sites" ADD CONSTRAINT "tour_request_sites_tourRequestId_fkey" FOREIGN KEY ("tourRequestId") REFERENCES "tour_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_request_sites" ADD CONSTRAINT "tour_request_sites_tourSiteId_fkey" FOREIGN KEY ("tourSiteId") REFERENCES "tour_sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itineraries" ADD CONSTRAINT "itineraries_tourRequestId_fkey" FOREIGN KEY ("tourRequestId") REFERENCES "tour_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itinerary_days" ADD CONSTRAINT "itinerary_days_itineraryId_fkey" FOREIGN KEY ("itineraryId") REFERENCES "itineraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itinerary_day_sites" ADD CONSTRAINT "itinerary_day_sites_itineraryDayId_fkey" FOREIGN KEY ("itineraryDayId") REFERENCES "itinerary_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itinerary_day_sites" ADD CONSTRAINT "itinerary_day_sites_tourSiteId_fkey" FOREIGN KEY ("tourSiteId") REFERENCES "tour_sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
