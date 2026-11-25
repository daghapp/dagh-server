/*
  Warnings:

  - You are about to drop the `DatingUserProfile` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "IdentityVerificationStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'APPEALED');

-- DropForeignKey
ALTER TABLE "DatingUserProfile" DROP CONSTRAINT "DatingUserProfile_userId_fkey";

-- DropIndex
DROP INDEX "pending_sites_status_idx";

-- DropIndex
DROP INDEX "pending_sites_submittedBy_idx";

-- DropTable
DROP TABLE "DatingUserProfile";

-- DropEnum
DROP TYPE "EducationLevel";

-- DropEnum
DROP TYPE "Industry";

-- DropEnum
DROP TYPE "RelationshipIntention";

-- DropEnum
DROP TYPE "ReligiousValues";

-- CreateTable
CREATE TABLE "dating_activity_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dating_activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_verifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "IdentityVerificationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "idDocumentType" TEXT,
    "idNumberHash" TEXT,
    "idFrontUrl" TEXT,
    "idBackUrl" TEXT,
    "selfieUrl" TEXT,
    "livenessScore" DOUBLE PRECISION,
    "faceMatchScore" DOUBLE PRECISION,
    "otpVerifiedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "consentVersion" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retentionUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_appeals" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceUrls" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_appeals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dating_activity_logs_actorId_idx" ON "dating_activity_logs"("actorId");

-- CreateIndex
CREATE INDEX "dating_activity_logs_entityType_entityId_idx" ON "dating_activity_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "dating_activity_logs_createdAt_idx" ON "dating_activity_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "identity_verifications_userId_key" ON "identity_verifications"("userId");

-- CreateIndex
CREATE INDEX "identity_verifications_status_createdAt_idx" ON "identity_verifications"("status", "createdAt");

-- CreateIndex
CREATE INDEX "verification_appeals_status_createdAt_idx" ON "verification_appeals"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_appeals" ADD CONSTRAINT "verification_appeals_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "identity_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "public_transport_services_mode_operator_originCity_destinationC" RENAME TO "public_transport_services_mode_operator_originCity_destinat_key";

-- RenameIndex
ALTER INDEX "tour_request_dating_selections_tourRequestId_datingProfileId_ke" RENAME TO "tour_request_dating_selections_tourRequestId_datingProfileI_key";
