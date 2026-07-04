-- CreateEnum
CREATE TYPE "Ethnicity" AS ENUM ('AFRICAN', 'ASIAN', 'EUROPEAN', 'NORTH_AMERICAN', 'SOUTH_AMERICAN', 'OCEANIAN', 'MIDDLE_EASTERN', 'OTHER');

-- AlterTable
ALTER TABLE "tour_requests" ADD COLUMN     "ethnicity" "Ethnicity";
