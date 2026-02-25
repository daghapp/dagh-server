/*
  Warnings:

  - A unique constraint covering the columns `[paymentReference]` on the table `billing_history` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[clientReference]` on the table `payments` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "billing_history" ALTER COLUMN "paymentReference" SET DEFAULT 'unknown';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "clientReference" TEXT NOT NULL DEFAULT 'unknown',
ALTER COLUMN "paymentReference" SET DEFAULT 'unknown';

-- CreateIndex
CREATE UNIQUE INDEX "billing_history_paymentReference_key" ON "billing_history"("paymentReference");

-- CreateIndex
CREATE UNIQUE INDEX "payments_clientReference_key" ON "payments"("clientReference");
