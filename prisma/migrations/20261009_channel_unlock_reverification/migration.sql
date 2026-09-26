-- Make channel grants re-verifiable so a cancelled YouTube subscription actually
-- revokes access.
--
-- Until now a channel_unlocks row was written once and never touched again: the
-- grant was permanent, so unsubscribing on YouTube left the feed open. The API
-- does report the flip (subscriptions.list?mine=true returns an empty items
-- array once unsubscribed), but re-checking it needs a long-lived credential and
-- the OAuth round-trip was discarding the refresh token, so there was nothing to
-- re-check with. This migration adds the storage that makes the check possible.
--
-- refresh_token: the long-lived credential, persisted at grant time. Null on
-- existing rows — the round-trip that granted them threw the token away, and it
-- cannot be recovered. Those grants therefore stay unre-verified and keep
-- working. That is deliberate: revoking a still-valid subscription because we
-- failed to save a token would punish the user for our own OAuth config. They
-- become re-verifiable the next time the user re-runs the flow.
--
-- last_verified_at: staleness marker the sweep schedules on, so a re-confirmed
-- grant is not polled again until the interval lapses.
--
-- revoked_at / revoked_reason: soft revocation, matching subscription_access_grants.
-- Non-null means the grant is inert — every read path filters on it — and the row
-- survives as the audit record of a subscription that was once held.

-- AlterTable
-- IF NOT EXISTS throughout so a partially-applied previous attempt can be
-- recovered by re-running `migrate deploy`, per the repo convention.
ALTER TABLE "channel_unlocks"
ADD COLUMN IF NOT EXISTS "refreshToken" TEXT,
ADD COLUMN IF NOT EXISTS "lastVerifiedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "revokedReason" TEXT;

-- Grants written before this migration were confirmed once and never re-checked.
-- Stamp lastVerifiedAt so the sweep does not treat the whole existing table as
-- overdue and spend the YouTube quota budget in a single run.
-- Re-runnable: on a second pass every row is already stamped, so this is a no-op.
UPDATE "channel_unlocks"
SET "lastVerifiedAt" = COALESCE("verifiedAt", "unlockedAt")
WHERE "lastVerifiedAt" IS NULL;

-- DropIndex
DROP INDEX IF EXISTS "channel_unlocks_userId_idx";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "channel_unlocks_userId_revokedAt_idx" ON "channel_unlocks"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "channel_unlocks_revokedAt_lastVerifiedAt_idx" ON "channel_unlocks"("revokedAt", "lastVerifiedAt");
