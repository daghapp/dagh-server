/*
  Warnings:

  - The values [AFRICAN,ASIAN,EUROPEAN,NORTH_AMERICAN,SOUTH_AMERICAN,OCEANIAN,MIDDLE_EASTERN,OTHER] on the enum `Ethnicity` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "Ethnicity_new" AS ENUM ('African', 'Asian', 'Black_African_American', 'Caribbean', 'Caucassian_White', 'Hispanic_Latino', 'Middle_Eastern', 'Mixed', 'Native_American_Indigenous', 'Pacific_Islander', 'Other');
ALTER TABLE "users" ALTER COLUMN "ethnicity" TYPE "Ethnicity_new" USING ("ethnicity"::text::"Ethnicity_new");
ALTER TABLE "tour_requests" ALTER COLUMN "ethnicity" TYPE "Ethnicity_new" USING ("ethnicity"::text::"Ethnicity_new");
ALTER TYPE "Ethnicity" RENAME TO "Ethnicity_old";
ALTER TYPE "Ethnicity_new" RENAME TO "Ethnicity";
DROP TYPE "public"."Ethnicity_old";
COMMIT;
