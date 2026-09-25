-- Payment gateway settings: one row per provider, credentials stored only as
-- AES-256-GCM ciphertext. Adds a structured before/after diff column to the
-- admin activity log so credential/environment changes can be audited without
-- recording any secret.
--
-- Every statement is guarded so the migration is safely re-runnable. A previous
-- deploy was blocked for hours by a non-idempotent ALTER TABLE that had already
-- been applied out-of-band via `prisma db push` (Prisma P3018 -> P3009), so
-- guard rather than assume a clean starting state.

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentGatewayProvider') THEN
    CREATE TYPE "PaymentGatewayProvider" AS ENUM ('HUBTEL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentGatewayEnvironment') THEN
    CREATE TYPE "PaymentGatewayEnvironment" AS ENUM ('TEST', 'LIVE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentGatewayConnectionStatus') THEN
    CREATE TYPE "PaymentGatewayConnectionStatus" AS ENUM ('NOT_CONNECTED', 'CONNECTED', 'ERROR');
  END IF;
END$$;

-- AlterTable
ALTER TABLE "admin_activity_logs" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- CreateTable
CREATE TABLE IF NOT EXISTS "payment_gateway_configs" (
    "id" TEXT NOT NULL,
    "provider" "PaymentGatewayProvider" NOT NULL,
    "clientIdEncrypted" TEXT,
    "clientSecretEncrypted" TEXT,
    "environment" "PaymentGatewayEnvironment" NOT NULL DEFAULT 'TEST',
    "connectionStatus" "PaymentGatewayConnectionStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "connectedEnvironment" "PaymentGatewayEnvironment",
    "lastTestedAt" TIMESTAMP(3),
    "lastConnectedAt" TIMESTAMP(3),
    "lastErrorCategory" TEXT,
    "paymentProcessingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "processingDisabledReason" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_gateway_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "payment_gateway_configs_provider_key" ON "payment_gateway_configs"("provider");
