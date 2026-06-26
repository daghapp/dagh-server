-- CreateEnum
CREATE TYPE "ApartmentType" AS ENUM ('HOTEL', 'GUESTHOUSE', 'AIRBNB', 'APARTMENTS');

-- CreateEnum
CREATE TYPE "TransportType" AS ENUM ('TROTRO', 'UBER', 'RENTED_VEHICLE', 'NONE');

-- AlterTable
ALTER TABLE "CarRental" ADD COLUMN     "transport_type" "TransportType";

-- AlterTable
ALTER TABLE "Hotel" ADD COLUMN     "apartment_type" "ApartmentType";
