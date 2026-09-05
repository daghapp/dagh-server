-- AlterTable: add missing columns to user_devices that were
-- added to the Prisma model but never migrated
ALTER TABLE "user_devices"
    ADD COLUMN "failureCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "disabledAt" TIMESTAMP(3);