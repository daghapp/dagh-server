/*
  Warnings:

  - You are about to drop the column `full_name` on the `visa_on_arrival_data` table. All the data in the column will be lost.

*/
-- AlterEnum
ALTER TYPE "VisaRequestStatus" ADD VALUE 'PAYMENT_FAILED';

-- AlterTable
ALTER TABLE "hubtel_direct_receive_logs" ADD COLUMN     "paymentDetails" TEXT;

-- AlterTable
ALTER TABLE "visa_on_arrival_data" DROP COLUMN "full_name";
