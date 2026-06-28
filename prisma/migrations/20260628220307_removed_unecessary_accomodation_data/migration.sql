/*
  Warnings:

  - You are about to drop the column `accommodation_type` on the `Hotel` table. All the data in the column will be lost.
  - You are about to drop the column `check_in_instructions` on the `Hotel` table. All the data in the column will be lost.
  - You are about to drop the column `distance_to_airport_km` on the `Hotel` table. All the data in the column will be lost.
  - You are about to drop the column `distance_to_business_km` on the `Hotel` table. All the data in the column will be lost.
  - You are about to drop the column `has_backup_power` on the `Hotel` table. All the data in the column will be lost.
  - You are about to drop the column `has_security_staff` on the `Hotel` table. All the data in the column will be lost.
  - You are about to drop the column `has_wifi` on the `Hotel` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Hotel" DROP COLUMN "accommodation_type",
DROP COLUMN "check_in_instructions",
DROP COLUMN "distance_to_airport_km",
DROP COLUMN "distance_to_business_km",
DROP COLUMN "has_backup_power",
DROP COLUMN "has_security_staff",
DROP COLUMN "has_wifi";
