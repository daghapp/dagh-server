-- AlterEnum (safe: skip if label already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'PaymentTargetType' AND e.enumlabel = 'MEMBERSHIP_SUBSCRIPTION'
  ) THEN
    ALTER TYPE "PaymentTargetType" ADD VALUE 'MEMBERSHIP_SUBSCRIPTION';
  END IF;
END $$;

-- CreateEnum (safe: skip if type already exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MembershipTierCode') THEN
    CREATE TYPE "MembershipTierCode" AS ENUM ('FREE', 'BASELINE', 'SENIOR_PIONEER', 'SANKOFA_SETTLED', 'BASIC', 'SILVER', 'GOLD_INVESTOR', 'ELITE_AMBASSADOR', 'FAMILY_PLAN');
  END IF;
END $$;

-- CreateEnum (safe)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingInterval') THEN
    CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'ANNUAL', 'BIENNIAL', 'CUSTOM');
  END IF;
END $$;

-- CreateEnum (safe)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SupportTicketStatus') THEN
    CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
  END IF;
END $$;

-- CreateTable (safe: IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS "membership_plans" (
    "id" TEXT NOT NULL,
    "code" "MembershipTierCode" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "interval" "BillingInterval" NOT NULL,
    "features" TEXT[],
    "isMostPopular" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable (safe)
CREATE TABLE IF NOT EXISTS "priority_support_requests" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "priority_support_requests_pkey" PRIMARY KEY ("id")
);

-- AlterTable (safe: skip columns that already exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_subscriptions' AND column_name = 'memberCode') THEN
    ALTER TABLE "user_subscriptions" ADD COLUMN "memberCode" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_subscriptions' AND column_name = 'planId') THEN
    ALTER TABLE "user_subscriptions" ADD COLUMN "planId" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_subscriptions' AND column_name = 'tierCode') THEN
    ALTER TABLE "user_subscriptions" ADD COLUMN "tierCode" "MembershipTierCode" NOT NULL DEFAULT 'FREE';
  END IF;
END $$;

-- CreateIndex (safe)
CREATE UNIQUE INDEX IF NOT EXISTS "membership_plans_code_key" ON "membership_plans"("code");

-- CreateIndex (safe)
CREATE UNIQUE INDEX IF NOT EXISTS "user_subscriptions_memberCode_key" ON "user_subscriptions"("memberCode");

-- AddForeignKey (safe: skip if constraint already exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_subscriptions_planId_fkey') THEN
    ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "membership_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'priority_support_requests_subscriptionId_fkey') THEN
    ALTER TABLE "priority_support_requests" ADD CONSTRAINT "priority_support_requests_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "user_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'priority_support_requests_userId_fkey') THEN
    ALTER TABLE "priority_support_requests" ADD CONSTRAINT "priority_support_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
