-- AlterEnum
ALTER TYPE "AuthProvider" ADD VALUE 'PASSWPORD';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "fullName" TEXT;
