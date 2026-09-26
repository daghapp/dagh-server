-- Unblock account deletion for admins who have issued complimentary access grants.
--
-- subscription_access_grants.grantedById was ON DELETE RESTRICT, so any user who
-- had ever comped somebody into a tier could not delete their own account: the
-- restrict fired, Prisma threw P2003, and both delete paths surfaced an opaque
-- 500 while the transaction rolled the account delete back.
--
-- SET NULL is the fix, and it matches revokedById in this same table, which
-- already nulls on revoke. The alternative — cascading the delete to the grants —
-- would mean one admin closing their own account silently revokes the access of
-- whoever they comped, which is not their call to make. The comp stays in force
-- for the grantee; the row simply stops naming who issued it.
--
-- The column becomes nullable to match. No backfill is needed: every existing
-- row has a non-null issuer, and the new null is only reachable by an admin
-- deleting their account.
--
-- Guarded so a partially-applied previous attempt can be recovered by re-running
-- `migrate deploy`, per the repo's re-runnable-migrations convention. The drop has
-- to be a DO block because Postgres has no `DROP CONSTRAINT IF EXISTS`.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscription_access_grants_grantedById_fkey'
      AND confdeltype <> 'n'
  ) THEN
    ALTER TABLE "subscription_access_grants"
      DROP CONSTRAINT "subscription_access_grants_grantedById_fkey";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscription_access_grants_grantedById_fkey'
  ) THEN
    ALTER TABLE "subscription_access_grants"
      ADD CONSTRAINT "subscription_access_grants_grantedById_fkey"
      FOREIGN KEY ("grantedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- Idempotent on its own: dropping NOT NULL twice is a no-op.
ALTER TABLE "subscription_access_grants" ALTER COLUMN "grantedById" DROP NOT NULL;
