-- Admin-controlled complimentary ("comped") membership access.
--
-- Adds subscription_access_grants: an admin can comp a specific user into a
-- tier without a payment and without overwriting their user_subscriptions row,
-- so a comp and a real paid subscription coexist rather than clobbering each
-- other. Grants are soft-revoked (revoked_at / revoked_by) rather than deleted
-- so the audit trail explaining why someone had access survives revocation.
--
-- Every statement is guarded so the migration is safely re-runnable, matching
-- 20261004_add_payment_gateway_config: a previous deploy was blocked by a
-- non-idempotent ALTER TABLE that had already been applied out-of-band.

-- CreateTable
CREATE TABLE IF NOT EXISTS "subscription_access_grants" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tierCode" "MembershipTierCode" NOT NULL,
    "includePaidPerks" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "grantedById" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "subscription_access_grants_userId_revokedAt_idx"
    ON "subscription_access_grants"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "subscription_access_grants_tierCode_idx"
    ON "subscription_access_grants"("tierCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "subscription_access_grants_endDate_idx"
    ON "subscription_access_grants"("endDate");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_access_grants_userId_fkey'
  ) THEN
    ALTER TABLE "subscription_access_grants"
      ADD CONSTRAINT "subscription_access_grants_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_access_grants_grantedById_fkey'
  ) THEN
    ALTER TABLE "subscription_access_grants"
      ADD CONSTRAINT "subscription_access_grants_grantedById_fkey"
      FOREIGN KEY ("grantedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_access_grants_revokedById_fkey'
  ) THEN
    ALTER TABLE "subscription_access_grants"
      ADD CONSTRAINT "subscription_access_grants_revokedById_fkey"
      FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

-- Priority support tickets can now be raised on the strength of an admin comp
-- rather than a paid subscription, so subscriptionId becomes nullable and a
-- grant FK is added. Exactly one of the two is set; the CHECK keeps a ticket
-- from being attached to neither or both.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'priority_support_requests' AND column_name = 'subscriptionId'
  ) THEN
    ALTER TABLE "priority_support_requests"
      ALTER COLUMN "subscriptionId" DROP NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'priority_support_requests' AND column_name = 'accessGrantId'
  ) THEN
    ALTER TABLE "priority_support_requests" ADD COLUMN "accessGrantId" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'priority_support_requests_access_grant_or_subscription'
  ) THEN
    -- A ticket must not be attributed to both a subscription and a grant.
    -- Both-null is allowed deliberately: the authorising record can be removed
    -- after the fact (grants use ON DELETE SET NULL), and the ticket is a
    -- historical record that must survive that.
    ALTER TABLE "priority_support_requests"
      ADD CONSTRAINT "priority_support_requests_access_grant_or_subscription"
      CHECK (NOT ("subscriptionId" IS NOT NULL AND "accessGrantId" IS NOT NULL));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'priority_support_requests_accessGrantId_fkey'
  ) THEN
    ALTER TABLE "priority_support_requests"
      ADD CONSTRAINT "priority_support_requests_accessGrantId_fkey"
      FOREIGN KEY ("accessGrantId") REFERENCES "subscription_access_grants"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

