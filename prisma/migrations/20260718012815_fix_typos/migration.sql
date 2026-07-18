/*
  Warnings:

  - You are about to drop the column `document_verificaiton` on the `profile_verification` table. All the data in the column will be lost.
  - You are about to drop the column `isVerifided` on the `profile_verification` table. All the data in the column will be lost.
  - You are about to drop the column `flight_itenary_image_url` on the `visa_on_arrival_data` table. All the data in the column will be lost.
  - Added the required column `flight_itinerary_image_url` to the `visa_on_arrival_data` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "profile_verification" DROP COLUMN "document_verificaiton",
DROP COLUMN "isVerifided",
ADD COLUMN     "document_verification" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isVerified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "visa_on_arrival_data" DROP COLUMN "flight_itenary_image_url",
ADD COLUMN     "flight_itinerary_image_url" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "messages_senderId_idx" ON "messages"("senderId");

-- CreateIndex
CREATE INDEX "messages_receiverId_idx" ON "messages"("receiverId");

-- CreateIndex
CREATE INDEX "otp_email_purpose_idx" ON "otp"("email", "purpose");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_userId_idx" ON "payments"("userId");
