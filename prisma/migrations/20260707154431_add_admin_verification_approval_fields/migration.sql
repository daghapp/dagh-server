-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "profile_verification" ADD COLUMN     "bioDataApprovalReason" TEXT,
ADD COLUMN     "bioDataApprovedAt" TIMESTAMP(3),
ADD COLUMN     "bioDataApprovedBy" TEXT,
ADD COLUMN     "bioDataRejectedAt" TIMESTAMP(3),
ADD COLUMN     "bioDataRejectedBy" TEXT,
ADD COLUMN     "bioDataRejectionReason" TEXT,
ADD COLUMN     "bioDataStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "documentApprovalReason" TEXT,
ADD COLUMN     "documentApprovedAt" TIMESTAMP(3),
ADD COLUMN     "documentApprovedBy" TEXT,
ADD COLUMN     "documentRejectedAt" TIMESTAMP(3),
ADD COLUMN     "documentRejectedBy" TEXT,
ADD COLUMN     "documentRejectionReason" TEXT,
ADD COLUMN     "documentStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "faceApprovalReason" TEXT,
ADD COLUMN     "faceApprovedAt" TIMESTAMP(3),
ADD COLUMN     "faceApprovedBy" TEXT,
ADD COLUMN     "faceRejectedAt" TIMESTAMP(3),
ADD COLUMN     "faceRejectedBy" TEXT,
ADD COLUMN     "faceRejectionReason" TEXT,
ADD COLUMN     "faceStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING';
