-- CreateTable
CREATE TABLE "Provider" (
    "provider_id" TEXT NOT NULL,
    "verification_status" BOOLEAN NOT NULL DEFAULT false,
    "display_name" TEXT NOT NULL,
    "media_assets" TEXT[],
    "location_lat" DOUBLE PRECISION NOT NULL,
    "location_lng" DOUBLE PRECISION NOT NULL,
    "location_address" TEXT NOT NULL,
    "avg_rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "response_time_secs" INTEGER NOT NULL DEFAULT 3600,
    "bio_description" TEXT NOT NULL,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("provider_id")
);

-- CreateTable
CREATE TABLE "TourGuide" (
    "provider_id" TEXT NOT NULL,
    "language_capability" TEXT[],
    "expertise_tags" TEXT[],
    "charge_per_day" DOUBLE PRECISION NOT NULL,
    "certification_docs" TEXT[],

    CONSTRAINT "TourGuide_pkey" PRIMARY KEY ("provider_id")
);

-- CreateTable
CREATE TABLE "CarRental" (
    "provider_id" TEXT NOT NULL,
    "vehicle_make" TEXT NOT NULL,
    "vehicle_model" TEXT NOT NULL,
    "vehicle_year" INTEGER NOT NULL,
    "transmission" TEXT NOT NULL,
    "fuel_type" TEXT NOT NULL,
    "safety_features" TEXT[],
    "rental_terms_url" TEXT NOT NULL,
    "daily_rate" DOUBLE PRECISION NOT NULL,
    "driver_required" BOOLEAN NOT NULL,

    CONSTRAINT "CarRental_pkey" PRIMARY KEY ("provider_id")
);

-- CreateTable
CREATE TABLE "Hotel" (
    "provider_id" TEXT NOT NULL,
    "accommodation_type" TEXT NOT NULL,
    "has_wifi" BOOLEAN NOT NULL DEFAULT false,
    "has_backup_power" BOOLEAN NOT NULL DEFAULT false,
    "has_security_staff" BOOLEAN NOT NULL DEFAULT false,
    "distance_to_airport_km" DOUBLE PRECISION NOT NULL,
    "distance_to_business_km" DOUBLE PRECISION NOT NULL,
    "check_in_instructions" TEXT NOT NULL,
    "base_price_per_night" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Hotel_pkey" PRIMARY KEY ("provider_id")
);

-- CreateTable
CREATE TABLE "ServiceRequest" (
    "request_token" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_date" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("request_token")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "log_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "ip_address" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("log_id")
);

-- AddForeignKey
ALTER TABLE "TourGuide" ADD CONSTRAINT "TourGuide_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "Provider"("provider_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarRental" ADD CONSTRAINT "CarRental_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "Provider"("provider_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hotel" ADD CONSTRAINT "Hotel_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "Provider"("provider_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "Provider"("provider_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "Provider"("provider_id") ON DELETE CASCADE ON UPDATE CASCADE;
