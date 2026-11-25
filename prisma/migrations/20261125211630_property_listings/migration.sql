-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('SALE', 'RENT', 'LEASE');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BadgeType" AS ENUM ('VERIFIED_DATE_STAMPED', 'GELIS_CONFIRMED', 'LAWYER_REVIEWED');

-- CreateTable
CREATE TABLE "property_listings" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" "ListingType" NOT NULL DEFAULT 'SALE',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceGhs" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "region" TEXT NOT NULL,
    "district" TEXT,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "images" TEXT[],
    "documents" TEXT[],
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "badge" "BadgeType",
    "badgeIssuedAt" TIMESTAMP(3),
    "gelisRef" TEXT,
    "lawyerId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_search_requests" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "listingId" TEXT,
    "query" TEXT NOT NULL,
    "searchType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resultRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_search_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "property_listings_status_region_type_idx" ON "property_listings"("status", "region", "type");

-- CreateIndex
CREATE INDEX "property_listings_ownerId_idx" ON "property_listings"("ownerId");

-- CreateIndex
CREATE INDEX "listing_search_requests_status_createdAt_idx" ON "listing_search_requests"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "property_listings" ADD CONSTRAINT "property_listings_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_search_requests" ADD CONSTRAINT "listing_search_requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_search_requests" ADD CONSTRAINT "listing_search_requests_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "property_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
