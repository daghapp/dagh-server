/*
  Warnings:

  - A unique constraint covering the columns `[paymentId]` on the table `tour_requests` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[name]` on the table `tour_sites` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "PaymentTargetType" ADD VALUE 'TOUR_REQUEST';

-- AlterTable
ALTER TABLE "tour_requests" ADD COLUMN     "paymentId" TEXT,
ADD COLUMN     "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'INITIALIZED';

-- CreateIndex
CREATE UNIQUE INDEX "tour_requests_paymentId_key" ON "tour_requests"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "tour_sites_name_key" ON "tour_sites"("name");
