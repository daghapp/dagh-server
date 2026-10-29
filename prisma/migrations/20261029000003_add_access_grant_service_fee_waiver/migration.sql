-- Admin-controlled lifetime free access.
--
-- Adds a per-grant flag that waives every service fee in the app, not just the
-- membership tier. Combined with a perpetual grant (endDate IS NULL) this is
-- the "lifetime free" entitlement an admin can issue to a specific user.
--
-- Guarded so the migration is safely re-runnable, matching the convention used
-- by the original access-grants migration.

ALTER TABLE "subscription_access_grants"
  ADD COLUMN IF NOT EXISTS "waiveServiceFees" BOOLEAN NOT NULL DEFAULT false;
