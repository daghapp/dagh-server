-- Expanded Accommodation Engine + Mobility Catalog + Community Photos + Album Tags
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add MOTEL to ApartmentType (broader property types, §1)
-- 2. Add categories tag array to tour_sites (§5: multi-tag album structure)
-- 3. Declare the existing tour_sites.transit_profile column default in schema
-- 4. Create site_photos moderation queue (§4: community photo uploads)
-- 5. Create public_transport_services catalog (§2: STC/VIP/trotro/air mobility)

-- Step 1: Broader accommodation property types
ALTER TYPE "ApartmentType" ADD VALUE 'MOTEL';

-- Step 2: Multi-tag album keys on tour sites
ALTER TABLE "tour_sites" ADD COLUMN "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Step 3: Schema now declares @default(RURAL); the column already carries this
-- default from 20261027, this keeps migration history aligned with the schema.
ALTER TABLE "tour_sites" ALTER COLUMN "transit_profile" SET DEFAULT 'RURAL';

-- Step 4: Community photo uploads with moderation states
CREATE TYPE "PhotoStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "site_photos" (
    "id" TEXT NOT NULL,
    "tourSiteId" TEXT NOT NULL,
    "uploaderId" TEXT,
    "url" TEXT NOT NULL,
    "publicId" TEXT,
    "thumbUrl" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "sizeBytes" INTEGER,
    "status" "PhotoStatus" NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "moderatedBy" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_photos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "site_photos_tourSiteId_status_idx" ON "site_photos"("tourSiteId", "status");
CREATE INDEX "site_photos_status_createdAt_idx" ON "site_photos"("status", "createdAt");

ALTER TABLE "site_photos" ADD CONSTRAINT "site_photos_tourSiteId_fkey"
    FOREIGN KEY ("tourSiteId") REFERENCES "tour_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 5: Public transport catalog (intercity buses, trotro corridors, air ports)
CREATE TYPE "PublicTransportMode" AS ENUM ('INTERCITY_BUS', 'TROTRO', 'DOMESTIC_AIR');

CREATE TABLE "public_transport_services" (
    "id" TEXT NOT NULL,
    "mode" "PublicTransportMode" NOT NULL,
    "operator" TEXT NOT NULL,
    "originCity" TEXT NOT NULL,
    "originStation" TEXT,
    "originLat" DOUBLE PRECISION,
    "originLng" DOUBLE PRECISION,
    "destinationCity" TEXT,
    "destinationRegion" TEXT,
    "destinationLat" DOUBLE PRECISION,
    "destinationLng" DOUBLE PRECISION,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_transport_services_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "public_transport_services_mode_operator_originCity_destinationCity_key"
    ON "public_transport_services"("mode", "operator", "originCity", "destinationCity");

CREATE INDEX "public_transport_services_mode_destinationRegion_idx"
    ON "public_transport_services"("mode", "destinationRegion");
