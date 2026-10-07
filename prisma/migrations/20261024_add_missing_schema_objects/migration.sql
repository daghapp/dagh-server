-- Add-only catch-up: schema.prisma objects that were introduced without
-- migrations (dating review, admin MFA/notifications, NGO, payments
-- risk/flag, platform settings, maintenance). Production is synced via
-- `prisma db push` / manual SQL, so every statement is guarded to be a
-- no-op where the object already exists. Destructive drift (Gender shrink,
-- `DatingUserProfile`, `session`, legacy enums) is intentionally NOT here.

-- AlterEnum
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'TERMINATED';

-- AlterTable
ALTER TABLE "admin_profiles"
    ADD COLUMN IF NOT EXISTS "backupCodes" TEXT[],
    ADD COLUMN IF NOT EXISTS "failedMfaAttempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "lastMfaAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "mfaMethod" TEXT,
    ADD COLUMN IF NOT EXISTS "mfaSecret" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_warnings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "issuedBy" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "user_warnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "dating_applications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dating_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "admin_notifications" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "actionUrl" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "admin_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "transaction_flags" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "flaggedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "payment_risks" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
    "score" INTEGER NOT NULL DEFAULT 0,
    "reasons" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ngos" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ngos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ngo_memberships" (
    "id" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "subscriptionId" TEXT,
    "verification" TEXT,
    "eligibility" TEXT,
    "datingAccess" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ngo_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ngo_access_requests" (
    "id" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "actionBy" TEXT,
    "actionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ngo_access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "platform_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "maintenance_windows" (
    "id" TEXT NOT NULL,
    "modules" JSONB NOT NULL,
    "message" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedBy" TEXT,

    CONSTRAINT "maintenance_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "admin_mfa_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_mfa_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_warnings_userId_idx" ON "user_warnings"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "dating_applications_userId_key" ON "dating_applications"("userId");
CREATE INDEX IF NOT EXISTS "admin_notifications_adminId_read_idx" ON "admin_notifications"("adminId", "read");
CREATE INDEX IF NOT EXISTS "transaction_flags_paymentId_idx" ON "transaction_flags"("paymentId");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_risks_paymentId_key" ON "payment_risks"("paymentId");
CREATE UNIQUE INDEX IF NOT EXISTS "ngos_code_key" ON "ngos"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "ngo_memberships_membershipId_key" ON "ngo_memberships"("membershipId");
CREATE INDEX IF NOT EXISTS "ngo_memberships_ngoId_userId_idx" ON "ngo_memberships"("ngoId", "userId");
CREATE INDEX IF NOT EXISTS "ngo_access_requests_ngoId_userId_idx" ON "ngo_access_requests"("ngoId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "platform_settings_key_key" ON "platform_settings"("key");
CREATE UNIQUE INDEX IF NOT EXISTS "admin_mfa_tokens_token_key" ON "admin_mfa_tokens"("token");
CREATE INDEX IF NOT EXISTS "admin_mfa_tokens_userId_expiresAt_idx" ON "admin_mfa_tokens"("userId", "expiresAt");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "user_warnings" ADD CONSTRAINT "user_warnings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "dating_applications" ADD CONSTRAINT "dating_applications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "admin_notifications" ADD CONSTRAINT "admin_notifications_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "transaction_flags" ADD CONSTRAINT "transaction_flags_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "payment_risks" ADD CONSTRAINT "payment_risks_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ngo_memberships" ADD CONSTRAINT "ngo_memberships_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "ngos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ngo_memberships" ADD CONSTRAINT "ngo_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ngo_access_requests" ADD CONSTRAINT "ngo_access_requests_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "ngos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ngo_access_requests" ADD CONSTRAINT "ngo_access_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;