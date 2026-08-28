-- CreateEnum
CREATE TYPE "EducationLevel" AS ENUM ('HIGH_SCHOOL', 'ASSOCIATES', 'BACHELORS', 'MASTERS', 'DOCTORATE', 'OTHER');

-- CreateEnum
CREATE TYPE "RelationshipIntention" AS ENUM ('LONG_TERM', 'SHORT_TERM', 'MARRIAGE', 'CASUAL', 'FRIENDSHIP', 'NOT_SURE');

-- CreateEnum
CREATE TYPE "ReligiousValues" AS ENUM ('CHRISTIANITY', 'ISLAM', 'HINDUISM', 'BUDDHISM', 'JUDAISM', 'AGNOSTIC', 'ATHEIST', 'SPIRITUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "Industry" AS ENUM ('TECHNOLOGY', 'HEALTHCARE', 'FINANCE', 'EDUCATION', 'MARKETING_SALES', 'ARTS_ENTERTAINMENT', 'ENGINEERING_CONSTRUCTION', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Gender" ADD VALUE 'NON_BINARY';
ALTER TYPE "Gender" ADD VALUE 'PREFER_NOT_TO_SAY';

-- CreateTable
CREATE TABLE "DatingUserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fullName" TEXT NOT NULL,
    "aboutMe" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "gender" "Gender" NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "city" TEXT NOT NULL,
    "highestLevelOfEducation" "EducationLevel" NOT NULL,
    "universitySchool" TEXT NOT NULL,
    "professionJobTitle" TEXT NOT NULL,
    "industry" "Industry" NOT NULL,
    "company" TEXT NOT NULL,
    "heritageEthnicity" TEXT NOT NULL,
    "languageSpoken" TEXT NOT NULL,
    "religiousValues" "ReligiousValues" NOT NULL,
    "homeTownAncestralVillage" TEXT NOT NULL,
    "relationshipIntention" "RelationshipIntention" NOT NULL,
    "interest" TEXT[],
    "profileImageUrl" TEXT NOT NULL,
    "galleryImageUrl" TEXT NOT NULL,

    CONSTRAINT "DatingUserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DatingUserProfile_userId_key" ON "DatingUserProfile"("userId");

-- AddForeignKey
ALTER TABLE "DatingUserProfile" ADD CONSTRAINT "DatingUserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
