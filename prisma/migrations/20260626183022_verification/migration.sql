/*
  Warnings:

  - The values [BASIC,ADVANCED,FULL] on the enum `VerificationLevel` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `bio` on the `user_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `dateOfBirth` on the `user_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `firstName` on the `user_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `gender` on the `user_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `languages` on the `user_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `lastName` on the `user_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `nationality` on the `user_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `profilePhotoUploadedAt` on the `user_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `profilePhotoUrl` on the `user_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `residenceCity` on the `user_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `residenceCountry` on the `user_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `residenceState` on the `user_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `username` on the `user_profiles` table. All the data in the column will be lost.
  - You are about to drop the `background_checks` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `government_ids` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `selfie_verifications` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "BioDocumentType" AS ENUM ('PASSPORT', 'GHANA_CARD');

-- AlterEnum
BEGIN;
CREATE TYPE "VerificationLevel_new" AS ENUM ('PHONE_NUMBER_VERIFICATION', 'IP_ADDRESS_CHECK', 'BIO_PROFILE_IMAGE_CHECK', 'DOCUMENT_CHECK');
ALTER TABLE "user_verifications" ALTER COLUMN "verificationLevel" TYPE "VerificationLevel_new" USING ("verificationLevel"::text::"VerificationLevel_new");
ALTER TYPE "VerificationLevel" RENAME TO "VerificationLevel_old";
ALTER TYPE "VerificationLevel_new" RENAME TO "VerificationLevel";
DROP TYPE "public"."VerificationLevel_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "background_checks" DROP CONSTRAINT "background_checks_verificationId_fkey";

-- DropForeignKey
ALTER TABLE "government_ids" DROP CONSTRAINT "government_ids_verificationId_fkey";

-- DropForeignKey
ALTER TABLE "selfie_verifications" DROP CONSTRAINT "selfie_verifications_verificationId_fkey";

-- AlterTable
ALTER TABLE "user_profiles" DROP COLUMN "bio",
DROP COLUMN "dateOfBirth",
DROP COLUMN "firstName",
DROP COLUMN "gender",
DROP COLUMN "languages",
DROP COLUMN "lastName",
DROP COLUMN "nationality",
DROP COLUMN "profilePhotoUploadedAt",
DROP COLUMN "profilePhotoUrl",
DROP COLUMN "residenceCity",
DROP COLUMN "residenceCountry",
DROP COLUMN "residenceState",
DROP COLUMN "username",
ADD COLUMN     "bio_document_type" "BioDocumentType",
ADD COLUMN     "bio_document_uploaded_at" TIMESTAMP(3),
ADD COLUMN     "bio_document_urls" TEXT[],
ADD COLUMN     "bio_profile_image_uploaded_at" TIMESTAMP(3),
ADD COLUMN     "bio_profile_image_url" TEXT,
ADD COLUMN     "phoneNumber" TEXT,
ADD COLUMN     "profileUrl" TEXT;

-- DropTable
DROP TABLE "background_checks";

-- DropTable
DROP TABLE "government_ids";

-- DropTable
DROP TABLE "selfie_verifications";

-- CreateTable
CREATE TABLE "profile_verification" (
    "id" TEXT NOT NULL,
    "userProfileId" TEXT NOT NULL,
    "isVerifided" BOOLEAN NOT NULL DEFAULT false,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL,
    "phone_number_verified" BOOLEAN NOT NULL DEFAULT false,
    "ip_address_verification" BOOLEAN NOT NULL DEFAULT false,
    "bio_profile_verification" BOOLEAN NOT NULL DEFAULT false,
    "document_verificaiton" BOOLEAN NOT NULL DEFAULT false,
    "verification_message" TEXT,

    CONSTRAINT "profile_verification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profile_verification_userProfileId_key" ON "profile_verification"("userProfileId");

-- AddForeignKey
ALTER TABLE "profile_verification" ADD CONSTRAINT "profile_verification_userProfileId_fkey" FOREIGN KEY ("userProfileId") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
