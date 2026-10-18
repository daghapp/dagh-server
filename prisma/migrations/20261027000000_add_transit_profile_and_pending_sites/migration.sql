-- Expanded Accommodation Engine + Transit Profile + User-Submitted Sites
-- ──────────────────────────────────────────────────────────────────
-- 1. Add TransitProfile enum type
-- 2. Add ADVENTURE, URBAN, HERITAGE values to SiteCategory enum
-- 3. Add categories array field to tour_packages (§5: album structure)
-- 4. Add transit_profile field to tour_sites (§2: integrated transit suggestions)
-- 5. Create pending_sites table (§3: user-generated tour sites with admin approval)

-- Step 1: Create TransitProfile enum
CREATE TYPE "TransitProfile" AS ENUM ('URBAN_CENTER', 'PERI_URBAN', 'RURAL');

-- Step 2: Add ADVENTURE, URBAN, HERITAGE values to SiteCategory enum
-- PostgreSQL 11+ supports adding multiple values in one ALTER TYPE
ALTER TYPE "SiteCategory" ADD VALUE 'ADVENTURE';
ALTER TYPE "SiteCategory" ADD VALUE 'URBAN';
ALTER TYPE "SiteCategory" ADD VALUE 'HERITAGE';

-- Step 3: Add categories array field to tour_packages
ALTER TABLE "tour_packages" ADD COLUMN     "categories" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Step 4: Add transit_profile field to tour_sites
ALTER TABLE "tour_sites" ADD COLUMN     "transit_profile" "TransitProfile" NOT NULL DEFAULT 'RURAL';

-- Step 5: Create pending_sites table for user-submitted tour sites with admin approval
CREATE TABLE "pending_sites" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "imageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "submittedBy" TEXT NOT NULL,
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_sites_pkey" PRIMARY KEY ("id")
);

-- Add index on status for faster admin queries
CREATE INDEX "pending_sites_status_idx" ON "pending_sites" ("status");
CREATE INDEX "pending_sites_submittedBy_idx" ON "pending_sites" ("submittedBy");