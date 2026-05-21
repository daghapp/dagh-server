/*
  Warnings:

  - You are about to drop the column `clientReference` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `paymentReference` on the `payments` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[reference]` on the table `payments` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId]` on the table `payments` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `reference` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `targetId` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `targetType` to the `payments` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PaymentTargetType" AS ENUM ('VISA_ON_ARRIVAL', 'TOUR_BOOKING');

-- CreateEnum
CREATE TYPE "VisaRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VisaApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('MTN_MOMO', 'TELECEL_MOMO', 'AT_MOMO', 'CARD', 'BANK_TRANSFER', 'CASH');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('HUBTEL', 'PAYSTACK', 'STRIPE', 'FLUTTERWAVE');

-- DropForeignKey
ALTER TABLE "tour_bookings" DROP CONSTRAINT "tour_bookings_paymentId_fkey";

-- DropIndex
DROP INDEX "payments_clientReference_key";

-- DropIndex
DROP INDEX "payments_paymentReference_key";

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "clientReference",
DROP COLUMN "description",
DROP COLUMN "paymentReference",
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'GHS',
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "method" "PaymentMethod",
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "provider" "PaymentProvider",
ADD COLUMN     "providerReference" TEXT,
ADD COLUMN     "reference" TEXT NOT NULL,
ADD COLUMN     "targetId" TEXT NOT NULL,
ADD COLUMN     "targetType" "PaymentTargetType" NOT NULL,
ADD COLUMN     "transactionId" TEXT;

-- CreateTable
CREATE TABLE "visa_on_arrival_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "VisaRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paymentId" TEXT,

    CONSTRAINT "visa_on_arrival_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_on_arrival_data" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "passport" TEXT NOT NULL,
    "surname" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "previous_name" TEXT,
    "date_of_birth" TEXT NOT NULL,
    "place_of_birth" TEXT NOT NULL,
    "nationality" TEXT NOT NULL,
    "former_nationality" TEXT,
    "passport_number" TEXT NOT NULL,
    "date_of_issue" TEXT NOT NULL,
    "place_of_issue" TEXT NOT NULL,
    "date_of_expiration" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "whatsapp_number" TEXT,
    "date_of_arrival" TIMESTAMP(3),
    "date_of_departure" TIMESTAMP(3),
    "duration_of_stay" INTEGER,
    "purpose_of_trip" TEXT NOT NULL,
    "primary_place_of_stay" TEXT NOT NULL,
    "proof_of_accommodation" TEXT NOT NULL,

    CONSTRAINT "visa_on_arrival_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_on_arrival_approvals" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "status" "VisaApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,

    CONSTRAINT "visa_on_arrival_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visa_on_arrival_data_requestId_key" ON "visa_on_arrival_data"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "visa_on_arrival_approvals_requestId_key" ON "visa_on_arrival_approvals"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_reference_key" ON "payments"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "payments_userId_key" ON "payments"("userId");

-- AddForeignKey
ALTER TABLE "visa_on_arrival_requests" ADD CONSTRAINT "visa_on_arrival_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_on_arrival_data" ADD CONSTRAINT "visa_on_arrival_data_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "visa_on_arrival_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_on_arrival_approvals" ADD CONSTRAINT "visa_on_arrival_approvals_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "visa_on_arrival_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
