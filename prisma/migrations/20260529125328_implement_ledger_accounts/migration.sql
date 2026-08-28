/*
  Warnings:

  - You are about to drop the column `date_of_arrival` on the `visa_on_arrival_data` table. All the data in the column will be lost.
  - You are about to drop the column `date_of_birth` on the `visa_on_arrival_data` table. All the data in the column will be lost.
  - You are about to drop the column `date_of_departure` on the `visa_on_arrival_data` table. All the data in the column will be lost.
  - You are about to drop the column `date_of_expiration` on the `visa_on_arrival_data` table. All the data in the column will be lost.
  - You are about to drop the column `date_of_issue` on the `visa_on_arrival_data` table. All the data in the column will be lost.
  - You are about to drop the column `duration_of_stay` on the `visa_on_arrival_data` table. All the data in the column will be lost.
  - You are about to drop the column `first_name` on the `visa_on_arrival_data` table. All the data in the column will be lost.
  - You are about to drop the column `former_nationality` on the `visa_on_arrival_data` table. All the data in the column will be lost.
  - You are about to drop the column `nationality` on the `visa_on_arrival_data` table. All the data in the column will be lost.
  - You are about to drop the column `passport` on the `visa_on_arrival_data` table. All the data in the column will be lost.
  - You are about to drop the column `place_of_birth` on the `visa_on_arrival_data` table. All the data in the column will be lost.
  - You are about to drop the column `place_of_issue` on the `visa_on_arrival_data` table. All the data in the column will be lost.
  - You are about to drop the column `previous_name` on the `visa_on_arrival_data` table. All the data in the column will be lost.
  - You are about to drop the column `proof_of_accommodation` on the `visa_on_arrival_data` table. All the data in the column will be lost.
  - You are about to drop the column `whatsapp_number` on the `visa_on_arrival_data` table. All the data in the column will be lost.
  - Added the required column `full_name` to the `visa_on_arrival_data` table without a default value. This is not possible if the table is not empty.
  - Added the required column `passport_image_url` to the `visa_on_arrival_data` table without a default value. This is not possible if the table is not empty.
  - Added the required column `phone` to the `visa_on_arrival_data` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "visa_on_arrival_data" DROP COLUMN "date_of_arrival",
DROP COLUMN "date_of_birth",
DROP COLUMN "date_of_departure",
DROP COLUMN "date_of_expiration",
DROP COLUMN "date_of_issue",
DROP COLUMN "duration_of_stay",
DROP COLUMN "first_name",
DROP COLUMN "former_nationality",
DROP COLUMN "nationality",
DROP COLUMN "passport",
DROP COLUMN "place_of_birth",
DROP COLUMN "place_of_issue",
DROP COLUMN "previous_name",
DROP COLUMN "proof_of_accommodation",
DROP COLUMN "whatsapp_number",
ADD COLUMN     "full_name" TEXT NOT NULL,
ADD COLUMN     "passport_image_url" TEXT NOT NULL,
ADD COLUMN     "phone" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
