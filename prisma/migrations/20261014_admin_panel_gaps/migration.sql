-- Admin Panel handoff gaps: user lifecycle (soft delete, status reason/history,
-- login lockout), payment refunds, tour catalogue + coordinates.

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';

-- AlterTable: users (soft delete, status reason, login lockout)
ALTER TABLE "users" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "statusReason" TEXT;
ALTER TABLE "users" ADD COLUMN "statusChangedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "statusChangedBy" TEXT;
ALTER TABLE "users" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- AlterTable: payments (refunds)
ALTER TABLE "payments" ADD COLUMN "refundedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "payments" ADD COLUMN "refundReason" TEXT;
ALTER TABLE "payments" ADD COLUMN "refundedAt" TIMESTAMP(3);

-- AlterTable: tour_packages (destination catalogue)
ALTER TABLE "tour_packages" ADD COLUMN "region" TEXT;
ALTER TABLE "tour_packages" ADD COLUMN "location" TEXT;
ALTER TABLE "tour_packages" ADD COLUMN "lastModifiedBy" TEXT;

-- AlterTable: tour_locations (coordinates)
ALTER TABLE "tour_locations" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "tour_locations" ADD COLUMN "longitude" DOUBLE PRECISION;

-- CreateTable: user_status_history
CREATE TABLE "user_status_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "from" TEXT,
    "to" TEXT NOT NULL,
    "reason" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_status_history_userId_idx" ON "user_status_history"("userId");

-- AddForeignKey
ALTER TABLE "user_status_history" ADD CONSTRAINT "user_status_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
