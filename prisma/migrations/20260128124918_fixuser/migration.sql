/*
  Warnings:

  - Added the required column `purpose` to the `otp` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "otp" ADD COLUMN     "purpose" TEXT NOT NULL;
