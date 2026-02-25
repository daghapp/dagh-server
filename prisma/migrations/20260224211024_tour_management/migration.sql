-- CreateTable
CREATE TABLE "tour_packages" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "slug" TEXT,
    "description" TEXT,
    "shortDescription" TEXT,
    "category" TEXT,
    "subcategory" TEXT,
    "durationDays" INTEGER,
    "durationNights" INTEGER,
    "basePrice" DECIMAL(65,30),
    "currency" TEXT,
    "status" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "trending" BOOLEAN NOT NULL DEFAULT false,
    "cancellationPolicy" TEXT,
    "bookingDeadline" INTEGER,
    "minimumBooking" INTEGER,
    "accessibility" TEXT,
    "coverImage" TEXT,
    "heritageDnaTesting" BOOLEAN NOT NULL DEFAULT false,
    "overallRating" DECIMAL(65,30),
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "bookingCount" INTEGER NOT NULL DEFAULT 0,
    "wishlistCount" INTEGER NOT NULL DEFAULT 0,
    "shareCount" INTEGER NOT NULL DEFAULT 0,
    "conversionRate" DECIMAL(65,30),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_itineraries" (
    "id" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "dayNumber" INTEGER,
    "title" VARCHAR(255),
    "description" TEXT,
    "breakfast" BOOLEAN,
    "lunch" BOOLEAN,
    "dinner" BOOLEAN,
    "accommodationName" TEXT,
    "accommodationType" TEXT,
    "accommodationRating" DECIMAL(65,30),

    CONSTRAINT "tour_itineraries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itinerary_activities" (
    "id" TEXT NOT NULL,
    "itineraryId" TEXT NOT NULL,
    "activityTime" TEXT,
    "activity" TEXT,
    "durationMinutes" INTEGER,
    "included" BOOLEAN,
    "cost" DECIMAL(65,30),
    "locationName" TEXT,
    "locationAddress" TEXT,

    CONSTRAINT "itinerary_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_locations" (
    "id" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "name" TEXT,
    "city" TEXT,
    "region" TEXT,
    "description" TEXT,
    "visitDuration" INTEGER,
    "photos" TEXT[],

    CONSTRAINT "tour_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_media" (
    "id" TEXT NOT NULL,
    "tour_id" TEXT NOT NULL,
    "media_type" VARCHAR(20),
    "url" TEXT,

    CONSTRAINT "tour_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_includes" (
    "id" TEXT NOT NULL,
    "tour_id" TEXT NOT NULL,
    "item" TEXT,

    CONSTRAINT "pricing_includes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_excludes" (
    "id" TEXT NOT NULL,
    "tour_id" TEXT NOT NULL,
    "item" TEXT,

    CONSTRAINT "pricing_excludes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tour_packages_slug_key" ON "tour_packages"("slug");

-- AddForeignKey
ALTER TABLE "tour_itineraries" ADD CONSTRAINT "tour_itineraries_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "tour_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itinerary_activities" ADD CONSTRAINT "itinerary_activities_itineraryId_fkey" FOREIGN KEY ("itineraryId") REFERENCES "tour_itineraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_locations" ADD CONSTRAINT "tour_locations_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "tour_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_media" ADD CONSTRAINT "tour_media_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tour_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_includes" ADD CONSTRAINT "pricing_includes_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tour_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_excludes" ADD CONSTRAINT "pricing_excludes_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tour_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
