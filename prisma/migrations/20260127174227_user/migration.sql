-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'PENDING_VERIFICATION');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('USER', 'ADMIN', 'MODERATOR');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE', 'ICLOUD', 'FACEBOOK', 'EMAIL');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "VerificationLevel" AS ENUM ('BASIC', 'ADVANCED', 'FULL');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "authProvider" "AuthProvider" NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "passwordLastChanged" TIMESTAMP(3),
    "accountStatus" "AccountStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "accountType" "AccountType" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" "Gender",
    "nationality" TEXT,
    "residenceCountry" TEXT,
    "residenceCity" TEXT,
    "residenceState" TEXT,
    "profilePhotoUrl" TEXT,
    "profilePhotoUploadedAt" TIMESTAMP(3),
    "bio" TEXT,
    "languages" TEXT[],

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_verifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verificationLevel" "VerificationLevel",

    CONSTRAINT "user_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "government_ids" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "idType" TEXT,
    "number" TEXT,
    "country" TEXT,
    "expiryDate" TIMESTAMP(3),
    "frontImageUrl" TEXT,
    "backImageUrl" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,

    CONSTRAINT "government_ids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "selfie_verifications" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "imageUrl" TEXT,
    "matchScore" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "aiProvider" TEXT,

    CONSTRAINT "selfie_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "background_checks" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "status" TEXT,
    "provider" TEXT,
    "completedAt" TIMESTAMP(3),
    "reportUrl" TEXT,

    CONSTRAINT "background_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_userId_key" ON "user_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_verifications_userId_key" ON "user_verifications"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "government_ids_verificationId_key" ON "government_ids"("verificationId");

-- CreateIndex
CREATE UNIQUE INDEX "government_ids_number_key" ON "government_ids"("number");

-- CreateIndex
CREATE UNIQUE INDEX "selfie_verifications_verificationId_key" ON "selfie_verifications"("verificationId");

-- CreateIndex
CREATE UNIQUE INDEX "background_checks_verificationId_key" ON "background_checks"("verificationId");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_verifications" ADD CONSTRAINT "user_verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "government_ids" ADD CONSTRAINT "government_ids_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "user_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selfie_verifications" ADD CONSTRAINT "selfie_verifications_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "user_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "background_checks" ADD CONSTRAINT "background_checks_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "user_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
