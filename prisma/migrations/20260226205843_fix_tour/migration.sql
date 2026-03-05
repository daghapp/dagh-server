-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'REFUNDED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "tour_bookings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "bookingReference" TEXT NOT NULL,
    "numberOfPeople" INTEGER NOT NULL,
    "bookingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tourStartDate" TIMESTAMP(3) NOT NULL,
    "tourEndDate" TIMESTAMP(3),
    "totalPrice" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "paymentId" TEXT,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "specialRequests" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "emergencyContact" TEXT,
    "emergencyPhone" TEXT,
    "cancellationReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "refundAmount" DECIMAL(65,30),
    "refundedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tour_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tour_bookings_bookingReference_key" ON "tour_bookings"("bookingReference");

-- CreateIndex
CREATE UNIQUE INDEX "tour_bookings_paymentId_key" ON "tour_bookings"("paymentId");

-- CreateIndex
CREATE INDEX "tour_bookings_userId_idx" ON "tour_bookings"("userId");

-- CreateIndex
CREATE INDEX "tour_bookings_tourId_idx" ON "tour_bookings"("tourId");

-- CreateIndex
CREATE INDEX "tour_bookings_status_idx" ON "tour_bookings"("status");

-- CreateIndex
CREATE INDEX "tour_bookings_bookingDate_idx" ON "tour_bookings"("bookingDate");

-- AddForeignKey
ALTER TABLE "tour_bookings" ADD CONSTRAINT "tour_bookings_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_bookings" ADD CONSTRAINT "tour_bookings_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "tour_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_bookings" ADD CONSTRAINT "tour_bookings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
