/*
  Align admin enums with the DAGH Admin Panel spec (§1, §4):
  4 departments and 4 roles. Legacy values are remapped before dropping.

  Department mapping:
    DIASPORA_AFFAIRS / OPERATIONS / VISA / TOURS / MARKETING /
    MODERATION / CUSTOMER_SUPPORT -> OPERATIONS_AND_MEMBERSHIP
    FINANCE / LEGAL               -> FINANCE_AND_COMPLIANCE
    IT_SUPPORT                    -> TECHNICAL_SUPPORT

  Role mapping:
    ADMIN / VISA_OFFICER / TOUR_MANAGER / MODERATOR -> OPERATIONS
*/

-- AlterEnum
BEGIN;
CREATE TYPE "AdminDepartment_new" AS ENUM ('EXECUTIVE_MANAGEMENT', 'OPERATIONS_AND_MEMBERSHIP', 'FINANCE_AND_COMPLIANCE', 'TECHNICAL_SUPPORT');
CREATE TYPE "AdminRole_new" AS ENUM ('SUPER_ADMIN', 'OPERATIONS', 'FINANCE', 'SUPPORT');

-- Detach the columns from the old enum types so legacy values can be remapped.
ALTER TABLE "admin_profiles" ALTER COLUMN "department" TYPE TEXT USING ("department"::text);
ALTER TABLE "admin_profiles" ALTER COLUMN "role" TYPE TEXT USING ("role"::text);

UPDATE "admin_profiles" SET "department" = CASE "department"
  WHEN 'DIASPORA_AFFAIRS' THEN 'OPERATIONS_AND_MEMBERSHIP'
  WHEN 'OPERATIONS' THEN 'OPERATIONS_AND_MEMBERSHIP'
  WHEN 'VISA' THEN 'OPERATIONS_AND_MEMBERSHIP'
  WHEN 'TOURS' THEN 'OPERATIONS_AND_MEMBERSHIP'
  WHEN 'MARKETING' THEN 'OPERATIONS_AND_MEMBERSHIP'
  WHEN 'MODERATION' THEN 'OPERATIONS_AND_MEMBERSHIP'
  WHEN 'CUSTOMER_SUPPORT' THEN 'OPERATIONS_AND_MEMBERSHIP'
  WHEN 'FINANCE' THEN 'FINANCE_AND_COMPLIANCE'
  WHEN 'LEGAL' THEN 'FINANCE_AND_COMPLIANCE'
  WHEN 'IT_SUPPORT' THEN 'TECHNICAL_SUPPORT'
  ELSE "department"
END;

UPDATE "admin_profiles" SET "role" = CASE "role"
  WHEN 'ADMIN' THEN 'OPERATIONS'
  WHEN 'VISA_OFFICER' THEN 'OPERATIONS'
  WHEN 'TOUR_MANAGER' THEN 'OPERATIONS'
  WHEN 'MODERATOR' THEN 'OPERATIONS'
  ELSE "role"
END;

ALTER TABLE "admin_profiles" ALTER COLUMN "department" TYPE "AdminDepartment_new" USING ("department"::"AdminDepartment_new");
ALTER TABLE "admin_profiles" ALTER COLUMN "role" TYPE "AdminRole_new" USING ("role"::"AdminRole_new");

ALTER TYPE "AdminDepartment" RENAME TO "AdminDepartment_old";
ALTER TYPE "AdminRole" RENAME TO "AdminRole_old";
ALTER TYPE "AdminDepartment_new" RENAME TO "AdminDepartment";
ALTER TYPE "AdminRole_new" RENAME TO "AdminRole";
DROP TYPE "public"."AdminDepartment_old";
DROP TYPE "public"."AdminRole_old";
COMMIT;
