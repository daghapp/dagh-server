/*
  Warnings:

  - The values [PASSWPORD] on the enum `AuthProvider` will be removed. If these variants are still used in the database, this will fail.
  - Made the column `fullName` on table `users` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "AuthProvider_new" AS ENUM ('GOOGLE', 'ICLOUD', 'FACEBOOK', 'EMAIL', 'PASSWORD');
ALTER TABLE "users" ALTER COLUMN "authProvider" TYPE "AuthProvider_new" USING ("authProvider"::text::"AuthProvider_new");
ALTER TYPE "AuthProvider" RENAME TO "AuthProvider_old";
ALTER TYPE "AuthProvider_new" RENAME TO "AuthProvider";
DROP TYPE "public"."AuthProvider_old";
COMMIT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "fullName" SET NOT NULL;
