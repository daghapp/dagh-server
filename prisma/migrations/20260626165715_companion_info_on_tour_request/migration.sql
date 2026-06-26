-- AlterTable
ALTER TABLE "tour_requests" ADD COLUMN     "apartmentType" "ApartmentType",
ADD COLUMN     "companionInterest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "transportType" "TransportType";
