/*
  Warnings:

  - A unique constraint covering the columns `[paymentId]` on the table `visa_on_arrival_requests` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "VisaPackageType" AS ENUM ('STANDARD', 'EXPEDITED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VisaRequestStatus" ADD VALUE 'READY_FOR_GIS_SUBMISSION';
ALTER TYPE "VisaRequestStatus" ADD VALUE 'EXPEDITED_AIRPORT_PAYMENT_PENDING';

-- AlterTable
ALTER TABLE "visa_on_arrival_requests" ADD COLUMN     "packageType" "VisaPackageType";

-- CreateIndex
CREATE UNIQUE INDEX "visa_on_arrival_requests_paymentId_key" ON "visa_on_arrival_requests"("paymentId");
