-- AlterTable
ALTER TABLE "users" ADD COLUMN "username" TEXT,
ADD COLUMN "firstName" TEXT,
ADD COLUMN "lastName" TEXT,
ADD COLUMN "profileImageUrl" TEXT;

-- Backfill firstName/lastName from the existing required fullName column so the
-- new login-profile fields are populated for accounts created before this change.
-- Users with a single-word name: whole name becomes firstName.
UPDATE "users" SET "firstName" = "fullName"
WHERE "firstName" IS NULL AND position(' ' in "fullName") = 0;

-- Multi-word names: first token becomes firstName, the remainder lastName.
UPDATE "users" SET "firstName" = split_part("fullName", ' ', 1),
                   "lastName" = trim(substr("fullName", position(' ' in "fullName") + 1))
WHERE "firstName" IS NULL AND position(' ' in "fullName") > 0;

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");